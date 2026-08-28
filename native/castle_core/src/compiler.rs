use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::LazyLock,
    time::{Instant, SystemTime},
};

use anyhow::{Context, Result};
use castle_contracts::CONTENT_CONTRACT_VERSION;
use chrono::{DateTime, Utc};
use regex::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::{
    calendar::build_calendar_events,
    configuration::load_castle_configuration,
    frontmatter::parse_markdown,
    model::{
        BacklinkGroup, BacklinkOccurrence, CastleCompilation, CatalogNote, CompilationDiagnostics,
        CompilationStats, Heading, KnowledgeBase, LibraryFolder, NoteContent, NoteResource,
        OutgoingLinkOccurrence, SearchEntry, SearchIndex, SectionSummary, SourceNote,
    },
    normalization::{
        clean_inline_markdown, first_string, github_slug, humanize, locale_compare, normalize_list,
        normalize_lookup, strip_markdown,
    },
    obsidian::{create_index as create_obsidian_index, transform as transform_obsidian},
    projects::{build_projects, connect_activity},
    records::validate_records,
    relationships::build_relationship_graph,
    shortcuts::build_shortcut_collections,
    sidebar::build_sidebar,
    tasks::build_tasks,
};

const STASH_PREVIEW_LIMIT: usize = 600;
static EXCERPT_SKIP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(#{1,6}\s|[-*+]\s|\d+\.\s|>|---+$|\|)").unwrap());
static HEADING_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(#{2,4})\s+([^\r\n\u{2028}\u{2029}]+?)\s*#*\s*$").unwrap());
static MARKDOWN_LINK_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[[^\]]*\]\(([^)]+)\)").unwrap());

#[derive(Debug, Clone)]
struct SectionDefinition {
    id: &'static str,
    label: &'static str,
    icon: &'static str,
    include_when_empty: bool,
}

const SECTIONS: [SectionDefinition; 11] = [
    SectionDefinition {
        id: "personal",
        label: "Personal",
        icon: "person",
        include_when_empty: false,
    },
    SectionDefinition {
        id: "people",
        label: "People",
        icon: "heart",
        include_when_empty: false,
    },
    SectionDefinition {
        id: "wiki",
        label: "Wiki",
        icon: "book",
        include_when_empty: false,
    },
    SectionDefinition {
        id: "journal",
        label: "Journal",
        icon: "calendar",
        include_when_empty: false,
    },
    SectionDefinition {
        id: "events",
        label: "Events",
        icon: "calendar",
        include_when_empty: false,
    },
    SectionDefinition {
        id: "notes",
        label: "Notes",
        icon: "document",
        include_when_empty: false,
    },
    SectionDefinition {
        id: "stash",
        label: "Stash",
        icon: "inbox",
        include_when_empty: true,
    },
    SectionDefinition {
        id: "playlists",
        label: "Playlists",
        icon: "video",
        include_when_empty: false,
    },
    SectionDefinition {
        id: "projects",
        label: "Projects",
        icon: "folder-open",
        include_when_empty: false,
    },
    SectionDefinition {
        id: "tasks",
        label: "Tasks",
        icon: "tick-circle",
        include_when_empty: true,
    },
    SectionDefinition {
        id: "shortcuts",
        label: "Shortcuts",
        icon: "link",
        include_when_empty: false,
    },
];

#[derive(Debug, Clone)]
pub struct CompileOptions {
    pub library_root: PathBuf,
    pub repository_root: PathBuf,
    pub source_overrides: BTreeMap<PathBuf, String>,
    cached_stash_created_at: Option<HashMap<String, String>>,
}

impl CompileOptions {
    pub fn new(library_root: impl Into<PathBuf>, repository_root: impl Into<PathBuf>) -> Self {
        Self {
            library_root: library_root.into(),
            repository_root: repository_root.into(),
            source_overrides: BTreeMap::new(),
            cached_stash_created_at: None,
        }
    }

    pub(crate) fn with_cached_stash_created_at(
        mut self,
        stash_created_at: &HashMap<String, String>,
    ) -> Self {
        self.cached_stash_created_at = Some(stash_created_at.clone());
        self
    }
}

pub fn compile_library(options: &CompileOptions) -> Result<CastleCompilation> {
    let library_root = options.library_root.canonicalize().with_context(|| {
        format!(
            "could not resolve library {}",
            options.library_root.display()
        )
    })?;
    let repository_root = options
        .repository_root
        .canonicalize()
        .unwrap_or_else(|_| options.repository_root.clone());
    let stash_created_at = options
        .cached_stash_created_at
        .clone()
        .unwrap_or_else(|| load_stash_created_at(&library_root, &repository_root));
    let mut notes = Vec::new();

    for section in &SECTIONS {
        let section_root = library_root.join(section.id);
        if !section_root.is_dir() {
            continue;
        }
        for source_path in list_markdown_files(&section_root)? {
            notes.push(read_note(
                section,
                &section_root,
                &source_path,
                &library_root,
                &stash_created_at,
                &options.source_overrides,
            )?);
        }
    }

    compile_notes(library_root, repository_root, stash_created_at, notes)
}

pub(crate) fn compile_source_override(
    previous: &CastleCompilation,
    source_path: &Path,
    markdown: String,
) -> Result<CastleCompilation> {
    compile_source_overrides(
        previous,
        &BTreeMap::from([(source_path.to_owned(), markdown)]),
    )
}

