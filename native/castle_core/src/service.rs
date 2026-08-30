use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use anyhow::{Context, Result, anyhow, bail};
use castle_contracts::{
    CONTENT_CONTRACT_VERSION, CreateTaskInput, DeleteTaskInput, DeleteTaskResult, EntityDelta,
    MutateTaskInput, PersonMutationResult, ProtocolHandshake, RestoreTaskInput, Task, TaskCommand,
    TaskFields, TaskMutationResult, UpdatePersonInput,
};
pub use castle_contracts::{
    CompilationDelta, CreateFolderInput, CreateFolderResult, CreateSourceInput, DeleteFolderInput,
    DeleteFolderResult, DeleteSourceInput, DeleteSourceResult, MoveSourceInput, MoveSourceResult,
    RestoreSourceInput, SaveSourceInput, SaveSourceResult, ServiceState, SourceDocument,
};
use chrono::Local;

use crate::compiler::compile_source_override;
use crate::source_storage::{
    assert_contained, assert_revision, atomic_replace, ensure_explicit_note_id,
    library_fingerprint, open_new_private,
    prepare_folder_trash_destination as storage_folder_trash_destination,
    prepare_trash_destination as storage_trash_destination, prune_empty_trash_directories,
    source_document, source_revision, source_route, sync_directory, temporary_sibling,
    validate_markdown, validate_new_source_file, validate_note_id, validate_revision,
    validate_source_directory, validate_source_file_metadata, validate_source_identity,
    validate_trash_id,
};
use crate::structured_mutations::{
    ResolvedTaskFields, append_task_checklist, create_task_markdown, remove_task_checklist,
    task_slug, toggle_task_checklist, update_person_markdown, update_task_markdown,
    update_task_placement_markdown, update_task_status_markdown,
};
use crate::{
    CastleCompilation, CompileOptions, IndexProjection, SnapshotOptions, build_index_projection,
    compile_library, write_snapshot,
};

#[derive(Debug, Clone)]
pub struct ServiceOptions {
    pub library_root: PathBuf,
    pub repository_root: PathBuf,
    pub cache_root: PathBuf,
}

pub struct CastleService {
    library_root: PathBuf,
    repository_root: PathBuf,
    cache_root: PathBuf,
    compilation: Arc<CastleCompilation>,
    publication_base: Option<Arc<CastleCompilation>>,
    source_files_by_note_id: BTreeMap<String, String>,
    fingerprint: Vec<u8>,
}

impl CastleService {
    pub fn open(options: ServiceOptions) -> Result<Self> {
        let library_root = options.library_root.canonicalize().with_context(|| {
            format!(
                "could not resolve Castle library {}",
                options.library_root.display()
            )
        })?;
        let repository_root = options
            .repository_root
            .canonicalize()
            .unwrap_or(options.repository_root);
        fs::create_dir_all(&options.cache_root)?;
        let cache_root = options.cache_root.canonicalize()?;
        let compilation = compile_library(&CompileOptions::new(&library_root, &repository_root))?;
        write_service_snapshot(&compilation, &cache_root)?;
        let fingerprint = library_fingerprint(&library_root)?;
        let source_files_by_note_id = compilation.source_files_by_note_id.clone();
        Ok(Self {
            library_root,
            repository_root,
            cache_root,
            compilation: Arc::new(compilation),
            publication_base: None,
            source_files_by_note_id,
            fingerprint,
        })
    }

    pub fn state(&self) -> ServiceState {
        ServiceState {
            protocol: ProtocolHandshake::current([
                "typedContracts",
                "typedMutations",
                "contentDeltas",
            ]),
            generated_at: self.compilation.knowledge_base.generated_at.clone(),
            public_root: self
                .cache_root
                .join("public")
                .to_string_lossy()
                .into_owned(),
        }
    }

    pub fn index_projection(&self) -> IndexProjection {
        build_index_projection(&self.compilation)
    }

    pub fn publication_compilation(&self) -> Arc<CastleCompilation> {
        Arc::clone(&self.compilation)
    }

    pub fn acknowledge_current_publication(&mut self) {
        self.publication_base = None;
    }

    pub fn publication_options(&self) -> (CompileOptions, SnapshotOptions) {
        (
            CompileOptions::new(&self.library_root, &self.repository_root)
                .with_cached_stash_created_at(&self.compilation.stash_created_at),
            SnapshotOptions {
                generated_path: None,
                public_root: self.cache_root.join("public"),
            },
        )
    }

    pub fn adopt_publication(&mut self, compilation: CastleCompilation) -> Result<ServiceState> {
        self.source_files_by_note_id = compilation.source_files_by_note_id.clone();
        self.compilation = Arc::new(compilation);
        self.fingerprint = library_fingerprint(&self.library_root)?;
        self.publication_base = None;
        Ok(self.state())
    }

    pub fn compilation_delta(&self, next: &CastleCompilation) -> Result<CompilationDelta> {
        let delta_started = Instant::now();
        let current = self
            .publication_base
            .as_deref()
            .unwrap_or(self.compilation.as_ref());
        let notes = diff_entities(
            &current.knowledge_base.notes,
            &next.knowledge_base.notes,
            |note| note.id.as_str(),
        );
        let tasks = diff_entities(
            &current.knowledge_base.tasks,
            &next.knowledge_base.tasks,
            |task| task.id.as_str(),
        );
        let projects = diff_entities(
            &current.knowledge_base.projects,
            &next.knowledge_base.projects,
            |project| project.id.as_str(),
        );
        let calendar_events = diff_entities(
            &current.knowledge_base.calendar_events,
            &next.knowledge_base.calendar_events,
            |event| event.id.as_str(),
        );
        let mut mutable_resource_paths = Vec::new();
        if current.search_index.entries != next.search_index.entries {
            mutable_resource_paths.push("/generated/search-index.json".to_owned());
        }
        if current.relationship_graph != next.relationship_graph {
            mutable_resource_paths.push("/generated/relationship-graph.json".to_owned());
        }
        let delta = CompilationDelta {
            contract_version: CONTENT_CONTRACT_VERSION,
            generated_at: next.knowledge_base.generated_at.clone(),
            sections: next.knowledge_base.sections.clone(),
            folders: next.knowledge_base.folders.clone(),
            notes,
            tasks,
            projects,
            calendar_events,
            shortcut_collections: next.knowledge_base.shortcut_collections.clone(),
            mutable_resource_paths,
        };
        log_mutation_phase("compilation_delta", delta_started);
        Ok(delta)
    }

    pub fn library_changed_since_publication(&self) -> Result<bool> {
        Ok(library_fingerprint(&self.library_root)? != self.fingerprint)
    }

    pub fn refresh(&mut self) -> Result<ServiceState> {
        let compilation = compile_library(&CompileOptions::new(
            &self.library_root,
            &self.repository_root,
        ))?;
        self.install(compilation)
    }

