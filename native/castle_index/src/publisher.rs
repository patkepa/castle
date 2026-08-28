use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, anyhow, bail, ensure};
use castle_core::{IndexProjection, normalize_search_text};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use turso::{Builder, Connection, params};

use crate::{
    chunking::{CHUNKING_VERSION, chunk_note},
    embedding::EmbeddingSet,
    schema::{INDEX_SCHEMA_VERSION, SCHEMA_V2},
};

const MANIFEST_SCHEMA_VERSION: u32 = 2;
const RETAINED_GENERATIONS: usize = 2;

#[derive(Debug, Clone)]
pub struct IndexPublisherOptions {
    pub indexes_root: PathBuf,
    pub library_key: String,
}

#[derive(Debug, Clone)]
pub struct IndexPublisher {
    options: IndexPublisherOptions,
    publication_lock: Arc<Mutex<()>>,
    resolution_cache: Arc<Mutex<Option<ResolvedIndex>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CurrentIndexManifest {
    pub manifest_schema_version: u32,
    pub index_schema_version: u32,
    pub generation: String,
    pub database_file: String,
    pub source_fingerprint: String,
    pub published_at: String,
    pub semantic_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub manifest: CurrentIndexManifest,
    pub database_path: PathBuf,
    pub database_bytes: u64,
    pub build_milliseconds: u128,
    pub note_count: usize,
    pub link_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub state: &'static str,
    pub manifest: Option<CurrentIndexManifest>,
    pub database_path: Option<PathBuf>,
    pub recovered_manifest: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedIndex {
    pub manifest: CurrentIndexManifest,
    pub database_path: PathBuf,
    pub recovered_manifest: bool,
}

pub fn create_library_key(library_root: &Path) -> Result<String> {
    let canonical = library_root.canonicalize().with_context(|| {
        format!(
            "Castle could not resolve library root {}",
            library_root.display()
        )
    })?;
    let digest = Sha256::digest(canonical.to_string_lossy().as_bytes());
    Ok(format!("{:x}", digest)[..24].to_owned())
}

impl IndexPublisher {
    pub fn new(options: IndexPublisherOptions) -> Result<Self> {
        ensure!(
            !options.library_key.is_empty()
                && options
                    .library_key
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '_'),
            "Castle index library key must contain only ASCII letters, numbers, or underscores"
        );
        Ok(Self {
            options,
            publication_lock: Arc::new(Mutex::new(())),
            resolution_cache: Arc::new(Mutex::new(None)),
        })
    }

    pub fn library_directory(&self) -> PathBuf {
        self.options.indexes_root.join(&self.options.library_key)
    }

    pub fn publish(&self, projection: &IndexProjection) -> Result<PublishResult> {
        self.publish_with_embeddings(projection, None)
    }

    pub fn publish_with_embeddings(
        &self,
        projection: &IndexProjection,
        embeddings: Option<&EmbeddingSet>,
    ) -> Result<PublishResult> {
        ensure!(
            projection.schema_version == castle_core::INDEX_PROJECTION_SCHEMA_VERSION,
            "Castle index projection schema is incompatible"
        );
        ensure!(
            embeddings.is_none_or(EmbeddingSet::is_complete),
            "Castle cannot publish an incomplete embedding generation"
        );
        let _publication_guard = self
            .publication_lock
            .lock()
            .map_err(|_| anyhow!("Castle index publication lock was poisoned"))?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .context("Castle could not start the index publisher runtime")?;
        runtime.block_on(self.publish_async(projection, embeddings))
    }

    pub fn publish_enriched_if_current(
        &self,
        projection: &IndexProjection,
        embeddings: &EmbeddingSet,
    ) -> Result<Option<PublishResult>> {
        ensure!(
            projection.schema_version == castle_core::INDEX_PROJECTION_SCHEMA_VERSION,
            "Castle index projection schema is incompatible"
        );
        ensure!(
            embeddings.is_complete(),
            "Castle cannot publish an incomplete embedding generation"
        );
        let _publication_guard = self
            .publication_lock
            .lock()
            .map_err(|_| anyhow!("Castle index publication lock was poisoned"))?;
        let (current, _, _) = self.resolve_current_manifest()?;
        if current.source_fingerprint != projection.source_fingerprint {
            return Ok(None);
        }
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .context("Castle could not start the index publisher runtime")?;
        runtime
            .block_on(self.publish_async(projection, Some(embeddings)))
            .map(Some)
    }

    pub fn status(&self) -> Result<IndexStatus> {
        let directory = self.library_directory();
        if !directory.is_dir() {
            return Ok(IndexStatus {
                state: "unavailable",
                manifest: None,
                database_path: None,
                recovered_manifest: false,
                message: Some("No Castle index has been published yet".to_owned()),
            });
        }
        match self.resolve_current_manifest() {
            Ok((manifest, database_path, recovered_manifest)) => {
                self.cache_resolution(ResolvedIndex {
                    manifest: manifest.clone(),
                    database_path: database_path.clone(),
                    recovered_manifest,
                })?;
                Ok(IndexStatus {
                    state: "ready",
                    manifest: Some(manifest),
                    database_path: Some(database_path),
                    recovered_manifest,
                    message: None,
                })
            }
            Err(reason) => {
                self.cache_resolution_clear()?;
                Ok(IndexStatus {
                    state: "unavailable",
                    manifest: None,
                    database_path: None,
                    recovered_manifest: false,
                    message: Some(format!("{reason:#}")),
                })
            }
        }
    }

    pub fn verify_current(&self) -> Result<CurrentIndexManifest> {
        let resolved = self.resolve_current_verified()?;
        Ok(resolved.manifest)
    }

    pub fn resolve_current(&self) -> Result<ResolvedIndex> {
        let manifest_path = self.library_directory().join("current.json");
        let declared = fs::read(&manifest_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<CurrentIndexManifest>(&bytes).ok());
        if let Some(declared) = declared {
            let cache = self
                .resolution_cache
                .lock()
                .map_err(|_| anyhow!("Castle index resolution cache was poisoned"))?;
            if let Some(cached) = cache.as_ref()
                && cached.manifest == declared
                && cached.database_path.is_file()
            {
                return Ok(cached.clone());
            }
        }
        self.resolve_current_verified()
    }

    fn resolve_current_verified(&self) -> Result<ResolvedIndex> {
        let (manifest, database_path, recovered_manifest) = self.resolve_current_manifest()?;
        let resolved = ResolvedIndex {
            manifest,
            database_path,
            recovered_manifest,
        };
        self.cache_resolution(resolved.clone())?;
        Ok(resolved)
    }

    fn cache_resolution(&self, resolved: ResolvedIndex) -> Result<()> {
        *self
            .resolution_cache
            .lock()
            .map_err(|_| anyhow!("Castle index resolution cache was poisoned"))? = Some(resolved);
        Ok(())
    }

    fn cache_resolution_clear(&self) -> Result<()> {
        *self
            .resolution_cache
            .lock()
            .map_err(|_| anyhow!("Castle index resolution cache was poisoned"))? = None;
        Ok(())
    }

    fn resolve_current_manifest(&self) -> Result<(CurrentIndexManifest, PathBuf, bool)> {
        let directory = self.library_directory();
        let manifest_path = directory.join("current.json");
        if let Ok(bytes) = fs::read(&manifest_path)
            && let Ok(manifest) = serde_json::from_slice::<CurrentIndexManifest>(&bytes)
            && let Ok(database_path) = self.verify_manifest(&manifest)
        {
            return Ok((manifest, database_path, false));
        }

        for database_path in generation_files_newest_first(&directory)? {
            if let Ok(manifest) = verify_generation(&database_path, None) {
                atomic_write_json(&manifest_path, &manifest)?;
                return Ok((manifest, database_path, true));
            }
        }
        bail!("Castle could not find a verified compatible index generation")
    }

    fn verify_manifest(&self, manifest: &CurrentIndexManifest) -> Result<PathBuf> {
        ensure!(
            manifest.manifest_schema_version == MANIFEST_SCHEMA_VERSION,
            "Castle index manifest schema is incompatible"
        );
        ensure!(
            manifest.index_schema_version == INDEX_SCHEMA_VERSION,
            "Castle index schema is incompatible"
        );
        ensure!(
            manifest.database_file == format!("index_{}.db", manifest.generation),
            "Castle index manifest contains an invalid database file"
        );
        let database_path = self.library_directory().join(&manifest.database_file);
        let verified = verify_generation(&database_path, Some(&manifest.source_fingerprint))?;
        ensure!(
            verified == *manifest,
            "Castle index manifest metadata mismatch"
        );
        Ok(database_path)
    }

    async fn publish_async(
        &self,
        projection: &IndexProjection,
        embeddings: Option<&EmbeddingSet>,
    ) -> Result<PublishResult> {
        let started = std::time::Instant::now();
        let directory = self.library_directory();
        create_private_directory(&directory)?;
        let generation = create_generation(&projection.source_fingerprint)?;
        let temporary_path = directory.join(format!(".index_{generation}.building.db"));
        let _temporary_guard = TemporaryGeneration::new(temporary_path.clone());
        let database_file = format!("index_{generation}.db");
        let final_path = directory.join(&database_file);
        ensure!(
            !temporary_path.exists() && !final_path.exists(),
            "Castle index generation already exists"
        );

        let database_path_text = utf8_path(&temporary_path)?;
        let database = Builder::new_local(database_path_text)
            .build()
            .await
            .context("Castle could not create a Turso index generation")?;
        let mut connection = database
            .connect()
            .context("Castle could not connect to a Turso index generation")?;
        connection
            .execute_batch(SCHEMA_V2)
            .await
            .context("Castle could not initialize index schema version 2")?;
        import_projection(&mut connection, projection, embeddings, &generation).await?;
        checkpoint(&connection).await?;
        drop(connection);
        drop(database);
        harden_database_files(&temporary_path)?;
        ensure_sidecars_empty(&temporary_path)?;

        let temporary_manifest = verify_generation_async(
            &temporary_path,
            Some(projection.source_fingerprint.as_str()),
        )
        .await?;
        ensure!(
            temporary_manifest.generation == generation,
            "Castle verified the wrong index generation"
        );
        fs::rename(&temporary_path, &final_path).with_context(|| {
            format!(
                "Castle could not publish index generation {}",
                final_path.display()
            )
        })?;
        harden_database_files(&final_path)?;

        let manifest = CurrentIndexManifest {
            database_file,
            ..temporary_manifest
        };
        atomic_write_json(&directory.join("current.json"), &manifest)?;
        self.cache_resolution(ResolvedIndex {
            manifest: manifest.clone(),
            database_path: final_path.clone(),
            recovered_manifest: false,
        })?;
        prune_generations(&directory, &manifest.database_file)?;
        let database_bytes = fs::metadata(&final_path)?.len();

        Ok(PublishResult {
            manifest,
            database_path: final_path,
            database_bytes,
            build_milliseconds: started.elapsed().as_millis().max(1),
            note_count: projection.notes.len(),
            link_count: projection.links.len(),
        })
    }
}

async fn import_projection(
    connection: &mut Connection,
    projection: &IndexProjection,
    embeddings: Option<&EmbeddingSet>,
    generation: &str,
) -> Result<()> {
    let transaction = connection
        .transaction()
        .await
        .context("Castle could not start the index import transaction")?;
    let embedding_metadata = embeddings.and_then(EmbeddingSet::metadata);
    let metadata = [
        ("schema_version", INDEX_SCHEMA_VERSION.to_string()),
        (
            "projection_schema_version",
            projection.schema_version.to_string(),
        ),
        ("generation", generation.to_owned()),
        ("generated_at", projection.generated_at.clone()),
        (
            "published_at",
            Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        ),
        ("source_fingerprint", projection.source_fingerprint.clone()),
        ("note_count", projection.notes.len().to_string()),
        ("link_count", projection.links.len().to_string()),
        ("chunking_version", CHUNKING_VERSION.to_string()),
        ("lexical_index_version", "castle_scan_v1".to_owned()),
        (
            "embedding_provider",
            embedding_metadata
                .as_ref()
                .map(|metadata| metadata.provider.clone())
                .unwrap_or_default(),
        ),
        (
            "embedding_model",
            embedding_metadata
                .as_ref()
                .map(|metadata| metadata.model.clone())
                .unwrap_or_default(),
        ),
        (
            "embedding_input_version",
            embedding_metadata
                .as_ref()
                .map(|metadata| metadata.input_version.clone())
                .unwrap_or_default(),
        ),
        (
            "embedding_dimensions",
            embedding_metadata
                .as_ref()
                .map(|metadata| metadata.dimensions.to_string())
                .unwrap_or_else(|| "0".to_owned()),
        ),
        (
            "semantic_available",
            embeddings
                .is_some_and(|embeddings| embeddings.is_complete() && !embeddings.is_empty())
                .to_string(),
        ),
        ("experimental_fts", "disabled".to_owned()),
    ];
    let mut insert_metadata = transaction
        .prepare("INSERT INTO index_metadata (key, value) VALUES (?1, ?2)")
        .await?;
    for (key, value) in metadata {
        insert_metadata.execute((key, value)).await?;
    }
    drop(insert_metadata);

    let mut insert_note = transaction
        .prepare(
            "INSERT INTO notes (
              note_id, record_id, record_type, section, section_label,
              relative_path, source_file, route, title, excerpt,
              compiled_markdown, search_text, normalized_search_text,
              source_revision, source_line_offset, created_at, modified_at,
              word_count, reading_minutes, pinned, status, frontmatter_json
            ) VALUES (
              ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
              ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22
            )",
        )
        .await?;
    let mut insert_heading = transaction
        .prepare(
            "INSERT INTO note_headings
             (note_id, ordinal, depth, label, slug, source_line)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .await?;
    let mut insert_tag = transaction
        .prepare("INSERT INTO note_tags (note_id, tag, normalized_tag) VALUES (?1, ?2, ?3)")
        .await?;
    let mut insert_alias = transaction
        .prepare("INSERT INTO note_aliases (note_id, alias, normalized_alias) VALUES (?1, ?2, ?3)")
        .await?;
    let mut insert_search = transaction
        .prepare(
            "INSERT INTO search_documents
             (note_id, title, aliases, tags, headings, body, normalized_text)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .await?;
    let mut insert_chunk = transaction
        .prepare(
            "INSERT INTO note_chunks (
               chunk_key, note_id, ordinal, heading_path, start_line, end_line,
               plain_text, search_text, content_hash, estimated_tokens
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .await?;
    let mut update_embedding = transaction
        .prepare(
            "UPDATE note_chunks
             SET embedding = vector32(?1), embedding_model = ?2,
                 embedding_dimensions = ?3
             WHERE chunk_key = ?4",
        )
        .await?;

    for note in &projection.notes {
        let frontmatter_json = serde_json::to_string(&note.frontmatter)?;
        insert_note
            .execute(params![
                note.note_id.clone(),
                note.record_id.clone(),
                note.record_type.clone(),
                note.section.clone(),
                note.section_label.clone(),
                note.relative_path.clone(),
                note.source_file.clone(),
                note.route.clone(),
                note.title.clone(),
                note.excerpt.clone(),
                note.compiled_markdown.clone(),
                note.search_text.clone(),
                normalize_search_text(&note.search_text),
                note.source_revision.clone(),
                note.source_line_offset as i64,
                note.created_at.clone(),
                note.modified_at.clone(),
                note.word_count as i64,
                note.reading_minutes as i64,
                i64::from(note.pinned),
                note.status.clone(),
                frontmatter_json,
            ])
            .await?;
        for (ordinal, heading) in note.headings.iter().enumerate() {
            insert_heading
                .execute(params![
                    note.note_id.clone(),
                    ordinal as i64,
                    heading.depth as i64,
                    heading.label.clone(),
                    heading.id.clone(),
                    (note.source_line_offset + heading.line) as i64,
                ])
                .await?;
        }
        for tag in &note.tags {
            insert_tag
                .execute((
                    note.note_id.clone(),
                    tag.clone(),
                    normalize_search_text(tag),
                ))
                .await?;
        }
        for alias in &note.aliases {
            insert_alias
                .execute((
                    note.note_id.clone(),
                    alias.clone(),
                    normalize_search_text(alias),
                ))
                .await?;
        }
        insert_search
            .execute(params![
                note.note_id.clone(),
                note.title.clone(),
                note.aliases.join(" "),
                note.tags.join(" "),
                note.headings
                    .iter()
                    .map(|heading| heading.label.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
                note.compiled_markdown.clone(),
                normalize_search_text(&note.search_text),
            ])
            .await?;
        for chunk in chunk_note(note) {
            let embedding = embeddings.and_then(|values| values.get(&chunk.content_hash));
            insert_chunk
                .execute(params![
                    chunk.chunk_key.clone(),
                    chunk.note_id,
                    chunk.ordinal as i64,
                    chunk.heading_path,
                    chunk.start_line as i64,
                    chunk.end_line as i64,
                    chunk.plain_text,
                    chunk.search_text,
                    chunk.content_hash,
                    chunk.estimated_tokens as i64,
                ])
                .await?;
            if let Some(embedding) = embedding {
                update_embedding
                    .execute((
                        serde_json::to_string(&embedding.values)?,
                        embedding.model.clone(),
                        embedding.dimensions as i64,
                        chunk.chunk_key,
                    ))
                    .await?;
            }
        }
    }
    drop(insert_note);
    drop(insert_heading);
    drop(insert_tag);
    drop(insert_alias);
    drop(insert_search);
    drop(insert_chunk);
    drop(update_embedding);

    let mut insert_link = transaction
        .prepare(
            "INSERT INTO note_links
             (source_note_id, target_note_id, kind, source_line)
             VALUES (?1, ?2, ?3, ?4)",
        )
        .await?;
    for link in &projection.links {
        insert_link
            .execute(params![
                link.source_note_id.clone(),
                link.target_note_id.clone(),
                link.kind.as_str(),
                link.source_line.map(|line| line as i64),
            ])
            .await?;
    }
    drop(insert_link);

    let mut insert_entity = transaction
        .prepare(
            "INSERT INTO domain_entities (
               kind, entity_id, note_id, ordinal, status, entity_date,
               project_id, payload_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .await?;
    let mut insert_entity_person = transaction
        .prepare(
            "INSERT OR IGNORE INTO domain_entity_people
             (kind, entity_id, person_note_id) VALUES (?1, ?2, ?3)",
        )
        .await?;
    let mut insert_reference = transaction
        .prepare(
            "INSERT OR IGNORE INTO note_entity_references
             (note_id, reference_kind, reference_id) VALUES (?1, ?2, ?3)",
        )
        .await?;
    for entity in &projection.domain.entities {
        let kind = entity.kind.as_str();
        insert_entity
            .execute((
                kind,
                entity.entity_id.clone(),
                entity.note_id.clone(),
                entity.ordinal as i64,
                entity.status.clone(),
                entity.entity_date.clone(),
                entity.project_id.clone(),
                serde_json::to_string(&entity.payload)?,
            ))
            .await?;
        if let (Some(note_id), Some(project_id)) = (&entity.note_id, &entity.project_id) {
            insert_reference
                .execute((note_id.clone(), "project", project_id.clone()))
                .await?;
        }
        if kind == "project"
            && let Some(note_id) = &entity.note_id
        {
            insert_reference
                .execute((note_id.clone(), "project", entity.entity_id.clone()))
                .await?;
        }
        for person_note_id in &entity.person_note_ids {
            insert_entity_person
                .execute((kind, entity.entity_id.clone(), person_note_id.clone()))
                .await?;
            if let Some(note_id) = &entity.note_id {
                insert_reference
                    .execute((note_id.clone(), "person", person_note_id.clone()))
                    .await?;
            }
        }
    }
    drop(insert_reference);
    drop(insert_entity_person);
    drop(insert_entity);
    let mut insert_document = transaction
        .prepare("INSERT INTO domain_documents (kind, payload_json) VALUES (?1, ?2)")
        .await?;
    insert_document
        .execute((
            "relationship_graph",
            serde_json::to_string(&projection.domain.relationship_graph)?,
        ))
        .await?;
    drop(insert_document);

    transaction
        .commit()
        .await
        .context("Castle could not commit the index import transaction")?;
    Ok(())
}

async fn checkpoint(connection: &Connection) -> Result<()> {
    let mut rows = connection
        .query("PRAGMA wal_checkpoint(TRUNCATE)", ())
        .await
        .context("Castle could not checkpoint the index generation")?;
    while rows.next().await?.is_some() {}
    Ok(())
}

fn verify_generation(
    database_path: &Path,
    expected_fingerprint: Option<&str>,
) -> Result<CurrentIndexManifest> {
    ensure!(database_path.is_file(), "Castle index database is missing");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("Castle could not start the index verification runtime")?;
    let result = runtime.block_on(verify_generation_async(database_path, expected_fingerprint));
    harden_database_files(database_path)?;
    remove_empty_sidecars(database_path)?;
    result
}

async fn verify_generation_async(
    database_path: &Path,
    expected_fingerprint: Option<&str>,
) -> Result<CurrentIndexManifest> {
    let database = Builder::new_local(utf8_path(database_path)?)
        .build()
        .await
        .context("Castle could not open an index generation")?;
    let connection = database
        .connect()
        .context("Castle could not connect to an index generation")?;
    connection.execute("PRAGMA query_only = 1", ()).await?;
    let integrity = scalar_string(&connection, "PRAGMA integrity_check", ()).await?;
    ensure!(
        integrity.eq_ignore_ascii_case("ok"),
        "Castle index integrity check failed (result={integrity:?})"
    );
    let mut foreign_key_rows = connection.query("PRAGMA foreign_key_check", ()).await?;
    let mut foreign_key_failures = 0_u64;
    while foreign_key_rows.next().await?.is_some() {
        foreign_key_failures += 1;
    }
    ensure!(
        foreign_key_failures == 0,
        "Castle index foreign keys are invalid"
    );
    let schema_version = metadata_u32(&connection, "schema_version").await?;
    ensure!(
        schema_version == INDEX_SCHEMA_VERSION,
        "Castle index schema is incompatible"
    );
    let generation = metadata_string(&connection, "generation").await?;
    let source_fingerprint = metadata_string(&connection, "source_fingerprint").await?;
    if let Some(expected) = expected_fingerprint {
        ensure!(
            source_fingerprint == expected,
            "Castle index source fingerprint is stale"
        );
    }
    let expected_note_count = metadata_i64(&connection, "note_count").await?;
    let expected_link_count = metadata_i64(&connection, "link_count").await?;
    ensure!(
        scalar_i64(&connection, "SELECT COUNT(*) FROM notes", ()).await? == expected_note_count,
        "Castle index note count is invalid"
    );
    ensure!(
        scalar_i64(&connection, "SELECT COUNT(*) FROM note_links", ()).await?
            == expected_link_count,
        "Castle index link count is invalid"
    );
    let published_at = metadata_string(&connection, "published_at").await?;
    let semantic_available = metadata_string(&connection, "semantic_available").await? == "true";
    let chunk_count = scalar_i64(&connection, "SELECT COUNT(*) FROM note_chunks", ()).await?;
    let embedded_chunk_count = scalar_i64(
        &connection,
        "SELECT COUNT(*) FROM note_chunks WHERE embedding IS NOT NULL",
        (),
    )
    .await?;
    if semantic_available {
        let embedding_provider = metadata_string(&connection, "embedding_provider").await?;
        let embedding_model = metadata_string(&connection, "embedding_model").await?;
        let embedding_input_version =
            metadata_string(&connection, "embedding_input_version").await?;
        let embedding_dimensions = metadata_i64(&connection, "embedding_dimensions").await?;
        ensure!(
            chunk_count > 0
                && embedded_chunk_count == chunk_count
                && !embedding_provider.is_empty()
                && !embedding_model.is_empty()
                && !embedding_input_version.is_empty()
                && embedding_dimensions > 0,
            "Castle semantic index metadata or coverage is invalid"
        );
        ensure!(
            scalar_i64(
                &connection,
                "SELECT COUNT(*) FROM note_chunks
                 WHERE embedding IS NULL OR embedding_model <> ?1
                   OR embedding_dimensions <> ?2",
                (embedding_model.as_str(), embedding_dimensions),
            )
            .await?
                == 0,
            "Castle semantic index vectors are incompatible"
        );
        let mut vector_rows = connection
            .query(
                "SELECT vector_distance_cos(embedding, embedding)
                 FROM note_chunks LIMIT 1",
                (),
            )
            .await?;
        let vector_distance: f64 = vector_rows
            .next()
            .await?
            .ok_or_else(|| anyhow!("Castle semantic index contains no vectors"))?
            .get(0)?;
        ensure!(
            vector_distance.is_finite() && vector_distance.abs() < 1e-6,
            "Castle semantic index vectors are invalid"
        );
    } else {
        ensure!(
            embedded_chunk_count == 0,
            "Castle lexical index unexpectedly contains partial embeddings"
        );
    }
    let database_file = format!("index_{generation}.db");
    Ok(CurrentIndexManifest {
        manifest_schema_version: MANIFEST_SCHEMA_VERSION,
        index_schema_version: schema_version,
        generation,
        database_file,
        source_fingerprint,
        published_at,
        semantic_available,
    })
}

async fn metadata_string(connection: &Connection, key: &str) -> Result<String> {
    scalar_string(
        connection,
        "SELECT value FROM index_metadata WHERE key = ?1",
        [key],
    )
    .await
}

async fn metadata_u32(connection: &Connection, key: &str) -> Result<u32> {
    metadata_string(connection, key)
        .await?
        .parse()
        .with_context(|| format!("Castle index metadata {key} is invalid"))
}

async fn metadata_i64(connection: &Connection, key: &str) -> Result<i64> {
    metadata_string(connection, key)
        .await?
        .parse()
        .with_context(|| format!("Castle index metadata {key} is invalid"))
}

async fn scalar_string(
    connection: &Connection,
    sql: &str,
    parameters: impl turso::IntoParams,
) -> Result<String> {
    let mut rows = connection.query(sql, parameters).await?;
    let row = rows
        .next()
        .await?
        .ok_or_else(|| anyhow!("Castle index query returned no rows: {sql}"))?;
    Ok(row.get(0)?)
}

async fn scalar_i64(
    connection: &Connection,
    sql: &str,
    parameters: impl turso::IntoParams,
) -> Result<i64> {
    let mut rows = connection.query(sql, parameters).await?;
    let row = rows
        .next()
        .await?
        .ok_or_else(|| anyhow!("Castle index query returned no rows: {sql}"))?;
    Ok(row.get(0)?)
}

fn create_generation(source_fingerprint: &str) -> Result<String> {
    ensure!(
        source_fingerprint.len() >= 12
            && source_fingerprint
                .chars()
                .all(|character| character.is_ascii_hexdigit()),
        "Castle index source fingerprint is invalid"
    );
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("Castle system clock is before the Unix epoch")?
        .as_nanos();
    Ok(format!("{timestamp}_{}", &source_fingerprint[..12]))
}

fn utf8_path(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or_else(|| anyhow!("Castle requires a UTF-8 index path"))
}

fn generation_files_newest_first(directory: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = fs::read_dir(directory)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("index_") && name.ends_with(".db"))
        })
        .collect::<Vec<_>>();
    paths.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
    Ok(paths)
}

fn prune_generations(directory: &Path, current_file: &str) -> Result<()> {
    let mut paths = generation_files_newest_first(directory)?;
    paths.sort_by_key(|path| {
        if path.file_name().and_then(|name| name.to_str()) == Some(current_file) {
            0
        } else {
            1
        }
    });
    for path in paths.into_iter().skip(RETAINED_GENERATIONS) {
        fs::remove_file(&path).with_context(|| {
            format!(
                "Castle could not prune old index generation {}",
                path.display()
            )
        })?;
        remove_empty_sidecars(&path)?;
    }
    Ok(())
}

pub(crate) fn remove_empty_sidecars(database_path: &Path) -> Result<()> {
    for path in database_sidecars(database_path) {
        if path.is_file() && fs::metadata(&path)?.len() == 0 {
            fs::remove_file(&path)?;
        }
    }
    Ok(())
}

fn ensure_sidecars_empty(database_path: &Path) -> Result<()> {
    for path in database_sidecars(database_path) {
        if path.is_file() {
            ensure!(
                fs::metadata(&path)?.len() == 0,
                "Castle index generation still has an uncheckpointed sidecar: {}",
                path.display()
            );
        }
    }
    Ok(())
}

fn database_sidecars(database_path: &Path) -> [PathBuf; 2] {
    [
        PathBuf::from(format!("{}-wal", database_path.display())),
        PathBuf::from(format!("{}-shm", database_path.display())),
    ]
}

fn create_private_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub(crate) fn harden_database_files(database_path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in
            std::iter::once(database_path.to_owned()).chain(database_sidecars(database_path))
        {
            if path.exists() {
                fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
            }
        }
    }
    Ok(())
}

fn atomic_write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value)?;
    let temporary = path.with_extension("json.tmp");
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, path)?;
    Ok(())
}