pub fn compile_source_overrides(
    previous: &CastleCompilation,
    source_overrides: &BTreeMap<PathBuf, String>,
) -> Result<CastleCompilation> {
    if source_overrides.is_empty() {
        anyhow::bail!("Castle requires at least one changed source document");
    }

    let mut source_notes = previous.source_notes.clone();
    let mut changed_indexes = Vec::with_capacity(source_overrides.len());
    let mut obsidian_identity_changed = false;
    for source_path in source_overrides.keys() {
        let source_file = slash_path(source_path.strip_prefix(&previous.library_root)?);
        let section_id = source_file.split('/').next().unwrap_or_default();
        let section = SECTIONS
            .iter()
            .find(|section| section.id == section_id)
            .with_context(|| format!("unsupported Castle section for {source_file}"))?;
        let section_root = previous.library_root.join(section.id);
        let replacement = read_note(
            section,
            &section_root,
            source_path,
            &previous.library_root,
            &previous.stash_created_at,
            source_overrides,
        )?;
        let index = source_notes
            .iter()
            .position(|note| note.source_file == source_file)
            .with_context(|| format!("Castle could not find source note {source_file}"))?;
        obsidian_identity_changed |=
            obsidian_identity(&source_notes[index]) != obsidian_identity(&replacement);
        source_notes[index] = replacement;
        changed_indexes.push(index);
    }

    // These fields participate in Obsidian link resolution. When one changes,
    // every note may resolve differently, so use the conservative full path.
    if obsidian_identity_changed || previous.compiled_notes.len() != source_notes.len() {
        return compile_notes(
            previous.library_root.clone(),
            previous.repository_root.clone(),
            previous.stash_created_at.clone(),
            source_notes,
        );
    }

    let compile_started = Instant::now();
    let records_started = Instant::now();
    let (record_count, record_warnings) = validate_records(&source_notes, &previous.library_root)?;
    log_compile_phase("incremental_records", records_started);

    let transform_started = Instant::now();
    let obsidian_index =
        create_obsidian_index(&source_notes, &previous.asset_files, &previous.library_root);
    let mut compiled_notes = previous.compiled_notes.clone();
    let changed_indexes = changed_indexes.into_iter().collect::<HashSet<_>>();
    for &index in &changed_indexes {
        let source_note = &source_notes[index];
        let result = transform_obsidian(
            &source_note.content,
            &source_note.source_file,
            &obsidian_index,
            source_note.content_line_offset,
        );
        let note = &mut compiled_notes[index];
        *note = source_note.clone();
        note.content = remove_duplicate_title(result.content.trim(), &note.title);
        note.obsidian_diagnostics = result.diagnostics;
        note.obsidian_replacement_count = result.replacement_count;
        derive_note_fields(note);
    }
    update_note_connections(&mut compiled_notes, Some(&changed_indexes));
    log_compile_phase("incremental_transform_and_connections", transform_started);

    let obsidian_diagnostics = compiled_notes
        .iter()
        .flat_map(|note| note.obsidian_diagnostics.iter().cloned())
        .collect();
    let obsidian_replacement_count = compiled_notes
        .iter()
        .map(|note| note.obsidian_replacement_count)
        .sum();
    let compilation = finalize_compilation(
        previous.library_root.clone(),
        previous.repository_root.clone(),
        previous.stash_created_at.clone(),
        source_notes,
        compiled_notes,
        previous.asset_files.clone(),
        record_count,
        record_warnings,
        obsidian_diagnostics,
        obsidian_replacement_count,
    )?;
    log_compile_phase("compile_source_overrides_total", compile_started);
    Ok(compilation)
}

pub fn compile_changed_sources(
    previous: &CastleCompilation,
    source_files: &[String],
) -> Result<CastleCompilation> {
    let mut source_overrides = BTreeMap::new();
    for source_file in source_files {
        let source_path = previous.library_root.join(source_file).canonicalize()?;
        if !source_path.starts_with(&previous.library_root) {
            anyhow::bail!("Castle rejected a source path outside the library");
        }
        source_overrides.insert(source_path.clone(), fs::read_to_string(&source_path)?);
    }
    compile_source_overrides(previous, &source_overrides)
}

fn compile_notes(
    library_root: PathBuf,
    repository_root: PathBuf,
    stash_created_at: HashMap<String, String>,
    mut notes: Vec<SourceNote>,
) -> Result<CastleCompilation> {
    let compile_started = Instant::now();
    let section_order = SECTIONS
        .iter()
        .enumerate()
        .map(|(index, section)| (section.id, index))
        .collect::<HashMap<_, _>>();
    notes.sort_by(|left, right| {
        if left.section == "journal" && right.section == "journal" {
            return locale_compare(&right.relative_path, &left.relative_path);
        }
        section_order[left.section.as_str()]
            .cmp(&section_order[right.section.as_str()])
            .then_with(|| locale_compare(&left.relative_path, &right.relative_path))
    });
    let source_notes = notes.clone();

    let records_started = Instant::now();
    let (record_count, record_warnings) = validate_records(&notes, &library_root)?;
    let asset_files = list_asset_files(&library_root)?;
    log_compile_phase("records_and_assets", records_started);
    let obsidian_started = Instant::now();
    let obsidian_index = create_obsidian_index(&notes, &asset_files, &library_root);
    for note in &mut notes {
        let result = transform_obsidian(
            &note.content,
            &note.source_file,
            &obsidian_index,
            note.content_line_offset,
        );
        note.content = remove_duplicate_title(result.content.trim(), &note.title);
        note.obsidian_diagnostics = result.diagnostics;
        note.obsidian_replacement_count = result.replacement_count;
    }
    add_note_connections(&mut notes);
    log_compile_phase("obsidian_and_connections", obsidian_started);

    let derived_started = Instant::now();
    for note in &mut notes {
        derive_note_fields(note);
    }
    log_compile_phase("note_derived_fields", derived_started);

    let obsidian_diagnostics = notes
        .iter()
        .flat_map(|note| note.obsidian_diagnostics.iter().cloned())
        .collect();
    let obsidian_replacement_count = notes
        .iter()
        .map(|note| note.obsidian_replacement_count)
        .sum();

    let compilation = finalize_compilation(
        library_root,
        repository_root,
        stash_created_at,
        source_notes,
        notes,
        asset_files,
        record_count,
        record_warnings,
        obsidian_diagnostics,
        obsidian_replacement_count,
    )?;
    log_compile_phase("compile_notes_total", compile_started);
    Ok(compilation)
}