    pub fn refresh_if_changed(&mut self) -> Result<Option<ServiceState>> {
        let current = library_fingerprint(&self.library_root)?;
        if current == self.fingerprint {
            return Ok(None);
        }
        self.refresh().map(Some)
    }

    pub fn read_source(&self, note_id: &str) -> Result<SourceDocument> {
        validate_note_id(note_id)?;
        let (source_path, source_file) = self.resolve_source(note_id)?;
        let markdown = fs::read_to_string(&source_path)
            .with_context(|| format!("could not read {}", source_path.display()))?;
        Ok(source_document(note_id, source_file, markdown))
    }

    pub fn save_source(&mut self, input: SaveSourceInput) -> Result<SaveSourceResult> {
        let mutation_started = Instant::now();
        validate_note_id(&input.note_id)?;
        validate_source_file_metadata(&input.source_file)?;
        validate_markdown(&input.markdown)?;
        validate_revision(&input.expected_revision)?;
        // The watcher normally keeps the compilation current, but a save can
        // arrive inside its polling interval. Do not build an incremental
        // snapshot on top of stale data from another externally edited file.
        self.refresh_if_changed()?;
        log_mutation_phase("refresh_if_changed", mutation_started);
        let (source_path, source_file) = self.resolve_source(&input.note_id)?;
        if input.source_file != source_file {
            bail!("Castle rejected mismatched source-note metadata.");
        }
        let current = fs::read_to_string(&source_path)?;
        assert_revision(&current, &input.expected_revision)?;
        if current == input.markdown {
            return Ok(SaveSourceResult {
                note_id: input.note_id,
                source_file,
                revision: source_revision(&current),
                generated_at: self.compilation.knowledge_base.generated_at.clone(),
                source_generation: None,
                publication_pending: None,
            });
        }

        let compilation_started = Instant::now();
        let compilation =
            compile_source_override(&self.compilation, &source_path, input.markdown.clone())?;
        log_mutation_phase("compile_source_override", compilation_started);
        assert_revision(&fs::read_to_string(&source_path)?, &input.expected_revision)?;
        let replace_started = Instant::now();
        atomic_replace(&source_path, input.markdown.as_bytes())?;
        log_mutation_phase("atomic_replace", replace_started);
        let install_started = Instant::now();
        let state = self.install(compilation)?;
        log_mutation_phase("install", install_started);
        log_mutation_phase("save_source_total", mutation_started);
        Ok(SaveSourceResult {
            note_id: input.note_id,
            source_file,
            revision: source_revision(&input.markdown),
            generated_at: state.generated_at,
            source_generation: None,
            publication_pending: None,
        })
    }

    pub fn commit_save_source(&mut self, input: SaveSourceInput) -> Result<SaveSourceResult> {
        validate_note_id(&input.note_id)?;
        validate_source_file_metadata(&input.source_file)?;
        validate_markdown(&input.markdown)?;
        validate_revision(&input.expected_revision)?;
        let (source_path, source_file) = self.resolve_source(&input.note_id)?;
        if input.source_file != source_file {
            bail!("Castle rejected mismatched source-note metadata.");
        }
        let current = fs::read_to_string(&source_path)?;
        assert_revision(&current, &input.expected_revision)?;
        if current == input.markdown {
            return Ok(SaveSourceResult {
                note_id: input.note_id,
                source_file,
                revision: source_revision(&current),
                generated_at: self.compilation.knowledge_base.generated_at.clone(),
                source_generation: None,
                publication_pending: None,
            });
        }
        validate_source_identity(
            &input.note_id,
            &source_file,
            &input.markdown,
            &self.library_root,
        )?;
        assert_revision(&fs::read_to_string(&source_path)?, &input.expected_revision)?;
        atomic_replace(&source_path, input.markdown.as_bytes())?;
        Ok(SaveSourceResult {
            note_id: input.note_id,
            source_file,
            revision: source_revision(&input.markdown),
            generated_at: self.compilation.knowledge_base.generated_at.clone(),
            source_generation: None,
            publication_pending: None,
        })
    }

    pub fn commit_move_source(&mut self, input: MoveSourceInput) -> Result<MoveSourceResult> {
        validate_note_id(&input.note_id)?;
        validate_source_file_metadata(&input.source_file)?;
        validate_new_source_file(&input.destination_source_file)?;
        validate_revision(&input.expected_revision)?;
        let (source_path, source_file) = self.resolve_source(&input.note_id)?;
        if input.source_file != source_file {
            bail!("Castle rejected mismatched source-note metadata.");
        }
        let original_markdown = fs::read_to_string(&source_path)?;
        assert_revision(&original_markdown, &input.expected_revision)?;
        let (destination_path, destination_source_file) =
            self.resolve_new_source(&input.destination_source_file)?;
        let moved_markdown = ensure_explicit_note_id(&original_markdown, &input.note_id)?;
        validate_source_identity(
            &input.note_id,
            &destination_source_file,
            &moved_markdown,
            &self.library_root,
        )?;

        let markdown_changed = moved_markdown != original_markdown;
        if markdown_changed {
            atomic_replace(&source_path, moved_markdown.as_bytes())?;
        }
        if let Err(reason) = fs::rename(&source_path, &destination_path) {
            if markdown_changed {
                let _ = atomic_replace(&source_path, original_markdown.as_bytes());
            }
            return Err(reason).with_context(|| {
                format!(
                    "could not move {} to {}",
                    source_path.display(),
                    destination_path.display()
                )
            });
        }
        sync_directory(source_path.parent().unwrap_or(&self.library_root));
        if destination_path.parent() != source_path.parent() {
            sync_directory(destination_path.parent().unwrap_or(&self.library_root));
        }
        self.source_files_by_note_id
            .insert(input.note_id.clone(), destination_source_file.clone());
        Ok(MoveSourceResult {
            note_id: input.note_id,
            previous_source_file: source_file,
            source_file: destination_source_file,
            route: source_route(&input.destination_source_file),
            revision: source_revision(&moved_markdown),
            generated_at: self.compilation.knowledge_base.generated_at.clone(),
            source_generation: None,
            publication_pending: None,
        })
    }