struct TemporaryGeneration {
    database_path: PathBuf,
}

impl TemporaryGeneration {
    fn new(database_path: PathBuf) -> Self {
        Self { database_path }
    }
}

impl Drop for TemporaryGeneration {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.database_path);
        for path in database_sidecars(&self.database_path) {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use castle_core::{CompileOptions, build_index_projection, compile_library};

    use super::*;

    fn fixture() -> (tempfile::TempDir, IndexProjection, IndexPublisher) {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        fs::create_dir_all(library.join("notes")).unwrap();
        fs::write(
            library.join("notes/first.md"),
            "---\naliases: [Pierwsza]\ntags: [Polska]\n---\n# First\n\nSee [[notes/second]].\n",
        )
        .unwrap();
        fs::write(
            library.join("notes/second.md"),
            "# Żółty second\n\nZażółć gęślą jaźń.\n",
        )
        .unwrap();
        let compilation = compile_library(&CompileOptions::new(&library, root.path())).unwrap();
        let projection = build_index_projection(&compilation);
        let publisher = IndexPublisher::new(IndexPublisherOptions {
            indexes_root: root.path().join("indexes"),
            library_key: create_library_key(&library).unwrap(),
        })
        .unwrap();
        (root, projection, publisher)
    }

    #[test]
    fn publishes_and_verifies_an_immutable_generation() {
        let (_root, projection, publisher) = fixture();
        let result = publisher.publish(&projection).unwrap();

        assert_eq!(result.note_count, 2);
        assert!(result.database_bytes > 0);
        assert_eq!(publisher.verify_current().unwrap(), result.manifest);
        let status = publisher.status().unwrap();
        assert_eq!(status.state, "ready");
        assert!(!status.recovered_manifest);
    }

    #[test]
    fn recovers_from_a_corrupt_manifest_without_rebuilding() {
        let (_root, projection, publisher) = fixture();
        let result = publisher.publish(&projection).unwrap();
        fs::write(
            publisher.library_directory().join("current.json"),
            b"broken",
        )
        .unwrap();

        let status = publisher.status().unwrap();
        assert_eq!(status.state, "ready");
        assert!(status.recovered_manifest);
        assert_eq!(status.manifest.unwrap(), result.manifest);
    }

    #[test]
    fn failed_generation_does_not_replace_the_current_manifest() {
        let (_root, projection, publisher) = fixture();
        let first = publisher.publish(&projection).unwrap();
        let mut invalid = projection.clone();
        invalid.links.push(castle_core::IndexLink {
            source_note_id: "notes/first".to_owned(),
            target_note_id: "missing".to_owned(),
            kind: castle_core::IndexLinkKind::Outgoing,
            source_line: None,
        });

        assert!(publisher.publish(&invalid).is_err());
        assert_eq!(publisher.verify_current().unwrap(), first.manifest);
        assert!(
            fs::read_dir(publisher.library_directory())
                .unwrap()
                .all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains(".building."))
        );
    }

    #[test]
    fn rejects_partial_semantic_generations_and_recovers_the_lexical_generation() {
        let (root, projection, publisher) = fixture();
        let lexical = publisher.publish(&projection).unwrap();
        let provider = crate::DeterministicEmbeddingProvider::new(16).unwrap();
        let synchronized = crate::EmbeddingCache::new(root.path().join("embeddings.db"))
            .synchronize(&projection, &provider)
            .unwrap();
        let semantic = publisher
            .publish_with_embeddings(&projection, Some(&synchronized.embeddings))
            .unwrap();
        assert!(semantic.manifest.semantic_available);

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let database = Builder::new_local(semantic.database_path.to_str().unwrap())
                .build()
                .await
                .unwrap();
            let connection = database.connect().unwrap();
            connection
                .execute(
                    "UPDATE note_chunks SET embedding = NULL
                     WHERE chunk_key = (SELECT chunk_key FROM note_chunks LIMIT 1)",
                    (),
                )
                .await
                .unwrap();
        });

        let recovered = publisher.status().unwrap();
        assert_eq!(recovered.state, "ready");
        assert!(recovered.recovered_manifest);
        assert_eq!(
            recovered.manifest.unwrap().generation,
            lexical.manifest.generation
        );
    }

    #[test]
    fn an_open_reader_remains_on_its_immutable_generation() {
        use crate::{KnowledgeIndex, SearchRequest, TursoKnowledgeIndex};

        let (_root, projection, publisher) = fixture();
        let first = publisher.publish(&projection).unwrap();
        let old_reader = TursoKnowledgeIndex::open(&publisher).unwrap();
        let mut changed = projection.clone();
        let second_note = changed
            .notes
            .iter_mut()
            .find(|note| note.note_id == "notes/second")
            .unwrap();
        second_note.title = "Changed title".to_owned();
        second_note.compiled_markdown = "Completely different material.".to_owned();
        second_note.search_text = "Changed title completely different material".to_owned();
        second_note.source_revision = "b".repeat(64);
        changed.source_fingerprint = "c".repeat(64);
        let second = publisher.publish(&changed).unwrap();
        let new_reader = TursoKnowledgeIndex::open(&publisher).unwrap();

        assert_ne!(first.manifest.generation, second.manifest.generation);
        assert_eq!(old_reader.metadata().generation, first.manifest.generation);
        assert_eq!(new_reader.metadata().generation, second.manifest.generation);
        assert_eq!(
            old_reader
                .search(SearchRequest {
                    query: "zażółć".to_owned(),
                    ..SearchRequest::default()
                })
                .unwrap()
                .results[0]
                .note_id,
            "notes/second"
        );
        assert_eq!(
            new_reader
                .search(SearchRequest {
                    query: "different".to_owned(),
                    ..SearchRequest::default()
                })
                .unwrap()
                .results[0]
                .note_id,
            "notes/second"
        );
    }

    #[test]
    fn canonical_library_paths_have_distinct_cache_keys() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("first/library");
        let second = root.path().join("second/library");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();

        assert_ne!(
            create_library_key(&first).unwrap(),
            create_library_key(&second).unwrap()
        );
    }
}