#[allow(clippy::too_many_arguments)]
fn finalize_compilation(
    library_root: PathBuf,
    repository_root: PathBuf,
    stash_created_at: HashMap<String, String>,
    source_notes: Vec<SourceNote>,
    mut notes: Vec<SourceNote>,
    asset_files: Vec<PathBuf>,
    record_count: usize,
    record_warnings: Vec<String>,
    obsidian_diagnostics: Vec<Value>,
    obsidian_replacement_count: usize,
) -> Result<CastleCompilation> {
    let domains_started = Instant::now();
    let people = notes
        .iter()
        .filter(|note| note.section == "people")
        .collect::<Vec<_>>();
    let project_notes = notes
        .iter()
        .filter(|note| first_string(note.frontmatter.get("type")) == "project")
        .collect::<Vec<_>>();
    let projects = build_projects(&project_notes, &people)?;
    let tasks = build_tasks(
        &notes
            .iter()
            .filter(|note| note.section == "tasks")
            .collect::<Vec<_>>(),
        &people,
        &project_notes,
    )?;
    let calendar_events = build_calendar_events(
        &notes
            .iter()
            .filter(|note| note.section == "events")
            .collect::<Vec<_>>(),
        &people,
        &project_notes,
    )?;
    let projects = connect_activity(projects, &tasks, &calendar_events);
    let shortcut_collections = build_shortcut_collections(
        &notes
            .iter()
            .filter(|note| note.section == "shortcuts")
            .collect::<Vec<_>>(),
    )?;
    let configuration = load_castle_configuration(&repository_root)?;
    let owner = (!configuration.owner_note_id.is_empty())
        .then(|| {
            notes
                .iter()
                .find(|note| note.id == configuration.owner_note_id)
        })
        .flatten();
    let relationship_graph = build_relationship_graph(
        &people,
        owner,
        &configuration.owner_display_name,
        &configuration.owner_avatar_url,
    )?;
    drop(project_notes);
    drop(people);
    log_compile_phase("domain_projections", domains_started);

    let resources_started = Instant::now();
    let generated_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let note_resources = notes
        .iter_mut()
        .map(create_note_resource)
        .collect::<Result<Vec<_>>>()?;
    let sections = SECTIONS
        .iter()
        .filter_map(|section| {
            let count = notes
                .iter()
                .filter(|note| note.section == section.id)
                .count();
            (count > 0 || section.include_when_empty).then(|| SectionSummary {
                id: section.id.to_owned(),
                label: section.label.to_owned(),
                icon: section.icon.to_owned(),
                count,
            })
        })
        .collect::<Vec<_>>();
    let folders = collect_library_folders(&library_root, &notes)?;
    let catalog_notes = notes.iter().map(to_catalog_note).collect::<Vec<_>>();
    let source_files_by_note_id = notes
        .iter()
        .map(|note| (note.id.clone(), note.source_file.clone()))
        .collect();
    let search_index = SearchIndex {
        generated_at: generated_at.clone(),
        entries: notes
            .iter()
            .map(|note| SearchEntry {
                id: note.id.clone(),
                text: note.search_text.clone(),
            })
            .collect(),
    };
    let knowledge_base = KnowledgeBase {
        contract_version: CONTENT_CONTRACT_VERSION,
        generated_at,
        sections,
        folders,
        notes: catalog_notes,
        calendar_events,
        tasks,
        projects,
        shortcut_collections,
    };
    let stats = CompilationStats {
        note_count: notes.len(),
        section_count: knowledge_base.sections.len(),
        record_count,
        project_count: knowledge_base.projects.len(),
        task_count: knowledge_base.tasks.len(),
        relationship_node_count: relationship_graph["peopleCount"]
            .as_u64()
            .unwrap_or_default() as usize,
        calendar_event_count: knowledge_base.calendar_events.len(),
        obsidian_replacement_count,
    };
    let compilation = CastleCompilation {
        knowledge_base,
        note_resources,
        relationship_graph,
        search_index,
        library_root,
        repository_root,
        asset_files,
        source_files_by_note_id,
        diagnostics: CompilationDiagnostics {
            obsidian: obsidian_diagnostics,
            record_warnings,
        },
        stats,
        compiled_notes: notes.clone(),
        source_notes,
        stash_created_at,
    };
    log_compile_phase("resources_and_catalog", resources_started);
    Ok(compilation)
}

fn collect_library_folders(
    library_root: &Path,
    notes: &[SourceNote],
) -> Result<Vec<LibraryFolder>> {
    let mut folders = Vec::new();

    for section in SECTIONS.iter() {
        let section_root = library_root.join(section.id);
        if !section_root.is_dir() {
            continue;
        }

        for entry in WalkDir::new(&section_root)
            .min_depth(1)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        {
            let entry = entry?;
            if !entry.file_type().is_dir() {
                continue;
            }
            let directory = entry
                .path()
                .strip_prefix(&section_root)?
                .components()
                .filter_map(|component| component.as_os_str().to_str().map(str::to_owned))
                .collect::<Vec<_>>();
            if directory.is_empty() {
                continue;
            }
            let entry_count = fs::read_dir(entry.path())?.count();
            let note_count = notes
                .iter()
                .filter(|note| {
                    note.section == section.id
                        && note
                            .source_file
                            .split('/')
                            .skip(1)
                            .take(directory.len())
                            .eq(directory.iter().map(String::as_str))
                })
                .count();
            folders.push(LibraryFolder {
                section_id: section.id.to_owned(),
                directory,
                entry_count,
                note_count,
            });
        }
    }

    folders.sort_by(|left, right| {
        left.section_id
            .cmp(&right.section_id)
            .then_with(|| left.directory.cmp(&right.directory))
    });
    Ok(folders)
}

fn log_compile_phase(phase: &str, started: Instant) {
    if std::env::var_os("CASTLE_PROFILE_MUTATIONS").is_some() {
        eprintln!(
            "[castle:compile-profile] {phase}={}ms",
            started.elapsed().as_secs_f64() * 1_000.0
        );
    }
}

fn obsidian_identity(note: &SourceNote) -> (&str, &str, &str, &str, &str, &[String]) {
    (
        &note.id,
        &note.section,
        &note.source_file,
        &note.route,
        &note.title,
        &note.aliases,
    )
}