    pub fn create_source(&mut self, input: CreateSourceInput) -> Result<SaveSourceResult> {
        validate_note_id(&input.note_id)?;
        validate_markdown(&input.markdown)?;
        let (source_path, source_file) = self.resolve_new_source(&input.source_file)?;
        let mut file = open_new_private(&source_path)?;
        if let Err(reason) = (|| -> Result<()> {
            file.write_all(input.markdown.as_bytes())?;
            file.sync_all()?;
            drop(file);
            sync_directory(source_path.parent().unwrap_or(&self.library_root));
            Ok(())
        })() {
            let _ = fs::remove_file(&source_path);
            return Err(reason);
        }

        let validation = (|| -> Result<CastleCompilation> {
            let options = CompileOptions::new(&self.library_root, &self.repository_root)
                .with_cached_stash_created_at(&self.compilation.stash_created_at);
            let compilation = compile_library(&options)?;
            if compilation.source_files_by_note_id.get(&input.note_id) != Some(&source_file) {
                bail!("Castle could not verify the newly created record.");
            }
            Ok(compilation)
        })();
        let compilation = match validation {
            Ok(compilation) => compilation,
            Err(reason) => {
                let _ = fs::remove_file(&source_path);
                sync_directory(source_path.parent().unwrap_or(&self.library_root));
                return Err(reason);
            }
        };
        let state = self.install(compilation)?;
        Ok(SaveSourceResult {
            note_id: input.note_id,
            source_file,
            revision: source_revision(&input.markdown),
            generated_at: state.generated_at,
            source_generation: None,
            publication_pending: None,
        })
    }

    pub fn create_folder(&mut self, input: CreateFolderInput) -> Result<CreateFolderResult> {
        self.refresh_if_changed()?;
        let (folder_path, source_directory) = self.resolve_new_folder(&input.source_directory)?;
        fs::create_dir(&folder_path)?;
        sync_directory(folder_path.parent().unwrap_or(&self.library_root));

        let compilation = match compile_library(&CompileOptions::new(
            &self.library_root,
            &self.repository_root,
        )) {
            Ok(compilation) => compilation,
            Err(reason) => {
                let _ = fs::remove_dir(&folder_path);
                sync_directory(folder_path.parent().unwrap_or(&self.library_root));
                return Err(reason);
            }
        };
        let state = self.install(compilation)?;
        Ok(CreateFolderResult {
            source_directory,
            generated_at: state.generated_at,
        })
    }

    pub fn commit_create_folder(&mut self, input: CreateFolderInput) -> Result<CreateFolderResult> {
        self.refresh_if_changed()?;
        let (folder_path, source_directory) = self.resolve_new_folder(&input.source_directory)?;
        fs::create_dir(&folder_path)?;
        sync_directory(folder_path.parent().unwrap_or(&self.library_root));
        Ok(CreateFolderResult {
            source_directory,
            generated_at: self.compilation.knowledge_base.generated_at.clone(),
        })
    }

    pub fn commit_create_source(&mut self, input: CreateSourceInput) -> Result<SaveSourceResult> {
        validate_note_id(&input.note_id)?;
        validate_markdown(&input.markdown)?;
        let (source_path, source_file) = self.resolve_new_source(&input.source_file)?;
        validate_source_identity(
            &input.note_id,
            &source_file,
            &input.markdown,
            &self.library_root,
        )?;
        let mut file = open_new_private(&source_path)?;
        if let Err(reason) = (|| -> Result<()> {
            file.write_all(input.markdown.as_bytes())?;
            file.sync_all()?;
            drop(file);
            sync_directory(source_path.parent().unwrap_or(&self.library_root));
            Ok(())
        })() {
            let _ = fs::remove_file(&source_path);
            return Err(reason);
        }
        self.source_files_by_note_id
            .insert(input.note_id.clone(), source_file.clone());
        Ok(SaveSourceResult {
            note_id: input.note_id,
            source_file,
            revision: source_revision(&input.markdown),
            generated_at: self.compilation.knowledge_base.generated_at.clone(),
            source_generation: None,
            publication_pending: None,
        })
    }

    pub fn delete_source(&mut self, input: DeleteSourceInput) -> Result<DeleteSourceResult> {
        validate_note_id(&input.note_id)?;
        validate_source_file_metadata(&input.source_file)?;
        validate_revision(&input.expected_revision)?;
        let (source_path, source_file) = self.resolve_source(&input.note_id)?;
        if input.source_file != source_file {
            bail!("Castle rejected mismatched source-note metadata.");
        }
        assert_revision(&fs::read_to_string(&source_path)?, &input.expected_revision)?;
        let removed_path = temporary_sibling(&source_path, "deleted");
        fs::rename(&source_path, &removed_path)?;
        sync_directory(source_path.parent().unwrap_or(&self.library_root));

        let options = CompileOptions::new(&self.library_root, &self.repository_root)
            .with_cached_stash_created_at(&self.compilation.stash_created_at);
        let compilation = match compile_library(&options) {
            Ok(compilation) => compilation,
            Err(reason) => {
                fs::rename(&removed_path, &source_path)?;
                sync_directory(source_path.parent().unwrap_or(&self.library_root));
                return Err(reason);
            }
        };
        let (trash_path, trash_id) = match self.prepare_trash_destination(&source_file) {
            Ok(destination) => destination,
            Err(reason) => {
                fs::rename(&removed_path, &source_path)?;
                sync_directory(source_path.parent().unwrap_or(&self.library_root));
                return Err(reason);
            }
        };
        if let Err(reason) = fs::rename(&removed_path, &trash_path) {
            fs::rename(&removed_path, &source_path)?;
            sync_directory(source_path.parent().unwrap_or(&self.library_root));
            return Err(reason.into());
        }
        sync_directory(trash_path.parent().unwrap_or(&self.library_root));
        let state = match self.install(compilation) {
            Ok(state) => state,
            Err(reason) => {
                fs::rename(&trash_path, &source_path)?;
                sync_directory(source_path.parent().unwrap_or(&self.library_root));
                let _ = self.refresh();
                return Err(reason);
            }
        };
        Ok(DeleteSourceResult {
            note_id: input.note_id,
            source_file,
            generated_at: state.generated_at,
            trash_id,
            source_generation: None,
            publication_pending: None,
        })
    }

    pub fn commit_delete_source(&mut self, input: DeleteSourceInput) -> Result<DeleteSourceResult> {
        validate_note_id(&input.note_id)?;
        validate_source_file_metadata(&input.source_file)?;
        validate_revision(&input.expected_revision)?;
        let (source_path, source_file) = self.resolve_source(&input.note_id)?;
        if input.source_file != source_file {
            bail!("Castle rejected mismatched source-note metadata.");
        }
        assert_revision(&fs::read_to_string(&source_path)?, &input.expected_revision)?;
        let (trash_path, trash_id) = self.prepare_trash_destination(&source_file)?;
        fs::rename(&source_path, &trash_path)?;
        sync_directory(source_path.parent().unwrap_or(&self.library_root));
        sync_directory(trash_path.parent().unwrap_or(&self.library_root));
        self.source_files_by_note_id.remove(&input.note_id);
        Ok(DeleteSourceResult {
            note_id: input.note_id,
            source_file,
            generated_at: self.compilation.knowledge_base.generated_at.clone(),
            trash_id,
            source_generation: None,
            publication_pending: None,
        })
    }