fn derive_note_fields(note: &mut SourceNote) {
    note.headings = extract_headings(&note.content);
    note.excerpt = create_excerpt(&note.content);
    note.preview = (note.section == "stash").then(|| create_stash_preview(&note.content));
    note.word_count = count_words(&note.content);
    note.reading_minutes = usize::max(1, note.word_count.div_ceil(220));
    note.search_text = create_search_text(note);
}

fn list_markdown_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|entry| {
            entry.path() == root || !entry.file_name().to_string_lossy().starts_with('.')
        })
    {
        let entry = entry?;
        if entry.path() != root && entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if entry.file_type().is_file()
            && matches!(
                entry.path().extension().and_then(|value| value.to_str()),
                Some("md" | "mdx")
            )
        {
            files.push(entry.path().to_owned());
        }
    }
    Ok(files)
}

fn read_note(
    section: &SectionDefinition,
    section_root: &Path,
    source_path: &Path,
    library_root: &Path,
    stash_created_at: &HashMap<String, String>,
    source_overrides: &BTreeMap<PathBuf, String>,
) -> Result<SourceNote> {
    let absolute_path = source_path.canonicalize()?;
    let source = source_overrides.get(&absolute_path).cloned().unwrap_or(
        fs::read_to_string(source_path)
            .with_context(|| format!("could not read {}", source_path.display()))?,
    );
    let mut parsed =
        parse_markdown(&source).with_context(|| format!("{}", source_path.display()))?;
    if section.id == "people" {
        let status = first_string(parsed.frontmatter.get("status"));
        if let Some(frontmatter) = parsed.frontmatter.as_object_mut() {
            if status == "former" {
                frontmatter.insert("status".to_owned(), Value::String(status));
            } else {
                frontmatter.shift_remove("status");
            }
        }
    }
    let metadata = fs::metadata(source_path)?;
    let content_line_offset = source
        .find(&parsed.content)
        .filter(|offset| *offset > 0)
        .map(|offset| source[..offset].matches('\n').count())
        .unwrap_or(0);
    let relative_path = slash_path(source_path.strip_prefix(section_root)?);
    let source_file = slash_path(source_path.strip_prefix(library_root)?);
    let relative_without_extension = relative_path
        .strip_suffix(".mdx")
        .or_else(|| relative_path.strip_suffix(".md"))
        .unwrap_or(&relative_path);
    let basename = relative_without_extension
        .rsplit('/')
        .next()
        .unwrap_or(relative_without_extension);
    let fallback_title = if section.id == "journal" {
        basename.to_owned()
    } else {
        humanize(basename)
    };
    let heading_title = first_heading(&parsed.content);
    let title = ["name", "title"]
        .iter()
        .map(|key| first_string(parsed.frontmatter.get(*key)))
        .find(|value| !value.is_empty())
        .or_else(|| (!heading_title.is_empty()).then_some(heading_title))
        .unwrap_or(fallback_title);
    let id = first_string(parsed.frontmatter.get("id"));
    let id = if id.is_empty() {
        format!("{}/{}", section.id, relative_without_extension)
    } else {
        id
    };
    let route = format!(
        "/note/{}/{}",
        section.id,
        relative_without_extension
            .split('/')
            .map(github_slug)
            .collect::<Vec<_>>()
            .join("/")
    );
    let tags = normalize_list(parsed.frontmatter.get("tags"));
    let aliases = normalize_aliases(
        parsed
            .frontmatter
            .get("aliases")
            .or_else(|| parsed.frontmatter.get("alias")),
    );
    let status =
        normalize_person_status(section.id, first_string(parsed.frontmatter.get("status")));
    let avatar_url = resolve_asset_url(parsed.frontmatter.get("avatar"), &source_file);
    let modified_at = note_modified_at(&parsed.frontmatter, &metadata)?;
    let content = parsed.content;
    let created_at = (section.id == "stash").then(|| {
        stash_created_at
            .get(&source_file)
            .cloned()
            .unwrap_or_else(|| {
                system_time_iso(
                    metadata
                        .created()
                        .unwrap_or_else(|_| metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
                )
            })
    });

    Ok(SourceNote {
        id,
        section: section.id.to_owned(),
        section_label: section.label.to_owned(),
        relative_path,
        source_file,
        route,
        title,
        excerpt: String::new(),
        preview: None,
        headings: Vec::new(),
        tags,
        aliases,
        status,
        avatar_url,
        created_at,
        modified_at,
        word_count: 0,
        reading_minutes: 0,
        pinned: parsed
            .frontmatter
            .get("pinned")
            .or_else(|| parsed.frontmatter.get("favorite"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        content,
        outgoing_note_ids: Vec::new(),
        outgoing_link_occurrences: Vec::new(),
        backlink_note_ids: Vec::new(),
        backlinks: Vec::new(),
        related_note_ids: Vec::new(),
        content_line_offset,
        content_path: String::new(),
        frontmatter: parsed.frontmatter,
        search_text: String::new(),
        obsidian_diagnostics: Vec::new(),
        obsidian_replacement_count: 0,
    })
}

fn normalize_aliases(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| first_string(Some(value)))
            .filter(|value| !value.is_empty())
            .collect(),
        Some(Value::String(value)) => value
            .trim_matches(['[', ']'])
            .split(',')
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

fn normalize_person_status(section: &str, status: String) -> String {
    if section != "people" {
        return status;
    }
    match status.as_str() {
        "" | "active" | "current" => String::new(),
        "inactive" => "former".to_owned(),
        _ => status,
    }
}

fn first_heading(content: &str) -> String {
    content
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .find(|line| !line.trim().is_empty())
        .and_then(|line| line.strip_prefix("# "))
        .map(clean_inline_markdown)
        .unwrap_or_default()
}

fn remove_duplicate_title(content: &str, title: &str) -> String {
    let mut lines = content
        .split('\n')
        .map(|line| line.trim_end_matches('\r').to_owned())
        .collect::<Vec<_>>();
    if let Some(index) = lines.iter().position(|line| !line.trim().is_empty())
        && let Some(heading) = lines[index].strip_prefix("# ")
        && normalize_lookup(&clean_inline_markdown(heading)) == normalize_lookup(title)
    {
        lines.remove(index);
    }
    lines.join("\n").trim_start().to_owned()
}

fn extract_headings(content: &str) -> Vec<Heading> {
    // JavaScript's `.` does not match its four line terminators unless the
    // dotAll flag is enabled. Rust's regex engine only excludes `\n`, so spell
    // the character class out to preserve the legacy compiler contract.
    let mut inside_fence = false;
    let mut seen = HashMap::<String, usize>::new();
    let mut headings = Vec::new();
    for (index, line) in content
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .enumerate()
    {
        if line.trim_start().starts_with("```") {
            inside_fence = !inside_fence;
            continue;
        }
        if inside_fence {
            continue;
        }
        let Some(captures) = HEADING_PATTERN.captures(line) else {
            continue;
        };
        let label = clean_inline_markdown(&captures[2]);
        let base_id = github_slug(&label);
        let occurrence = seen.entry(base_id.clone()).or_insert(0);
        let id = if *occurrence == 0 {
            base_id
        } else {
            format!("{}-{}", base_id, occurrence)
        };
        *occurrence += 1;
        headings.push(Heading {
            depth: captures[1].len(),
            label,
            id,
            line: index + 1,
        });
    }
    headings
}

fn create_excerpt(content: &str) -> String {
    let mut inside_fence = false;
    for line in content.split('\n').map(|line| line.trim_end_matches('\r')) {
        if line.trim_start().starts_with("```") {
            inside_fence = !inside_fence;
            continue;
        }
        if inside_fence {
            continue;
        }
        let trimmed = line.trim();
        if trimmed.chars().count() <= 24 || EXCERPT_SKIP.is_match(trimmed) {
            continue;
        }
        // Array.find() in the JavaScript compiler stops at the first source
        // line that passes the structural predicate. If stripping that line
        // (for example, an image-only line) produces no text, the result is
        // the fallback rather than the next paragraph.
        let plain = if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
            trimmed.to_owned()
        } else {
            strip_markdown(trimmed)
        };
        if plain.is_empty() {
            return "Open this note to read more.".to_owned();
        }
        if plain.chars().count() > 180 {
            return format!(
                "{}…",
                plain.chars().take(177).collect::<String>().trim_end()
            );
        }
        return plain;
    }
    "Open this note to read more.".to_owned()
}

fn create_stash_preview(content: &str) -> String {
    let normalized = content.trim();
    if normalized.chars().count() <= STASH_PREVIEW_LIMIT {
        return normalized.to_owned();
    }
    format!(
        "{}…",
        normalized
            .chars()
            .take(STASH_PREVIEW_LIMIT - 1)
            .collect::<String>()
            .trim_end()
    )
}

fn resolve_asset_url(value: Option<&Value>, source_file: &str) -> String {
    let mut target = first_string(value);
    if target.is_empty() {
        return String::new();
    }
    if let Some(inner) = target
        .strip_prefix("[[")
        .and_then(|value| value.strip_suffix("]]"))
    {
        target = inner.split('|').next().unwrap_or(inner).to_owned();
    }
    if target.starts_with("data:")
        || target.starts_with("http://")
        || target.starts_with("https://")
    {
        return target;
    }
    if target.starts_with('/') {
        return uri_path(&target);
    }
    let normalized = normalize_path(&target);
    if normalized.starts_with("assets/") {
        return uri_path(&format!("/{normalized}"));
    }
    let source_directory = source_file
        .rsplit_once('/')
        .map(|(directory, _)| directory)
        .unwrap_or("");
    uri_path(&format!(
        "/content-assets/{}",
        normalize_path(&format!("{source_directory}/{normalized}"))
    ))
}

fn uri_path(value: &str) -> String {
    let mut result = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b";/?:@&=+$,-_.!~*'()#".contains(&byte) {
            result.push(byte as char);
        } else {
            result.push_str(&format!("%{byte:02X}"));
        }
    }
    result
}

fn normalize_path(value: &str) -> String {
    let mut parts = Vec::new();
    let normalized = value.replace('\\', "/");
    for part in normalized.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    parts.join("/")
}

fn note_modified_at(frontmatter: &Value, metadata: &fs::Metadata) -> Result<String> {
    for key in ["updated", "modified"] {
        let value = first_string(frontmatter.get(key));
        if !value.is_empty() {
            return Ok(parse_or_original_datetime(&value));
        }
    }
    if first_string(frontmatter.get("type")) != "task" {
        let value = first_string(frontmatter.get("date"));
        if !value.is_empty() {
            return Ok(parse_or_original_datetime(&value));
        }
    }
    Ok(system_time_iso(metadata.modified()?))
}

fn parse_or_original_datetime(value: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|value| {
            value
                .with_timezone(&Utc)
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        })
        .unwrap_or_else(|_| {
            chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .ok()
                .and_then(|date| date.and_hms_opt(0, 0, 0))
                .map(|date| {
                    date.and_utc()
                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                })
                .unwrap_or_else(|| value.to_owned())
        })
}

fn system_time_iso(value: SystemTime) -> String {
    let duration = value
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let rounded_millis = duration.as_secs() * 1000
        + u64::from(duration.subsec_nanos()) / 1_000_000
        + u64::from(duration.subsec_nanos() % 1_000_000 >= 500_000);
    DateTime::<Utc>::from(SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(rounded_millis))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn looks_like_asset(value: &str) -> bool {
    Path::new(value)
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_lowercase().as_str(),
                "png"
                    | "jpg"
                    | "jpeg"
                    | "gif"
                    | "svg"
                    | "webp"
                    | "pdf"
                    | "mp3"
                    | "mp4"
                    | "wav"
                    | "m4a"
                    | "mov"
            )
        })
}

fn add_note_connections(notes: &mut [SourceNote]) {
    update_note_connections(notes, None);
}

fn update_note_connections(notes: &mut [SourceNote], changed_indexes: Option<&HashSet<usize>>) {
    let by_route = notes
        .iter()
        .enumerate()
        .map(|(index, note)| (note.route.clone(), index))
        .collect::<HashMap<_, _>>();
    let by_source = notes
        .iter()
        .enumerate()
        .map(|(index, note)| (note.source_file.clone(), index))
        .collect::<HashMap<_, _>>();
    let by_id = notes
        .iter()
        .enumerate()
        .map(|(index, note)| (note.id.clone(), index))
        .collect::<HashMap<_, _>>();
    let mut outgoing = notes
        .iter()
        .map(|note| {
            note.outgoing_note_ids
                .iter()
                .filter_map(|id| by_id.get(id).copied())
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    for index in 0..notes.len() {
        if changed_indexes.is_some_and(|changed_indexes| !changed_indexes.contains(&index)) {
            continue;
        }
        let note = &notes[index];
        let source_dir = note
            .source_file
            .rsplit_once('/')
            .map(|(dir, _)| dir)
            .unwrap_or("");
        let mut seen = HashSet::new();
        outgoing[index].clear();
        let mut occurrences = Vec::new();
        for captures in MARKDOWN_LINK_PATTERN.captures_iter(&note.content) {
            let Some(link_match) = captures.get(0) else {
                continue;
            };
            let href = captures[1].trim();
            if href.starts_with('#')
                || href.starts_with("http:")
                || href.starts_with("https:")
                || href.starts_with("mailto:")
                || href.starts_with("tel:")
            {
                continue;
            }
            let pathname = href
                .split(['#', '?'])
                .next()
                .unwrap_or("")
                .trim_end_matches('/');
            let target = if pathname.starts_with("/note/") {
                by_route.get(pathname).copied()
            } else if pathname.ends_with(".md") || pathname.ends_with(".mdx") {
                by_source
                    .get(&normalize_path(&format!("{source_dir}/{pathname}")))
                    .copied()
            } else {
                None
            };
            if let Some(target) = target.filter(|target| *target != index) {
                if seen.insert(target) {
                    outgoing[index].push(target);
                }
                occurrences.push(OutgoingLinkOccurrence {
                    target_note_id: notes[target].id.clone(),
                    anchor_id: link_occurrence_anchor(&note.content, link_match.start()),
                    context: link_sentence_context(&note.content, link_match),
                });
            }
        }
        notes[index].outgoing_link_occurrences = occurrences;
    }
    let mut backlinks = vec![Vec::<usize>::new(); notes.len()];
    for (source, targets) in outgoing.iter().enumerate() {
        for target in targets {
            backlinks[*target].push(source);
        }
    }
    let mut by_directory = HashMap::<String, Vec<usize>>::new();
    let mut by_section = HashMap::<String, Vec<usize>>::new();
    for (index, note) in notes.iter().enumerate() {
        by_directory
            .entry(note_directory(note).to_owned())
            .or_default()
            .push(index);
        by_section
            .entry(note.section.clone())
            .or_default()
            .push(index);
    }
    for index in 0..notes.len() {
        notes[index].outgoing_note_ids = outgoing[index]
            .iter()
            .map(|target| notes[*target].id.clone())
            .collect();
        notes[index].backlink_note_ids = backlinks[index]
            .iter()
            .map(|source| notes[*source].id.clone())
            .collect();
        notes[index].backlinks = backlinks[index]
            .iter()
            .map(|source| BacklinkGroup {
                source_note_id: notes[*source].id.clone(),
                occurrences: notes[*source]
                    .outgoing_link_occurrences
                    .iter()
                    .filter(|occurrence| occurrence.target_note_id == notes[index].id)
                    .map(|occurrence| BacklinkOccurrence {
                        anchor_id: occurrence.anchor_id.clone(),
                        context: occurrence.context.clone(),
                    })
                    .collect(),
            })
            .filter(|backlink| !backlink.occurrences.is_empty())
            .collect();
        let mut related = outgoing[index]
            .iter()
            .chain(backlinks[index].iter())
            .copied()
            .collect::<Vec<_>>();
        let mut seen = related.iter().copied().collect::<HashSet<_>>();
        seen.insert(index);
        let source_dir = note_directory(&notes[index]);
        for &candidate in by_directory
            .get(source_dir)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            if related.len() >= 6 {
                break;
            }
            if !seen.contains(&candidate) {
                related.push(candidate);
                seen.insert(candidate);
            }
        }
        for &candidate in by_section
            .get(&notes[index].section)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            if related.len() >= 6 {
                break;
            }
            if !seen.contains(&candidate) {
                related.push(candidate);
                seen.insert(candidate);
            }
        }
        notes[index].related_note_ids = related
            .into_iter()
            .take(6)
            .map(|candidate| notes[candidate].id.clone())
            .collect();
    }
}