    pub fn delete_folder(&mut self, input: DeleteFolderInput) -> Result<DeleteFolderResult> {
        self.refresh_if_changed()?;
        let (folder_path, source_directory) = self.resolve_folder(&input.source_directory)?;
        let entry_count = fs::read_dir(&folder_path)?.count();
        if entry_count > 0 && !input.recursive {
            bail!("Castle will not remove a folder containing content without confirmation.");
        }

        let trash = if entry_count == 0 {
            fs::remove_dir(&folder_path)?;
            None
        } else {
            let (trash_path, trash_id) =
                storage_folder_trash_destination(&self.library_root, &source_directory)?;
            fs::rename(&folder_path, &trash_path)?;
            sync_directory(trash_path.parent().unwrap_or(&self.library_root));
            Some((trash_path, trash_id))
        };
        sync_directory(folder_path.parent().unwrap_or(&self.library_root));

        let compilation = match compile_library(&CompileOptions::new(
            &self.library_root,
            &self.repository_root,
        )) {
            Ok(compilation) => compilation,
            Err(reason) => {
                if let Some((trash_path, _)) = &trash {
                    let _ = fs::rename(trash_path, &folder_path);
                } else {
                    let _ = fs::create_dir(&folder_path);
                }
                sync_directory(folder_path.parent().unwrap_or(&self.library_root));
                return Err(reason);
            }
        };
        let state = self.install(compilation)?;
        Ok(DeleteFolderResult {
            source_directory,
            entry_count,
            trash_id: trash.map(|(_, trash_id)| trash_id),
            generated_at: state.generated_at,
        })
    }

    pub fn commit_delete_folder(&mut self, input: DeleteFolderInput) -> Result<DeleteFolderResult> {
        self.refresh_if_changed()?;
        let (folder_path, source_directory) = self.resolve_folder(&input.source_directory)?;
        let entry_count = fs::read_dir(&folder_path)?.count();
        if entry_count > 0 && !input.recursive {
            bail!("Castle will not remove a folder containing content without confirmation.");
        }
        let trash_id = if entry_count == 0 {
            fs::remove_dir(&folder_path)?;
            None
        } else {
            let (trash_path, trash_id) =
                storage_folder_trash_destination(&self.library_root, &source_directory)?;
            fs::rename(&folder_path, &trash_path)?;
            sync_directory(trash_path.parent().unwrap_or(&self.library_root));
            Some(trash_id)
        };
        sync_directory(folder_path.parent().unwrap_or(&self.library_root));
        Ok(DeleteFolderResult {
            source_directory,
            entry_count,
            trash_id,
            generated_at: self.compilation.knowledge_base.generated_at.clone(),
        })
    }

    pub fn restore_source(&mut self, input: RestoreSourceInput) -> Result<SaveSourceResult> {
        validate_note_id(&input.note_id)?;
        validate_source_file_metadata(&input.source_file)?;
        validate_trash_id(&input.trash_id)?;
        let (source_path, source_file) = self.resolve_restore_source(&input.source_file)?;
        let trash_root = self.library_root.join(".castle/trash").canonicalize()?;
        let trash_path = trash_root.join(&input.trash_id).canonicalize()?;
        assert_contained(&trash_root, &trash_path)?;
        if !fs::metadata(&trash_path)?.is_file() {
            bail!("Castle could not find that deleted source document.");
        }
        let markdown = fs::read_to_string(&trash_path)?;
        fs::rename(&trash_path, &source_path)?;
        sync_directory(source_path.parent().unwrap_or(&self.library_root));

        let options = CompileOptions::new(&self.library_root, &self.repository_root)
            .with_cached_stash_created_at(&self.compilation.stash_created_at);
        let compilation = match compile_library(&options) {
            Ok(compilation)
                if compilation.source_files_by_note_id.get(&input.note_id)
                    == Some(&source_file) =>
            {
                compilation
            }
            Ok(_) => {
                fs::rename(&source_path, &trash_path)?;
                sync_directory(trash_path.parent().unwrap_or(&self.library_root));
                bail!("Castle could not verify the restored record.");
            }
            Err(reason) => {
                fs::rename(&source_path, &trash_path)?;
                sync_directory(trash_path.parent().unwrap_or(&self.library_root));
                return Err(reason);
            }
        };
        let state = match self.install(compilation) {
            Ok(state) => state,
            Err(reason) => {
                fs::rename(&source_path, &trash_path)?;
                sync_directory(trash_path.parent().unwrap_or(&self.library_root));
                let _ = self.refresh();
                return Err(reason);
            }
        };
        prune_empty_trash_directories(trash_path.parent().unwrap_or(&trash_root), &trash_root);
        Ok(SaveSourceResult {
            note_id: input.note_id,
            source_file,
            revision: source_revision(&markdown),
            generated_at: state.generated_at,
            source_generation: None,
            publication_pending: None,
        })
    }

    pub fn commit_restore_source(&mut self, input: RestoreSourceInput) -> Result<SaveSourceResult> {
        validate_note_id(&input.note_id)?;
        validate_source_file_metadata(&input.source_file)?;
        validate_trash_id(&input.trash_id)?;
        let (source_path, source_file) = self.resolve_restore_source(&input.source_file)?;
        let trash_root = self.library_root.join(".castle/trash").canonicalize()?;
        let trash_path = trash_root.join(&input.trash_id).canonicalize()?;
        assert_contained(&trash_root, &trash_path)?;
        if !fs::metadata(&trash_path)?.is_file() {
            bail!("Castle could not find that deleted source document.");
        }
        let markdown = fs::read_to_string(&trash_path)?;
        validate_source_identity(&input.note_id, &source_file, &markdown, &self.library_root)?;
        fs::rename(&trash_path, &source_path)?;
        sync_directory(source_path.parent().unwrap_or(&self.library_root));
        sync_directory(trash_path.parent().unwrap_or(&trash_root));
        self.source_files_by_note_id
            .insert(input.note_id.clone(), source_file.clone());
        prune_empty_trash_directories(trash_path.parent().unwrap_or(&trash_root), &trash_root);
        Ok(SaveSourceResult {
            note_id: input.note_id,
            source_file,
            revision: source_revision(&markdown),
            generated_at: self.compilation.knowledge_base.generated_at.clone(),
            source_generation: None,
            publication_pending: None,
        })
    }

    pub fn mutate_task(&mut self, input: MutateTaskInput) -> Result<TaskMutationResult> {
        validate_note_id(&input.task_id)?;
        let current = self
            .compilation
            .knowledge_base
            .tasks
            .iter()
            .find(|task| task.id == input.task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Castle could not find that task."))?;
        let source = self.read_source(&current.note_id)?;
        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
        let markdown = match input.command {
            TaskCommand::Update { fields } => {
                let (project_link, people_links) = self.resolve_task_links(&fields)?;
                update_task_markdown(
                    &source.markdown,
                    ResolvedTaskFields {
                        fields: &fields,
                        sort_order: current.sort_order,
                        project_link,
                        people_links,
                    },
                    &today,
                )?
            }
            TaskCommand::ChangeStatus { status } => {
                update_task_status_markdown(&source.markdown, status, &today)?
            }
            TaskCommand::Move { status, sort_order } => {
                if !sort_order.is_finite() || sort_order < 0.0 {
                    bail!("Castle rejected an invalid task sort order.");
                }
                update_task_placement_markdown(&source.markdown, status, sort_order, &today)?
            }
            TaskCommand::ToggleSubtask { subtask_id } => {
                let index = current
                    .subtasks
                    .iter()
                    .position(|subtask| subtask.id == subtask_id)
                    .ok_or_else(|| anyhow!("Castle could not find that checklist item."))?;
                toggle_task_checklist(&source.markdown, index)
            }
            TaskCommand::AddSubtask { title } => {
                if title.trim().is_empty() {
                    bail!("A checklist item must have a title.");
                }
                append_task_checklist(&source.markdown, &title)
            }
            TaskCommand::RemoveSubtask { subtask_id } => {
                let index = current
                    .subtasks
                    .iter()
                    .position(|subtask| subtask.id == subtask_id)
                    .ok_or_else(|| anyhow!("Castle could not find that checklist item."))?;
                remove_task_checklist(&source.markdown, index)
            }
        };
        let result = self.save_source(SaveSourceInput {
            note_id: source.note_id,
            source_file: source.source_file,
            markdown,
            expected_revision: source.revision,
        })?;
        let task = self.current_task(&current.id)?;
        Ok(TaskMutationResult {
            source: result,
            task,
        })
    }

    pub fn create_task(&mut self, input: CreateTaskInput) -> Result<TaskMutationResult> {
        let fields = input.fields;
        if fields.title.trim().is_empty() {
            bail!("A task must have a title.");
        }
        let base = task_slug(&fields.title);
        let used_routes = self
            .compilation
            .knowledge_base
            .tasks
            .iter()
            .map(|task| task.route.as_str())
            .collect::<std::collections::HashSet<_>>();
        let mut slug = base.clone();
        let mut suffix = 2;
        while used_routes.contains(format!("/note/tasks/{slug}").as_str()) {
            slug = format!("{base}_{suffix}");
            suffix += 1;
        }
        let id = format!("task_{slug}");
        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
        let sort_order = self.next_task_sort_order(&fields);
        let (project_link, people_links) = self.resolve_task_links(&fields)?;
        let markdown = create_task_markdown(
            &id,
            &fields,
            sort_order,
            &project_link,
            &people_links,
            &today,
        )?;
        let result = self.create_source(CreateSourceInput {
            note_id: id.clone(),
            source_file: format!("tasks/{slug}.md"),
            markdown,
        })?;
        let task = self.current_task(&id)?;
        Ok(TaskMutationResult {
            source: result,
            task,
        })
    }

    pub fn delete_task(&mut self, input: DeleteTaskInput) -> Result<DeleteTaskResult> {
        validate_note_id(&input.task_id)?;
        let task = self.current_task(&input.task_id)?;
        let source = self.read_source(&task.note_id)?;
        let result = self.delete_source(DeleteSourceInput {
            note_id: source.note_id,
            source_file: source.source_file,
            expected_revision: source.revision,
        })?;
        Ok(DeleteTaskResult {
            source: result,
            task,
        })
    }

    pub fn restore_task(&mut self, input: RestoreTaskInput) -> Result<TaskMutationResult> {
        validate_note_id(&input.task_id)?;
        let result = self.restore_source(RestoreSourceInput {
            note_id: input.note_id,
            source_file: input.source_file,
            trash_id: input.trash_id,
        })?;
        let task = self.current_task(&input.task_id)?;
        Ok(TaskMutationResult {
            source: result,
            task,
        })
    }

    pub fn update_person(&mut self, input: UpdatePersonInput) -> Result<PersonMutationResult> {
        validate_note_id(&input.note_id)?;
        let current = self
            .compilation
            .knowledge_base
            .notes
            .iter()
            .find(|note| note.id == input.note_id && note.section == "people")
            .cloned()
            .ok_or_else(|| anyhow!("Castle could not find that person."))?;
        let source = self.read_source(&current.id)?;
        let markdown = update_person_markdown(&source.markdown, &input.fields)?;
        let result = self.save_source(SaveSourceInput {
            note_id: source.note_id,
            source_file: source.source_file,
            markdown,
            expected_revision: source.revision,
        })?;
        let note = self
            .compilation
            .knowledge_base
            .notes
            .iter()
            .find(|note| note.id == current.id)
            .cloned()
            .ok_or_else(|| anyhow!("Castle could not reload the updated person."))?;
        Ok(PersonMutationResult {
            source: result,
            note,
        })
    }

    fn current_task(&self, task_id: &str) -> Result<Task> {
        self.compilation
            .knowledge_base
            .tasks
            .iter()
            .find(|task| task.id == task_id)
            .cloned()
            .ok_or_else(|| anyhow!("Castle could not reload the updated task."))
    }

    fn resolve_task_links(&self, fields: &TaskFields) -> Result<(String, Vec<String>)> {
        let project_link = if fields.project_id.is_empty() {
            String::new()
        } else {
            let project = self
                .compilation
                .knowledge_base
                .projects
                .iter()
                .find(|project| project.id == fields.project_id)
                .ok_or_else(|| anyhow!("Castle could not resolve that task project."))?;
            self.note_wiki_link(&project.note_id)?
        };
        let people_links = fields
            .people_ids
            .iter()
            .map(|note_id| self.note_wiki_link(note_id))
            .collect::<Result<Vec<_>>>()?;
        Ok((project_link, people_links))
    }

    fn note_wiki_link(&self, note_id: &str) -> Result<String> {
        let note = self
            .compilation
            .knowledge_base
            .notes
            .iter()
            .find(|note| note.id == note_id)
            .ok_or_else(|| anyhow!("Castle could not resolve a task note reference."))?;
        let target = note
            .route
            .trim_start_matches("/note/")
            .trim_end_matches('/');
        Ok(format!("[[{target}|{}]]", note.title))
    }

    fn next_task_sort_order(&self, fields: &TaskFields) -> f64 {
        self.compilation
            .knowledge_base
            .tasks
            .iter()
            .filter(|task| {
                task.status == fields.status
                    && task
                        .project
                        .as_ref()
                        .map(|project| project.id.as_str())
                        .unwrap_or("")
                        == fields.project_id
            })
            .map(|task| task.sort_order)
            .filter(|order| *order > 0.0 && order.is_finite())
            .fold(0.0, f64::max)
            + 1000.0
    }

    fn install(&mut self, compilation: CastleCompilation) -> Result<ServiceState> {
        write_service_snapshot(&compilation, &self.cache_root)?;
        if self.publication_base.is_none() {
            self.publication_base = Some(Arc::clone(&self.compilation));
        }
        self.source_files_by_note_id = compilation.source_files_by_note_id.clone();
        self.compilation = Arc::new(compilation);
        self.fingerprint = library_fingerprint(&self.library_root)?;
        Ok(self.state())
    }

    fn resolve_source(&self, note_id: &str) -> Result<(PathBuf, String)> {
        let source_file = self
            .source_files_by_note_id
            .get(note_id)
            .cloned()
            .ok_or_else(|| anyhow!("Castle could not find that source note."))?;
        validate_source_file_metadata(&source_file)?;
        let candidate = self.library_root.join(&source_file);
        let canonical = candidate.canonicalize()?;
        assert_contained(&self.library_root, &canonical)?;
        if !fs::metadata(&canonical)?.is_file() {
            bail!("Castle source document is not a regular file.");
        }
        Ok((canonical, source_file))
    }

    fn resolve_new_source(&self, source_file: &str) -> Result<(PathBuf, String)> {
        validate_new_source_file(source_file)?;
        let candidate = self.library_root.join(source_file);
        assert_contained(&self.library_root, &candidate)?;
        let parent = candidate
            .parent()
            .ok_or_else(|| anyhow!("Castle rejected an invalid source path."))?
            .canonicalize()?;
        assert_contained(&self.library_root, &parent)?;
        if candidate.exists() {
            bail!("A Markdown file with that name already exists.");
        }
        Ok((candidate, source_file.replace('\\', "/")))
    }

    fn resolve_new_folder(&self, source_directory: &str) -> Result<(PathBuf, String)> {
        validate_source_directory(source_directory)?;
        let candidate = self.library_root.join(source_directory);
        assert_contained(&self.library_root, &candidate)?;
        let parent = candidate
            .parent()
            .ok_or_else(|| anyhow!("Castle rejected an invalid folder path."))?
            .canonicalize()?;
        assert_contained(&self.library_root, &parent)?;
        if candidate.exists() {
            bail!("A folder with that name already exists.");
        }
        Ok((candidate, source_directory.to_owned()))
    }

    fn resolve_folder(&self, source_directory: &str) -> Result<(PathBuf, String)> {
        validate_source_directory(source_directory)?;
        let candidate = self.library_root.join(source_directory);
        assert_contained(&self.library_root, &candidate)?;
        if fs::symlink_metadata(&candidate)?.file_type().is_symlink() {
            bail!("Castle will not remove a symbolic-link folder.");
        }
        let canonical = candidate.canonicalize()?;
        assert_contained(&self.library_root, &canonical)?;
        if !fs::metadata(&canonical)?.is_dir() {
            bail!("Castle could not find that folder.");
        }
        Ok((canonical, source_directory.to_owned()))
    }

    fn resolve_restore_source(&self, source_file: &str) -> Result<(PathBuf, String)> {
        validate_source_file_metadata(source_file)?;
        let candidate = self.library_root.join(source_file);
        assert_contained(&self.library_root, &candidate)?;
        let parent = candidate
            .parent()
            .ok_or_else(|| anyhow!("Castle rejected an invalid source path."))?
            .canonicalize()?;
        assert_contained(&self.library_root, &parent)?;
        if candidate.exists() {
            bail!("A Markdown file with that name already exists.");
        }
        Ok((candidate, source_file.replace('\\', "/")))
    }

    fn prepare_trash_destination(&self, source_file: &str) -> Result<(PathBuf, String)> {
        storage_trash_destination(&self.library_root, source_file)
    }
}

fn write_service_snapshot(compilation: &CastleCompilation, cache_root: &Path) -> Result<()> {
    write_snapshot(
        compilation,
        &SnapshotOptions {
            generated_path: None,
            public_root: cache_root.join("public"),
        },
    )
}

fn log_mutation_phase(phase: &str, started: Instant) {
    if std::env::var_os("CASTLE_PROFILE_MUTATIONS").is_some() {
        eprintln!(
            "[castle:mutation-profile] {phase}={}ms",
            started.elapsed().as_secs_f64() * 1_000.0
        );
    }
}

fn diff_entities<T>(
    previous: &[T],
    next: &[T],
    entity_id: impl for<'a> Fn(&'a T) -> &'a str,
) -> EntityDelta<T>
where
    T: Clone + PartialEq,
{
    let previous_by_id = previous
        .iter()
        .map(|value| (entity_id(value), value))
        .collect::<BTreeMap<_, _>>();
    let next_by_id = next
        .iter()
        .map(|value| (entity_id(value), value))
        .collect::<BTreeMap<_, _>>();
    let upserted = next_by_id
        .iter()
        .filter(|(id, value)| previous_by_id.get(*id).is_none_or(|old| old != *value))
        .map(|(_, value)| (*value).clone())
        .collect();
    let removed_ids = previous_by_id
        .keys()
        .filter(|id| !next_by_id.contains_key(*id))
        .map(|id| (*id).to_owned())
        .collect();
    let next_order = next.iter().map(&entity_id).collect::<Vec<_>>();
    let ordered_ids = (previous.iter().map(&entity_id).collect::<Vec<_>>() != next_order)
        .then(|| next_order.into_iter().map(str::to_owned).collect());
    EntityDelta {
        upserted,
        removed_ids,
        ordered_ids,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service_fixture() -> (tempfile::TempDir, CastleService) {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        fs::create_dir_all(library.join("notes")).unwrap();
        fs::create_dir_all(library.join("tasks")).unwrap();
        fs::write(library.join("notes/hello.md"), "# Hello\n\nOriginal.\n").unwrap();
        fs::write(
            library.join("tasks/dependent.md"),
            "---\ntype: task\nschema_version: 1\nid: task_dependent\nstatus: todo\ndescription: \"[[notes/hello]]\"\n---\n\n# Dependent\n",
        )
        .unwrap();
        let service = CastleService::open(ServiceOptions {
            library_root: library,
            repository_root: root.path().to_owned(),
            cache_root: root.path().join("cache"),
        })
        .unwrap();
        (root, service)
    }

    #[test]
    fn reads_and_saves_with_optimistic_concurrency() {
        let (_root, mut service) = service_fixture();
        let original = service.read_source("notes/hello").unwrap();
        let saved = service
            .save_source(SaveSourceInput {
                note_id: original.note_id.clone(),
                source_file: original.source_file.clone(),
                markdown: "# Hello\n\nChanged.\n".to_owned(),
                expected_revision: original.revision.clone(),
            })
            .unwrap();
        assert_ne!(saved.revision, original.revision);
        let reason = service
            .save_source(SaveSourceInput {
                note_id: original.note_id,
                source_file: original.source_file,
                markdown: "# Hello\n\nStale.\n".to_owned(),
                expected_revision: original.revision,
            })
            .unwrap_err();
        assert!(reason.downcast_ref::<crate::SourceConflict>().is_some());
    }

    #[test]
    fn task_creation_order_is_isolated_to_the_exact_project() {
        let (_root, mut service) = service_fixture();
        let template = service.compilation.knowledge_base.tasks[0].clone();
        let castle = castle_contracts::ProjectReference {
            id: "project_castle".to_owned(),
            title: "Castle".to_owned(),
            route: "/note/projects/castle/castle".to_owned(),
        };
        let voxile = castle_contracts::ProjectReference {
            id: "project_voxile".to_owned(),
            title: "Voxile".to_owned(),
            route: "/note/projects/voxile/voxile".to_owned(),
        };
        Arc::make_mut(&mut service.compilation).knowledge_base.tasks = vec![
            Task {
                id: "task_castle".to_owned(),
                sort_order: 1000.0,
                project: Some(castle),
                ..template.clone()
            },
            Task {
                id: "task_voxile".to_owned(),
                sort_order: 9000.0,
                project: Some(voxile),
                ..template
            },
        ];
        let fields = TaskFields {
            title: "New Castle task".to_owned(),
            description: String::new(),
            status: castle_contracts::TaskStatus::Todo,
            target_date: String::new(),
            target_time: String::new(),
            estimate_minutes: 0,
            project_id: "project_castle".to_owned(),
            people_ids: Vec::new(),
            tags: Vec::new(),
        };

        assert_eq!(service.next_task_sort_order(&fields), 2000.0);
    }

    #[test]
    fn commits_source_changes_without_waiting_for_snapshot_publication() {
        let (root, mut service) = service_fixture();
        let original_state = service.state();
        let original = service.read_source("notes/hello").unwrap();
        let saved = service
            .commit_save_source(SaveSourceInput {
                note_id: original.note_id.clone(),
                source_file: original.source_file.clone(),
                markdown: "# Hello\n\nCommitted quickly.\n".to_owned(),
                expected_revision: original.revision,
            })
            .unwrap();

        assert_ne!(saved.revision, source_revision(&original.markdown));
        assert_eq!(service.state().generated_at, original_state.generated_at);
        assert_eq!(
            fs::read_to_string(root.path().join("library/notes/hello.md")).unwrap(),
            "# Hello\n\nCommitted quickly.\n"
        );
    }

    #[test]
    fn fast_commits_validate_identity_and_update_the_source_registry() {
        let (root, mut service) = service_fixture();
        let original = service.read_source("notes/hello").unwrap();
        assert!(
            service
                .commit_save_source(SaveSourceInput {
                    note_id: original.note_id.clone(),
                    source_file: original.source_file.clone(),
                    markdown: "---\nid: another_note\n---\nChanged.\n".to_owned(),
                    expected_revision: original.revision.clone(),
                })
                .is_err()
        );
        assert_eq!(
            fs::read_to_string(root.path().join("library/notes/hello.md")).unwrap(),
            original.markdown
        );

        let created = service
            .commit_create_source(CreateSourceInput {
                note_id: "notes/new_note".to_owned(),
                source_file: "notes/new_note.md".to_owned(),
                markdown: "# New note\n".to_owned(),
            })
            .unwrap();
        assert_eq!(
            service.read_source("notes/new_note").unwrap().markdown,
            "# New note\n"
        );
        let deleted = service
            .commit_delete_source(DeleteSourceInput {
                note_id: created.note_id.clone(),
                source_file: created.source_file.clone(),
                expected_revision: created.revision,
            })
            .unwrap();
        assert!(service.read_source("notes/new_note").is_err());
        service
            .commit_restore_source(RestoreSourceInput {
                note_id: created.note_id,
                source_file: created.source_file,
                trash_id: deleted.trash_id,
            })
            .unwrap();
        assert_eq!(
            service.read_source("notes/new_note").unwrap().markdown,
            "# New note\n"
        );
        let restored = service.read_source("notes/new_note").unwrap();
        let moved = service
            .commit_move_source(MoveSourceInput {
                note_id: restored.note_id,
                source_file: restored.source_file,
                destination_source_file: "notes/renamed_note.md".to_owned(),
                expected_revision: restored.revision,
            })
            .unwrap();
        assert_eq!(moved.previous_source_file, "notes/new_note.md");
        assert_eq!(moved.source_file, "notes/renamed_note.md");
        assert!(!root.path().join("library/notes/new_note.md").exists());
        let moved_source = service.read_source("notes/new_note").unwrap();
        assert_eq!(moved_source.source_file, "notes/renamed_note.md");
        assert!(moved_source.markdown.contains("id: \"notes/new_note\""));
    }

    #[test]
    fn describes_only_changed_catalog_entities_after_publication() {
        let (_root, mut service) = service_fixture();
        let original = service.read_source("task_dependent").unwrap();
        service
            .commit_save_source(SaveSourceInput {
                note_id: original.note_id,
                source_file: original.source_file,
                markdown: original.markdown.replace("status: todo", "status: done"),
                expected_revision: original.revision,
            })
            .unwrap();
        let (compile_options, _) = service.publication_options();
        let compilation = compile_library(&compile_options).unwrap();
        let delta = service.compilation_delta(&compilation).unwrap();

        assert_eq!(delta.tasks.upserted.len(), 1);
        assert_eq!(delta.tasks.upserted[0].id, "task_dependent");
        assert_eq!(
            delta.tasks.upserted[0].status,
            castle_contracts::TaskStatus::Done
        );
        assert!(delta.tasks.removed_ids.is_empty());
        assert_eq!(delta.notes.upserted.len(), 1);
        assert_eq!(delta.notes.upserted[0].id, "task_dependent");
        assert!(
            delta
                .mutable_resource_paths
                .contains(&"/generated/search-index.json".to_owned())
        );
    }

    #[test]
    fn synchronous_mutations_keep_the_pre_mutation_publication_base() {
        let (_root, mut service) = service_fixture();
        let original = service.read_source("task_dependent").unwrap();
        service
            .save_source(SaveSourceInput {
                note_id: original.note_id,
                source_file: original.source_file,
                markdown: original.markdown.replace("status: todo", "status: done"),
                expected_revision: original.revision,
            })
            .unwrap();

        let published = service.publication_compilation();
        let delta = service.compilation_delta(&published).unwrap();
        assert_eq!(delta.tasks.upserted.len(), 1);
        assert_eq!(
            delta.tasks.upserted[0].status,
            castle_contracts::TaskStatus::Done
        );

        let published = Arc::unwrap_or_clone(published);
        service.adopt_publication(published).unwrap();
        let adopted = service.publication_compilation();
        assert!(
            service
                .compilation_delta(&adopted)
                .unwrap()
                .tasks
                .upserted
                .is_empty()
        );
    }

    #[test]
    fn rejects_record_moves_to_incompatible_schema_paths_without_mutating_source() {
        let (root, mut service) = service_fixture();
        let task = service.read_source("task_dependent").unwrap();
        let reason = service
            .commit_move_source(MoveSourceInput {
                note_id: task.note_id,
                source_file: task.source_file,
                destination_source_file: "notes/dependent.md".to_owned(),
                expected_revision: task.revision,
            })
            .unwrap_err();

        assert!(format!("{reason:#}").contains("tasks/"));
        assert!(root.path().join("library/tasks/dependent.md").is_file());
        assert!(!root.path().join("library/notes/dependent.md").exists());
    }

    #[test]
    fn creates_and_deletes_validated_sources() {
        let (root, mut service) = service_fixture();
        let created = service
            .create_source(CreateSourceInput {
                note_id: "notes/new_note".to_owned(),
                source_file: "notes/new_note.md".to_owned(),
                markdown: "# New note\n".to_owned(),
            })
            .unwrap();
        assert!(root.path().join("library/notes/new_note.md").is_file());
        let deleted = service
            .delete_source(DeleteSourceInput {
                note_id: created.note_id.clone(),
                source_file: created.source_file.clone(),
                expected_revision: created.revision,
            })
            .unwrap();
        assert!(!root.path().join("library/notes/new_note.md").exists());
        assert!(
            root.path()
                .join("library/.castle/trash")
                .join(&deleted.trash_id)
                .is_file()
        );

        let restored = service
            .restore_source(RestoreSourceInput {
                note_id: created.note_id,
                source_file: created.source_file,
                trash_id: deleted.trash_id,
            })
            .unwrap();
        assert!(root.path().join("library/notes/new_note.md").is_file());
        assert_eq!(restored.revision, source_revision("# New note\n"));
    }

    #[test]
    fn creates_empty_folders_and_moves_populated_folders_to_trash() {
        let (root, mut service) = service_fixture();
        let created = service
            .create_folder(CreateFolderInput {
                source_directory: "notes/reference".to_owned(),
            })
            .unwrap();
        assert_eq!(created.source_directory, "notes/reference");
        assert!(root.path().join("library/notes/reference").is_dir());
        assert!(
            service
                .compilation
                .knowledge_base
                .folders
                .iter()
                .any(|folder| folder.section_id == "notes" && folder.directory == ["reference"])
        );

        fs::write(
            root.path().join("library/notes/reference/attachment.txt"),
            "keep this safe",
        )
        .unwrap();
        let reason = service
            .delete_folder(DeleteFolderInput {
                source_directory: "notes/reference".to_owned(),
                recursive: false,
            })
            .unwrap_err();
        assert!(format!("{reason:#}").contains("without confirmation"));
        assert!(
            root.path()
                .join("library/notes/reference/attachment.txt")
                .is_file()
        );

        let deleted = service
            .delete_folder(DeleteFolderInput {
                source_directory: "notes/reference".to_owned(),
                recursive: true,
            })
            .unwrap();
        let trash_id = deleted
            .trash_id
            .expect("populated folder is moved to trash");
        assert!(!root.path().join("library/notes/reference").exists());
        assert!(
            root.path()
                .join("library/.castle/trash")
                .join(trash_id)
                .join("attachment.txt")
                .is_file()
        );
    }

    #[test]
    fn rolls_back_invalid_saves_creates_and_deletes() {
        let (root, mut service) = service_fixture();
        let original = service.read_source("notes/hello").unwrap();
        assert!(
            service
                .save_source(SaveSourceInput {
                    note_id: original.note_id.clone(),
                    source_file: original.source_file.clone(),
                    markdown: "---\ninvalid: [\n---\n".to_owned(),
                    expected_revision: original.revision.clone(),
                })
                .is_err()
        );
        assert_eq!(
            fs::read_to_string(root.path().join("library/notes/hello.md")).unwrap(),
            original.markdown
        );

        assert!(
            service
                .create_source(CreateSourceInput {
                    note_id: "notes/invalid".to_owned(),
                    source_file: "notes/invalid.md".to_owned(),
                    markdown: "---\ntype: unsupported\n---\n".to_owned(),
                })
                .is_err()
        );
        assert!(!root.path().join("library/notes/invalid.md").exists());

        assert!(
            service
                .delete_source(DeleteSourceInput {
                    note_id: original.note_id,
                    source_file: original.source_file,
                    expected_revision: original.revision,
                })
                .is_err()
        );
        assert_eq!(
            fs::read_to_string(root.path().join("library/notes/hello.md")).unwrap(),
            original.markdown
        );
    }

    #[test]
    fn refreshes_after_external_changes() {
        let (root, mut service) = service_fixture();
        assert!(service.refresh_if_changed().unwrap().is_none());
        fs::write(
            root.path().join("library/notes/hello.md"),
            "# Hello\n\nExternally changed.\n",
        )
        .unwrap();
        assert!(service.refresh_if_changed().unwrap().is_some());
        assert!(
            service
                .read_source("notes/hello")
                .unwrap()
                .markdown
                .contains("Externally changed")
        );
    }

    #[test]
    fn preserves_external_changes_that_arrive_just_before_a_save() {
        let (root, mut service) = service_fixture();
        let original = service.read_source("notes/hello").unwrap();
        let dependent_path = root.path().join("library/tasks/dependent.md");
        let dependent = fs::read_to_string(&dependent_path).unwrap();
        fs::write(
            &dependent_path,
            dependent.replace("# Dependent", "# Externally changed task"),
        )
        .unwrap();

        service
            .save_source(SaveSourceInput {
                note_id: original.note_id,
                source_file: original.source_file,
                markdown: "# Hello\n\nSaved in Castle.\n".to_owned(),
                expected_revision: original.revision,
            })
            .unwrap();

        assert_eq!(
            service.compilation.knowledge_base.tasks[0].title,
            "Externally changed task"
        );
    }

    #[cfg(unix)]
    #[test]
    fn excludes_source_symlinks_that_escape_the_library() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        fs::create_dir_all(library.join("notes")).unwrap();
        let outside = root.path().join("private.md");
        fs::write(&outside, "Private\n").unwrap();
        symlink(&outside, library.join("notes/linked.md")).unwrap();
        let service = CastleService::open(ServiceOptions {
            library_root: library,
            repository_root: root.path().to_owned(),
            cache_root: root.path().join("cache"),
        })
        .unwrap();
        assert!(service.read_source("notes/linked").is_err());
    }
}