fn link_occurrence_anchor(content: &str, byte_offset: usize) -> String {
    let before = &content[..byte_offset];
    let line = before.bytes().filter(|byte| *byte == b'\n').count() + 1;
    let line_start = before.rfind('\n').map_or(0, |offset| offset + 1);
    let column = content[line_start..byte_offset].encode_utf16().count() + 1;
    format!("link-occurrence-{line}-{column}")
}

fn link_sentence_context(content: &str, link_match: regex::Match<'_>) -> String {
    const START_MARKER: &str = "CASTLEBACKLINKSTART";
    const END_MARKER: &str = "CASTLEBACKLINKEND";

    let paragraph_start = content[..link_match.start()]
        .rfind("\n\n")
        .map_or(0, |offset| offset + 2);
    let paragraph_end = content[link_match.end()..]
        .find("\n\n")
        .map_or(content.len(), |offset| link_match.end() + offset);
    let paragraph = &content[paragraph_start..paragraph_end];
    let link_start = link_match.start() - paragraph_start;
    let link_end = link_match.end() - paragraph_start;
    let link_label = link_match
        .as_str()
        .strip_prefix('[')
        .and_then(|value| value.split_once("](").map(|(label, _)| label))
        .unwrap_or("link");
    let marked = format!(
        "{}{}{}{}{}",
        &paragraph[..link_start],
        START_MARKER,
        link_label,
        END_MARKER,
        &paragraph[link_end..]
    );
    let cleaned = clean_inline_markdown(&marked)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let Some(marker_start) = cleaned.find(START_MARKER) else {
        return clean_inline_markdown(link_label);
    };
    let marker_content_start = marker_start + START_MARKER.len();
    let Some(relative_marker_end) = cleaned[marker_content_start..].find(END_MARKER) else {
        return clean_inline_markdown(link_label);
    };
    let marker_end = marker_content_start + relative_marker_end;
    let sentence_start = previous_sentence_boundary(&cleaned, marker_start);
    let sentence_end = next_sentence_boundary(&cleaned, marker_end + END_MARKER.len());
    cleaned[sentence_start..sentence_end]
        .replace(START_MARKER, "")
        .replace(END_MARKER, "")
        .trim()
        .to_owned()
}

fn previous_sentence_boundary(value: &str, before: usize) -> usize {
    let prefix = &value[..before];
    for (offset, character) in prefix.char_indices().rev() {
        if matches!(character, '.' | '!' | '?' | '。' | '！' | '？') {
            return offset + character.len_utf8();
        }
    }
    0
}

fn next_sentence_boundary(value: &str, after: usize) -> usize {
    for (relative_offset, character) in value[after..].char_indices() {
        if matches!(character, '.' | '!' | '?' | '。' | '！' | '？') {
            return after + relative_offset + character.len_utf8();
        }
    }
    value.len()
}

fn note_directory(note: &SourceNote) -> &str {
    note.source_file
        .rsplit_once('/')
        .map(|(directory, _)| directory)
        .unwrap_or("")
}

fn count_words(content: &str) -> usize {
    strip_markdown(content).split_whitespace().count()
}

fn create_search_text(note: &SourceNote) -> String {
    let frontmatter = note
        .frontmatter
        .as_object()
        .map(|object| {
            object
                .values()
                .flat_map(|value| match value {
                    Value::Array(values) => values.iter().collect::<Vec<_>>(),
                    value => vec![value],
                })
                .map(js_string)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();
    [
        note.title.clone(),
        note.section_label.clone(),
        note.relative_path.clone(),
        note.aliases.join(" "),
        note.tags.join(" "),
        frontmatter,
        strip_markdown(&note.content),
    ]
    .join(" ")
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ")
}

fn js_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.clone(),
        Value::Array(values) => values.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

fn load_stash_created_at(library_root: &Path, repository_root: &Path) -> HashMap<String, String> {
    let Ok(relative_library_root) = library_root.strip_prefix(repository_root) else {
        return HashMap::new();
    };
    let relative_library_root = slash_path(relative_library_root);
    let stash_path = if relative_library_root.is_empty() {
        "stash".to_owned()
    } else {
        format!("{relative_library_root}/stash")
    };
    let Ok(output) = Command::new("git")
        .args([
            "-c",
            "core.quotePath=false",
            "log",
            "--diff-filter=A",
            "--format=%x1e%aI",
            "--name-only",
            "--",
            &stash_path,
        ])
        .current_dir(repository_root)
        .output()
    else {
        return HashMap::new();
    };
    if !output.status.success() {
        return HashMap::new();
    }
    let history = String::from_utf8_lossy(&output.stdout);
    parse_stash_git_history(&history, &relative_library_root)
}

fn parse_stash_git_history(history: &str, relative_library_root: &str) -> HashMap<String, String> {
    let source_prefix = if relative_library_root.is_empty() {
        String::new()
    } else {
        format!("{relative_library_root}/")
    };
    let stash_prefix = format!("{source_prefix}stash/");
    let mut created_at = HashMap::new();
    for record in history.split('\u{1e}') {
        let mut lines = record.lines();
        let Some(raw_date) = lines.next() else {
            continue;
        };
        let Ok(date) = DateTime::parse_from_rfc3339(raw_date.trim()) else {
            continue;
        };
        let timestamp = date
            .with_timezone(&Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        for raw_path in lines {
            let path = raw_path.trim().replace('\\', "/");
            if !path.starts_with(&stash_prefix)
                || !(path.ends_with(".md") || path.ends_with(".mdx"))
            {
                continue;
            }
            created_at.insert(path[source_prefix.len()..].to_owned(), timestamp.clone());
        }
    }
    created_at
}

fn create_note_resource(note: &mut SourceNote) -> Result<NoteResource> {
    let content = NoteContent {
        id: note.id.clone(),
        content: note.content.clone(),
        headings: note.headings.clone(),
        outgoing_note_ids: note.outgoing_note_ids.clone(),
        backlink_note_ids: note.backlink_note_ids.clone(),
        backlinks: note.backlinks.clone(),
        related_note_ids: note.related_note_ids.clone(),
    };
    let serialized = serde_json::to_vec(&content)?;
    let hash = format!("{:x}", Sha256::digest(serialized));
    let content_path = format!("/generated/notes/{hash}.json");
    note.content_path = content_path.clone();
    Ok(NoteResource {
        content_path,
        content,
    })
}

fn to_catalog_note(note: &SourceNote) -> CatalogNote {
    CatalogNote {
        id: note.id.clone(),
        section: note.section.clone(),
        section_label: note.section_label.clone(),
        relative_path: note.relative_path.clone(),
        source_file: note.source_file.clone(),
        route: note.route.clone(),
        title: note.title.clone(),
        excerpt: note.excerpt.clone(),
        preview: note.preview.clone().filter(|value| !value.is_empty()),
        tags: note.tags.clone(),
        aliases: note.aliases.clone(),
        status: note.status.clone(),
        avatar_url: note.avatar_url.clone(),
        created_at: note.created_at.clone().filter(|value| !value.is_empty()),
        modified_at: note.modified_at.clone(),
        content_path: note.content_path.clone(),
        word_count: note.word_count,
        reading_minutes: note.reading_minutes,
        pinned: note.pinned,
        sidebar: build_sidebar(note),
    }
}

fn list_asset_files(library_root: &Path) -> Result<Vec<PathBuf>> {
    let mut assets = Vec::new();
    for entry in WalkDir::new(library_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.path() == library_root || !entry.file_name().to_string_lossy().starts_with('.')
        })
    {
        let entry = entry?;
        if entry.file_type().is_file() && looks_like_asset(&entry.file_name().to_string_lossy()) {
            assets.push(entry.path().to_owned());
        }
    }
    assets.sort();
    Ok(assets)
}

fn slash_path(path: &Path) -> String {
    path.components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn preserves_short_stash_content_and_bounds_long_previews() {
        let short = "First line\n\nhttps://example.com/something-useful";
        assert_eq!(create_stash_preview(short), short);
        let preview = create_stash_preview(&"a".repeat(STASH_PREVIEW_LIMIT + 20));
        assert_eq!(preview.chars().count(), STASH_PREVIEW_LIMIT);
        assert!(preview.ends_with('…'));
    }

    #[test]
    fn preserves_url_punctuation_in_excerpts() {
        let url = "https://www.youtube.com/watch?v=Fw8JQ5Q-ZwU";
        assert_eq!(create_excerpt(&format!("# Video\n\n{url}\n")), url);
    }

    #[test]
    fn includes_playlist_notes_as_an_ordinary_library_section() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        let playlists = library.join("playlists").join("visual_math");
        fs::create_dir_all(&playlists).unwrap();
        fs::write(
            playlists.join("linear_algebra.md"),
            "# Essence of linear algebra\n\nhttps://www.youtube.com/watch?v=Fw8JQ5Q-ZwU\n",
        )
        .unwrap();

        let compilation = compile_library(&CompileOptions::new(&library, root.path())).unwrap();

        assert!(
            compilation
                .knowledge_base
                .sections
                .iter()
                .any(|section| section.id == "playlists" && section.count == 1)
        );
        assert!(compilation.knowledge_base.notes.iter().any(|note| {
            note.section == "playlists"
                && note.relative_path == "visual_math/linear_algebra.md"
                && note.excerpt == "https://www.youtube.com/watch?v=Fw8JQ5Q-ZwU"
        }));
    }

    #[test]
    fn parses_oldest_stash_addition_from_batched_git_history() {
        let history = [
            "\u{1e}2026-08-02T12:00:00+02:00",
            "",
            "library/stash/first.md",
            "library/stash/zażółć.md",
            "library/notes/not-stash.md",
            "\u{1e}2026-08-01T09:30:00+02:00",
            "",
            "library/stash/first.md",
            "library/stash/.gitkeep",
        ]
        .join("\n");
        let created = parse_stash_git_history(&history, "library");
        assert_eq!(
            created.get("stash/first.md").map(String::as_str),
            Some("2026-08-01T07:30:00.000Z")
        );
        assert_eq!(
            created.get("stash/zażółć.md").map(String::as_str),
            Some("2026-08-02T10:00:00.000Z")
        );
    }

    #[test]
    fn groups_backlink_occurrences_with_sentence_context_and_stable_anchors() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        let notes = library.join("notes");
        fs::create_dir_all(&notes).unwrap();
        fs::write(
            notes.join("a.md"),
            "# A\n\nOpening sentence. Zażółć 😀 [B](b.md) appears here. A second [B mention](b.md) closes the thought.\n",
        )
        .unwrap();
        fs::write(notes.join("b.md"), "# B\n\nTarget body.\n").unwrap();

        let compilation = compile_library(&CompileOptions::new(&library, root.path())).unwrap();
        let source_id = compilation
            .knowledge_base
            .notes
            .iter()
            .find(|note| note.title == "A")
            .map(|note| note.id.as_str())
            .unwrap();
        let target = compilation
            .note_resources
            .iter()
            .find(|resource| {
                compilation
                    .knowledge_base
                    .notes
                    .iter()
                    .any(|note| note.title == "B" && note.id == resource.content.id)
            })
            .unwrap();
        let backlink = target.content.backlinks.first().unwrap();

        assert_eq!(backlink.source_note_id, source_id);
        assert_eq!(backlink.occurrences.len(), 2);
        assert_eq!(backlink.occurrences[0].context, "Zażółć 😀 B appears here.");
        assert_eq!(
            backlink.occurrences[1].context,
            "A second B mention closes the thought."
        );
        assert_ne!(
            backlink.occurrences[0].anchor_id,
            backlink.occurrences[1].anchor_id
        );
        assert!(
            backlink
                .occurrences
                .iter()
                .all(|occurrence| occurrence.anchor_id.starts_with("link-occurrence-"))
        );
    }

    #[test]
    fn incremental_source_compilation_matches_a_full_compilation() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        let notes = library.join("notes");
        fs::create_dir_all(&notes).unwrap();
        fs::write(notes.join("a.md"), "# A\n\n[[b]]\n").unwrap();
        fs::write(notes.join("b.md"), "# B\n\nInitial body.\n").unwrap();
        let previous = compile_library(&CompileOptions::new(&library, root.path())).unwrap();
        let source_path = notes.join("a.md").canonicalize().unwrap();
        let markdown = "# A\n\nA changed body without the old link.\n".to_owned();
        let overrides = BTreeMap::from([(source_path, markdown)]);

        let incremental = compile_source_overrides(&previous, &overrides).unwrap();
        let mut options = CompileOptions::new(&library, root.path());
        options.source_overrides = overrides;
        let full = compile_library(&options).unwrap();

        assert_eq!(
            visible_compilation(&incremental),
            visible_compilation(&full)
        );
    }

    fn visible_compilation(compilation: &CastleCompilation) -> Value {
        let mut knowledge_base = serde_json::to_value(&compilation.knowledge_base).unwrap();
        knowledge_base["generatedAt"] = json!("normalized");
        let mut search_index = serde_json::to_value(&compilation.search_index).unwrap();
        search_index["generatedAt"] = json!("normalized");
        json!({
            "knowledgeBase": knowledge_base,
            "searchIndex": search_index,
            "relationshipGraph": compilation.relationship_graph,
            "noteResources": compilation.note_resources.iter().map(|resource| json!({
                "contentPath": resource.content_path,
                "content": resource.content,
            })).collect::<Vec<_>>(),
            "diagnostics": compilation.diagnostics,
            "stats": compilation.stats,
            "sourceFiles": compilation.source_files_by_note_id,
        })
    }
}
