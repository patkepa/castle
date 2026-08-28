use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use anyhow::{Context, Result, anyhow, ensure};
use castle_core::normalize_search_text;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use turso::{Builder, Connection};

use crate::{
    CurrentIndexManifest, IndexPublisher, ResolvedIndex,
    embedding::QueryEmbedding,
    publisher::{harden_database_files, remove_empty_sidecars},
};

const MAXIMUM_QUERY_CHARACTERS: usize = 512;
const MAXIMUM_SEARCH_RESULTS: usize = 50;
const DEFAULT_SEARCH_RESULTS: usize = 12;
const MAXIMUM_CONTEXT_BYTES: usize = 64 * 1024;
const DEFAULT_CONTEXT_BYTES: usize = 16 * 1024;
const MAXIMUM_STRUCTURED_RESULTS: usize = 100;
const QUERY_DATABASE_CACHE_GENERATIONS: usize = 2;
const SEMANTIC_VECTOR_CACHE_GENERATIONS: usize = 2;

#[derive(Debug)]
struct QueryDatabase {
    runtime: tokio::runtime::Runtime,
    _database: turso::Database,
    connection: Connection,
}

type SharedQueryDatabase = Arc<Mutex<QueryDatabase>>;

static QUERY_DATABASE_CACHE: OnceLock<Mutex<VecDeque<(PathBuf, SharedQueryDatabase)>>> =
    OnceLock::new();

#[derive(Debug)]
struct SemanticVector {
    chunk_key: String,
    values: Box<[f32]>,
    magnitude: f64,
}

#[derive(Debug)]
struct SemanticVectorGeneration {
    database_path: PathBuf,
    model: String,
    dimensions: usize,
    vectors: Vec<SemanticVector>,
}

static SEMANTIC_VECTOR_CACHE: OnceLock<Mutex<VecDeque<Arc<SemanticVectorGeneration>>>> =
    OnceLock::new();

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    #[default]
    Lexical,
    Semantic,
    Hybrid,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchFilters {
    pub section: Option<String>,
    pub record_type: Option<String>,
    pub tag: Option<String>,
    pub status: Option<String>,
    pub project_id: Option<String>,
    pub person_id: Option<String>,
    pub modified_from: Option<String>,
    pub modified_to: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRequest {
    pub query: String,
    #[serde(default)]
    pub mode: SearchMode,
    #[serde(default)]
    pub filters: SearchFilters,
    pub current_note_id: Option<String>,
    #[serde(default)]
    pub attached_note_ids: Vec<String>,
    pub limit: Option<usize>,
    #[serde(default)]
    pub diagnostics: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub query: String,
    pub requested_mode: SearchMode,
    pub mode_used: SearchMode,
    pub semantic_available: bool,
    pub degraded_reasons: Vec<String>,
    pub generation: String,
    pub source_fingerprint: String,
    pub results: Vec<SearchResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub note_id: String,
    pub record_id: Option<String>,
    pub title: String,
    pub route: String,
    pub source_file: String,
    pub heading_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub excerpt: String,
    pub lexical_score: f64,
    pub semantic_score: Option<f64>,
    pub structured_score: f64,
    pub final_score: f64,
    pub explanation_codes: Vec<String>,
    pub source_revision: String,
    pub index_generation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteContextRequest {
    pub note_id: String,
    pub start_line: Option<usize>,
    pub end_line: Option<usize>,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContext {
    pub note_id: String,
    pub title: String,
    pub route: String,
    pub source_file: String,
    pub start_line: usize,
    pub end_line: usize,
    pub markdown: String,
    pub truncated: bool,
    pub source_revision: String,
    pub index_generation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelatedNotesRequest {
    pub note_id: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    Task,
    Event,
    Project,
    Person,
    Relationship,
}

impl EntityKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Event => "event",
            Self::Project => "project",
            Self::Person => "person",
            Self::Relationship => "relationship",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityQuery {
    pub status: Option<String>,
    pub person_id: Option<String>,
    pub project_id: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub relation: Option<String>,
    pub alignment: Option<String>,
    pub known_from: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredQueryResponse {
    pub kind: String,
    pub generation: String,
    pub source_fingerprint: String,
    pub items: Vec<JsonValue>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CountBucket {
    pub label: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EntityAnalytics {
    pub kind: String,
    pub total: u64,
    pub statuses: Vec<CountBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteAnalytics {
    pub total: u64,
    pub word_count: u64,
    pub reading_minutes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeOverview {
    pub generation: String,
    pub source_fingerprint: String,
    pub notes: NoteAnalytics,
    pub links: u64,
    pub chunks: u64,
    pub embedded_chunks: u64,
    pub entities: Vec<EntityAnalytics>,
}

pub trait KnowledgeIndex: Send + Sync {
    fn metadata(&self) -> &CurrentIndexManifest;
    fn search(&self, request: SearchRequest) -> Result<SearchResponse>;
    fn search_with_embedding(
        &self,
        request: SearchRequest,
        embedding: QueryEmbedding,
    ) -> Result<SearchResponse>;
    fn read_note(&self, request: NoteContextRequest) -> Result<NoteContext>;
    fn related_notes(&self, request: RelatedNotesRequest) -> Result<SearchResponse>;
    fn query_entities(
        &self,
        kind: EntityKind,
        request: EntityQuery,
    ) -> Result<StructuredQueryResponse>;
    fn knowledge_overview(&self) -> Result<KnowledgeOverview>;
    fn read_domain_document(&self, kind: &str) -> Result<JsonValue>;
}

#[derive(Debug, Clone)]
pub struct TursoKnowledgeIndex {
    resolved: ResolvedIndex,
    query_database: SharedQueryDatabase,
}

impl TursoKnowledgeIndex {
    pub fn open(publisher: &IndexPublisher) -> Result<Self> {
        let resolved = publisher.resolve_current()?;
        let query_database = open_query_database(&resolved.database_path)?;
        Ok(Self {
            resolved,
            query_database,
        })
    }

    pub fn database_path(&self) -> &Path {
        &self.resolved.database_path
    }

    fn run<T>(&self, operation: impl AsyncFnOnce(&Connection) -> Result<T>) -> Result<T> {
        let query_database = self
            .query_database
            .lock()
            .map_err(|_| anyhow!("Castle knowledge-query database lock failed"))?;
        let result = query_database
            .runtime
            .block_on(operation(&query_database.connection));
        drop(query_database);
        harden_database_files(&self.resolved.database_path)?;
        result
    }
}

fn open_query_database(database_path: &Path) -> Result<SharedQueryDatabase> {
    let cache = QUERY_DATABASE_CACHE.get_or_init(|| Mutex::new(VecDeque::new()));
    {
        let cache = cache
            .lock()
            .map_err(|_| anyhow!("Castle knowledge-query cache lock failed"))?;
        if let Some((_, database)) = cache
            .iter()
            .find(|(cached_path, _)| cached_path == database_path)
        {
            return Ok(Arc::clone(database));
        }
    }

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("Castle could not start the knowledge-query runtime")?;
    let database = runtime.block_on(async {
        Builder::new_local(utf8_path(database_path)?)
            .build()
            .await
            .context("Castle could not open the current knowledge index")
    })?;
    harden_database_files(database_path)?;
    remove_empty_sidecars(database_path)?;
    let connection = database
        .connect()
        .context("Castle could not connect to the current knowledge index")?;
    runtime.block_on(connection.execute("PRAGMA query_only = 1", ()))?;
    let loaded = Arc::new(Mutex::new(QueryDatabase {
        runtime,
        _database: database,
        connection,
    }));

    let mut cache = cache
        .lock()
        .map_err(|_| anyhow!("Castle knowledge-query cache lock failed"))?;
    if let Some((_, database)) = cache
        .iter()
        .find(|(cached_path, _)| cached_path == database_path)
    {
        return Ok(Arc::clone(database));
    }
    cache.push_front((database_path.to_path_buf(), Arc::clone(&loaded)));
    cache.truncate(QUERY_DATABASE_CACHE_GENERATIONS);
    Ok(loaded)
}

impl KnowledgeIndex for TursoKnowledgeIndex {
    fn metadata(&self) -> &CurrentIndexManifest {
        &self.resolved.manifest
    }

    fn search(&self, request: SearchRequest) -> Result<SearchResponse> {
        validate_search_request(&request)?;
        let manifest = self.resolved.manifest.clone();
        self.run(async move |connection| search_async(connection, &manifest, request).await)
    }

    fn search_with_embedding(
        &self,
        request: SearchRequest,
        embedding: QueryEmbedding,
    ) -> Result<SearchResponse> {
        validate_search_request(&request)?;
        ensure!(
            matches!(request.mode, SearchMode::Semantic | SearchMode::Hybrid),
            "Castle query embeddings require semantic or hybrid search mode"
        );
        ensure!(
            !embedding.values.is_empty() && embedding.values.iter().all(|value| value.is_finite()),
            "Castle rejected an invalid query embedding"
        );
        let manifest = self.resolved.manifest.clone();
        let database_path = self.resolved.database_path.clone();
        self.run(async move |connection| {
            search_with_embedding_async(connection, &database_path, &manifest, request, embedding)
                .await
        })
    }

    fn read_note(&self, request: NoteContextRequest) -> Result<NoteContext> {
        validate_identifier(&request.note_id, "note ID")?;
        let maximum_bytes = request.max_bytes.unwrap_or(DEFAULT_CONTEXT_BYTES);
        ensure!(
            (1..=MAXIMUM_CONTEXT_BYTES).contains(&maximum_bytes),
            "Castle note context byte limit is invalid"
        );
        if let (Some(start), Some(end)) = (request.start_line, request.end_line) {
            ensure!(
                start > 0 && end >= start,
                "Castle note line range is invalid"
            );
        }
        let manifest = self.resolved.manifest.clone();
        self.run(async move |connection| {
            read_note_async(connection, &manifest, request, maximum_bytes).await
        })
    }

    fn related_notes(&self, request: RelatedNotesRequest) -> Result<SearchResponse> {
        validate_identifier(&request.note_id, "note ID")?;
        let limit = bounded_limit(
            request.limit,
            DEFAULT_SEARCH_RESULTS,
            MAXIMUM_SEARCH_RESULTS,
        )?;
        let manifest = self.resolved.manifest.clone();
        self.run(async move |connection| {
            related_notes_async(connection, &manifest, &request.note_id, limit).await
        })
    }

    fn query_entities(
        &self,
        kind: EntityKind,
        request: EntityQuery,
    ) -> Result<StructuredQueryResponse> {
        for value in [
            request.status.as_deref(),
            request.person_id.as_deref(),
            request.project_id.as_deref(),
            request.date_from.as_deref(),
            request.date_to.as_deref(),
            request.relation.as_deref(),
            request.alignment.as_deref(),
            request.known_from.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            ensure!(
                !value.is_empty() && value.len() <= 512 && !value.contains('\0'),
                "Castle rejected an invalid structured query"
            );
        }
        let limit = bounded_limit(request.limit, 50, MAXIMUM_STRUCTURED_RESULTS)?;
        let manifest = self.resolved.manifest.clone();
        self.run(async move |connection| {
            query_entities_async(connection, &manifest, kind, request, limit).await
        })
    }

    fn knowledge_overview(&self) -> Result<KnowledgeOverview> {
        let manifest = self.resolved.manifest.clone();
        self.run(async move |connection| knowledge_overview_async(connection, &manifest).await)
    }

    fn read_domain_document(&self, kind: &str) -> Result<JsonValue> {
        ensure!(
            kind == "relationship_graph",
            "Castle rejected an unknown domain document"
        );
        let kind = kind.to_owned();
        self.run(async move |connection| {
            let payload = scalar_string(
                connection,
                "SELECT payload_json FROM domain_documents WHERE kind = ?1",
                [kind],
            )
            .await?;
            Ok(serde_json::from_str(&payload)?)
        })
    }
}

#[derive(Debug)]
struct Candidate {
    chunk_key: String,
    note_id: String,
    record_id: Option<String>,
    title: String,
    route: String,
    source_file: String,
    source_revision: String,
    section: String,
    record_type: Option<String>,
    status: String,
    modified_at: String,
    pinned: bool,
    aliases: String,
    tags: String,
    heading_path: String,
    start_line: usize,
    end_line: usize,
    plain_text: String,
    search_text: String,
}

async fn search_async(
    connection: &Connection,
    manifest: &CurrentIndexManifest,
    request: SearchRequest,
) -> Result<SearchResponse> {
    let normalized_query = normalize_search_text(&request.query);
    let tokens = normalized_query.split_whitespace().collect::<Vec<_>>();
    let limit = bounded_limit(
        request.limit,
        DEFAULT_SEARCH_RESULTS,
        MAXIMUM_SEARCH_RESULTS,
    )?;
    let reference_filters = load_reference_filters(connection, &request.filters).await?;
    let graph_neighbors = load_graph_neighbors(connection, &request).await?;
    let token_predicates = (1..=tokens.len())
        .map(|index| {
            format!(
                "(instr(c.search_text, ?{index}) > 0 OR instr(s.normalized_text, ?{index}) > 0)"
            )
        })
        .collect::<Vec<_>>()
        .join(" AND ");
    let token_filter = if token_predicates.is_empty() {
        String::new()
    } else {
        format!(" WHERE {token_predicates}")
    };
    let mut rows = connection
        .query(
            &format!(
                "SELECT
               c.chunk_key, n.note_id, n.record_id, n.title, n.route, n.source_file,
               n.source_revision, n.section, n.record_type, n.status, n.modified_at,
               n.pinned, s.aliases, s.tags, c.heading_path, c.start_line,
               c.end_line, c.plain_text, c.search_text
             FROM note_chunks c
             JOIN notes n ON n.note_id = c.note_id
             JOIN search_documents s ON s.note_id = n.note_id{token_filter}"
            ),
            tokens
                .iter()
                .map(|token| (*token).to_owned())
                .collect::<Vec<_>>(),
        )
        .await?;
    let attached = request
        .attached_note_ids
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    let mut results = Vec::<(f64, String, SearchResult)>::new();
    let mut per_note = HashMap::<String, usize>::new();
    while let Some(row) = rows.next().await? {
        let candidate = Candidate {
            chunk_key: row.get(0)?,
            note_id: row.get(1)?,
            record_id: row.get(2)?,
            title: row.get(3)?,
            route: row.get(4)?,
            source_file: row.get(5)?,
            source_revision: row.get(6)?,
            section: row.get(7)?,
            record_type: row.get(8)?,
            status: row.get(9)?,
            modified_at: row.get(10)?,
            pinned: row.get::<i64>(11)? != 0,
            aliases: row.get(12)?,
            tags: row.get(13)?,
            heading_path: row.get(14)?,
            start_line: row.get::<i64>(15)? as usize,
            end_line: row.get::<i64>(16)? as usize,
            plain_text: row.get(17)?,
            search_text: row.get(18)?,
        };
        if !passes_filters(&candidate, &request.filters, &reference_filters) {
            continue;
        }
        let title = normalize_search_text(&candidate.title);
        let aliases = normalize_search_text(&candidate.aliases);
        let tags = normalize_search_text(&candidate.tags);
        let heading = normalize_search_text(&candidate.heading_path);
        let searchable = format!(
            "{title} {aliases} {tags} {heading} {}",
            candidate.search_text
        );
        if !tokens.iter().all(|token| searchable.contains(token)) {
            continue;
        }

        let mut lexical_score = tokens.len() as f64 * 25.0;
        let mut structured_score = 0.0;
        let mut explanations = Vec::new();
        if title == normalized_query {
            lexical_score += 1_000.0;
            explanations.push("exact_title".to_owned());
        } else if title.starts_with(&normalized_query) {
            lexical_score += 750.0;
            explanations.push("title_prefix".to_owned());
        } else if tokens.iter().all(|token| title.contains(token)) {
            lexical_score += 600.0;
            explanations.push("title_match".to_owned());
        } else if aliases
            .split_whitespace()
            .any(|alias| alias == normalized_query)
        {
            lexical_score += 850.0;
            explanations.push("exact_alias".to_owned());
        } else if tokens.iter().all(|token| aliases.contains(token)) {
            lexical_score += 500.0;
            explanations.push("alias_match".to_owned());
        } else if tokens.iter().all(|token| heading.contains(token)) {
            lexical_score += 400.0;
            explanations.push("heading_match".to_owned());
        } else if tokens.iter().all(|token| tags.contains(token)) {
            lexical_score += 350.0;
            explanations.push("tag_match".to_owned());
        } else {
            lexical_score += 100.0;
            explanations.push("content_match".to_owned());
        }
        if request.current_note_id.as_deref() == Some(candidate.note_id.as_str()) {
            structured_score += 80.0;
            explanations.push("current_note".to_owned());
        }
        if attached.contains(candidate.note_id.as_str()) {
            structured_score += 160.0;
            explanations.push("explicit_attachment".to_owned());
        }
        if graph_neighbors.contains(candidate.note_id.as_str()) {
            structured_score += 40.0;
            explanations.push("graph_neighbor".to_owned());
        }
        if candidate.pinned {
            structured_score += 20.0;
            explanations.push("pinned".to_owned());
        }
        let final_score = lexical_score + structured_score;
        results.push((
            final_score,
            format!("{}:{}", candidate.modified_at, candidate.chunk_key),
            SearchResult {
                note_id: candidate.note_id,
                record_id: candidate.record_id,
                title: candidate.title,
                route: candidate.route,
                source_file: candidate.source_file,
                heading_path: candidate.heading_path,
                start_line: candidate.start_line,
                end_line: candidate.end_line,
                excerpt: plain_excerpt(&candidate.plain_text, 360),
                lexical_score,
                semantic_score: None,
                structured_score,
                final_score,
                explanation_codes: explanations,
                source_revision: candidate.source_revision,
                index_generation: manifest.generation.clone(),
            },
        ));
    }
    results.sort_by(|left, right| {
        right
            .0
            .total_cmp(&left.0)
            .then_with(|| right.1.cmp(&left.1))
    });
    let mut deduplicated = Vec::new();
    for (_, _, result) in results {
        let count = per_note.entry(result.note_id.clone()).or_default();
        if *count >= 2 {
            continue;
        }
        *count += 1;
        deduplicated.push(result);
        if deduplicated.len() == limit {
            break;
        }
    }
    let semantic_available = metadata_bool(connection, "semantic_available").await?;
    let (mode_used, degraded_reasons) = match request.mode {
        SearchMode::Lexical => (SearchMode::Lexical, Vec::new()),
        SearchMode::Semantic | SearchMode::Hybrid if semantic_available => (
            SearchMode::Lexical,
            vec!["semantic_query_embedding_unavailable".to_owned()],
        ),
        SearchMode::Semantic | SearchMode::Hybrid => (
            SearchMode::Lexical,
            vec!["semantic_embeddings_unavailable".to_owned()],
        ),
    };
    Ok(SearchResponse {
        query: request.query,
        requested_mode: request.mode,
        mode_used,
        semantic_available,
        degraded_reasons,
        generation: manifest.generation.clone(),
        source_fingerprint: manifest.source_fingerprint.clone(),
        results: deduplicated,
    })
}

async fn search_with_embedding_async(
    connection: &Connection,
    database_path: &Path,
    manifest: &CurrentIndexManifest,
    request: SearchRequest,
    embedding: QueryEmbedding,
) -> Result<SearchResponse> {
    let indexed_provider = metadata_string(connection, "embedding_provider").await?;
    let indexed_model = metadata_string(connection, "embedding_model").await?;
    let indexed_input_version = metadata_string(connection, "embedding_input_version").await?;
    let indexed_dimensions = metadata_string(connection, "embedding_dimensions")
        .await?
        .parse::<usize>()
        .context("Castle index embedding dimensions are invalid")?;
    ensure!(
        metadata_bool(connection, "semantic_available").await?
            && embedding.provider == indexed_provider
            && embedding.model == indexed_model
            && embedding.input_version == indexed_input_version
            && embedding.values.len() == indexed_dimensions,
        "Castle query embedding is incompatible with the active index"
    );
    let requested_limit = bounded_limit(
        request.limit,
        DEFAULT_SEARCH_RESULTS,
        MAXIMUM_SEARCH_RESULTS,
    )?;
    let mut lexical_request = request.clone();
    lexical_request.mode = SearchMode::Lexical;
    lexical_request.limit = Some(MAXIMUM_SEARCH_RESULTS);
    let lexical = search_async(connection, manifest, lexical_request).await?;
    let semantic = semantic_search_async(
        connection,
        database_path,
        manifest,
        &request,
        &embedding,
        100,
    )
    .await?;
    let results = match request.mode {
        SearchMode::Semantic => semantic.into_iter().take(requested_limit).collect(),
        SearchMode::Hybrid => fuse_rankings(lexical.results, semantic, requested_limit),
        SearchMode::Lexical => unreachable!(),
    };
    Ok(SearchResponse {
        query: request.query,
        requested_mode: request.mode,
        mode_used: request.mode,
        semantic_available: true,
        degraded_reasons: Vec::new(),
        generation: manifest.generation.clone(),
        source_fingerprint: manifest.source_fingerprint.clone(),
        results,
    })
}

async fn semantic_search_async(
    connection: &Connection,
    database_path: &Path,
    manifest: &CurrentIndexManifest,
    request: &SearchRequest,
    embedding: &QueryEmbedding,
    candidate_limit: usize,
) -> Result<Vec<SearchResult>> {
    let reference_filters = load_reference_filters(connection, &request.filters).await?;
    let graph_neighbors = load_graph_neighbors(connection, request).await?;
    let ranked_chunks =
        rank_semantic_chunks_async(connection, database_path, embedding, candidate_limit).await?;
    if ranked_chunks.is_empty() {
        return Ok(Vec::new());
    }
    let semantic_scores = ranked_chunks.iter().cloned().collect::<HashMap<_, _>>();
    let placeholders = (1..=ranked_chunks.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let mut rows = connection
        .query(
            &format!(
                "SELECT
               c.chunk_key,
               n.note_id, n.record_id, n.title, n.route, n.source_file,
               n.source_revision, n.section, n.record_type, n.status, n.modified_at,
               n.pinned, s.aliases, s.tags, c.heading_path, c.start_line,
               c.end_line, c.plain_text, c.search_text
             FROM note_chunks c
             JOIN notes n ON n.note_id = c.note_id
             JOIN search_documents s ON s.note_id = n.note_id
             WHERE c.chunk_key IN ({placeholders})"
            ),
            ranked_chunks
                .iter()
                .map(|(chunk_key, _)| chunk_key.clone())
                .collect::<Vec<_>>(),
        )
        .await?;
    let attached = request
        .attached_note_ids
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    let mut results = Vec::new();
    while let Some(row) = rows.next().await? {
        let candidate = Candidate {
            chunk_key: row.get(0)?,
            note_id: row.get(1)?,
            record_id: row.get(2)?,
            title: row.get(3)?,
            route: row.get(4)?,
            source_file: row.get(5)?,
            source_revision: row.get(6)?,
            section: row.get(7)?,
            record_type: row.get(8)?,
            status: row.get(9)?,
            modified_at: row.get(10)?,
            pinned: row.get::<i64>(11)? != 0,
            aliases: row.get(12)?,
            tags: row.get(13)?,
            heading_path: row.get(14)?,
            start_line: row.get::<i64>(15)? as usize,
            end_line: row.get::<i64>(16)? as usize,
            plain_text: row.get(17)?,
            search_text: row.get(18)?,
        };
        if !passes_filters(&candidate, &request.filters, &reference_filters) {
            continue;
        }
        let semantic_score = semantic_scores
            .get(&candidate.chunk_key)
            .copied()
            .ok_or_else(|| anyhow!("Castle lost a ranked semantic candidate"))?;
        let mut structured_score = 0.0;
        let mut explanations = vec!["semantic_match".to_owned()];
        if request.current_note_id.as_deref() == Some(candidate.note_id.as_str()) {
            structured_score += 0.02;
            explanations.push("current_note".to_owned());
        }
        if attached.contains(candidate.note_id.as_str()) {
            structured_score += 0.04;
            explanations.push("explicit_attachment".to_owned());
        }
        if graph_neighbors.contains(candidate.note_id.as_str()) {
            structured_score += 0.01;
            explanations.push("graph_neighbor".to_owned());
        }
        results.push(SearchResult {
            note_id: candidate.note_id,
            record_id: candidate.record_id,
            title: candidate.title,
            route: candidate.route,
            source_file: candidate.source_file,
            heading_path: candidate.heading_path,
            start_line: candidate.start_line,
            end_line: candidate.end_line,
            excerpt: plain_excerpt(&candidate.plain_text, 360),
            lexical_score: 0.0,
            semantic_score: Some(semantic_score),
            structured_score,
            final_score: semantic_score + structured_score,
            explanation_codes: explanations,
            source_revision: candidate.source_revision,
            index_generation: manifest.generation.clone(),
        });
    }
    results.sort_by(|left, right| {
        right
            .semantic_score
            .unwrap_or(f64::NEG_INFINITY)
            .total_cmp(&left.semantic_score.unwrap_or(f64::NEG_INFINITY))
            .then_with(|| result_key(left).cmp(&result_key(right)))
    });
    Ok(results)
}

async fn rank_semantic_chunks_async(
    connection: &Connection,
    database_path: &Path,
    embedding: &QueryEmbedding,
    candidate_limit: usize,
) -> Result<Vec<(String, f64)>> {
    let generation = semantic_vector_generation_async(connection, database_path, embedding).await?;
    let query_magnitude = embedding
        .values
        .iter()
        .map(|value| f64::from(*value).powi(2))
        .sum::<f64>()
        .sqrt();
    ensure!(
        query_magnitude.is_finite() && query_magnitude > f64::EPSILON,
        "Castle rejected a zero query embedding"
    );
    let mut ranked = generation
        .vectors
        .iter()
        .filter_map(|vector| {
            let dot_product = embedding
                .values
                .iter()
                .zip(vector.values.iter())
                .map(|(query, value)| f64::from(*query) * f64::from(*value))
                .sum::<f64>();
            let similarity = (dot_product / (query_magnitude * vector.magnitude)).clamp(-1.0, 1.0);
            similarity
                .is_finite()
                .then(|| (vector.chunk_key.clone(), similarity))
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|(left_key, left_score), (right_key, right_score)| {
        right_score
            .total_cmp(left_score)
            .then_with(|| left_key.cmp(right_key))
    });
    ranked.truncate(candidate_limit);
    Ok(ranked)
}

async fn semantic_vector_generation_async(
    connection: &Connection,
    database_path: &Path,
    embedding: &QueryEmbedding,
) -> Result<Arc<SemanticVectorGeneration>> {
    if let Some(generation) = cached_semantic_vector_generation(database_path, embedding)? {
        return Ok(generation);
    }
    let mut rows = connection
        .query(
            "SELECT chunk_key, embedding
             FROM note_chunks
             WHERE embedding IS NOT NULL
               AND embedding_model = ?1
               AND embedding_dimensions = ?2",
            (embedding.model.as_str(), embedding.values.len() as i64),
        )
        .await?;
    let expected_bytes = embedding.values.len() * std::mem::size_of::<f32>();
    let mut vectors = Vec::new();
    while let Some(row) = rows.next().await? {
        let chunk_key: String = row.get(0)?;
        let vector: Vec<u8> = row.get(1)?;
        ensure!(
            vector.len() == expected_bytes,
            "Castle semantic index contains an invalid vector"
        );
        let values = vector
            .chunks_exact(std::mem::size_of::<f32>())
            .map(|bytes| f32::from_ne_bytes(bytes.try_into().expect("four-byte chunk")))
            .collect::<Vec<_>>();
        let magnitude = values
            .iter()
            .map(|value| f64::from(*value).powi(2))
            .sum::<f64>()
            .sqrt();
        ensure!(
            magnitude.is_finite() && magnitude > f64::EPSILON,
            "Castle semantic index contains a zero vector"
        );
        vectors.push(SemanticVector {
            chunk_key,
            values: values.into_boxed_slice(),
            magnitude,
        });
    }
    let loaded = Arc::new(SemanticVectorGeneration {
        database_path: database_path.to_path_buf(),
        model: embedding.model.clone(),
        dimensions: embedding.values.len(),
        vectors,
    });
    let cache = SEMANTIC_VECTOR_CACHE.get_or_init(|| Mutex::new(VecDeque::new()));
    let mut cache = cache
        .lock()
        .map_err(|_| anyhow!("Castle semantic vector cache lock failed"))?;
    if let Some(generation) = cache.iter().find(|generation| {
        generation.database_path == database_path
            && generation.model == embedding.model
            && generation.dimensions == embedding.values.len()
    }) {
        return Ok(Arc::clone(generation));
    }
    cache.push_front(Arc::clone(&loaded));
    cache.truncate(SEMANTIC_VECTOR_CACHE_GENERATIONS);
    Ok(loaded)
}

fn cached_semantic_vector_generation(
    database_path: &Path,
    embedding: &QueryEmbedding,
) -> Result<Option<Arc<SemanticVectorGeneration>>> {
    let Some(cache) = SEMANTIC_VECTOR_CACHE.get() else {
        return Ok(None);
    };
    let cache = cache
        .lock()
        .map_err(|_| anyhow!("Castle semantic vector cache lock failed"))?;
    Ok(cache
        .iter()
        .find(|generation| {
            generation.database_path == database_path
                && generation.model == embedding.model
                && generation.dimensions == embedding.values.len()
        })
        .cloned())
}

fn fuse_rankings(
    lexical: Vec<SearchResult>,
    semantic: Vec<SearchResult>,
    limit: usize,
) -> Vec<SearchResult> {
    const RRF_K: f64 = 60.0;
    let mut fused = HashMap::<String, (f64, SearchResult)>::new();
    for (rank, result) in lexical.into_iter().enumerate() {
        let key = result_key(&result);
        let score = 1.0 / (RRF_K + rank as f64 + 1.0);
        fused.insert(key, (score, result));
    }
    for (rank, semantic_result) in semantic.into_iter().enumerate() {
        let key = result_key(&semantic_result);
        let score = 1.0 / (RRF_K + rank as f64 + 1.0);
        fused
            .entry(key)
            .and_modify(|(total, result)| {
                *total += score;
                result.semantic_score = semantic_result.semantic_score;
                if !result
                    .explanation_codes
                    .iter()
                    .any(|code| code == "semantic_match")
                {
                    result.explanation_codes.push("semantic_match".to_owned());
                }
            })
            .or_insert((score, semantic_result));
    }
    let mut values = fused.into_values().collect::<Vec<_>>();
    values.sort_by(|left, right| right.0.total_cmp(&left.0));
    values
        .into_iter()
        .take(limit)
        .map(|(score, mut result)| {
            result.final_score = score;
            result
        })
        .collect()
}

fn result_key(result: &SearchResult) -> String {
    format!(
        "{}:{}:{}",
        result.note_id, result.start_line, result.end_line
    )
}

async fn read_note_async(
    connection: &Connection,
    manifest: &CurrentIndexManifest,
    request: NoteContextRequest,
    maximum_bytes: usize,
) -> Result<NoteContext> {
    let mut rows = connection
        .query(
            "SELECT title, route, source_file, compiled_markdown,
                    source_line_offset, source_revision
             FROM notes WHERE note_id = ?1",
            [request.note_id.as_str()],
        )
        .await?;
    let row = rows
        .next()
        .await?
        .ok_or_else(|| anyhow!("Castle could not find note {}", request.note_id))?;
    let title: String = row.get(0)?;
    let route: String = row.get(1)?;
    let source_file: String = row.get(2)?;
    let markdown: String = row.get(3)?;
    let offset = row.get::<i64>(4)? as usize;
    let source_revision: String = row.get(5)?;
    let lines = markdown.lines().collect::<Vec<_>>();
    let first_source_line = offset + 1;
    let requested_start = request.start_line.unwrap_or(first_source_line);
    let requested_end = request.end_line.unwrap_or(offset + lines.len());
    ensure!(
        requested_start >= first_source_line && requested_end <= offset + lines.len(),
        "Castle note line range is outside the compiled note"
    );
    let first = requested_start - first_source_line;
    let last_exclusive = requested_end - offset;
    let selected = lines[first..last_exclusive].join("\n");
    let (markdown, truncated) = truncate_utf8(&selected, maximum_bytes);
    let returned_lines = markdown.lines().count();
    Ok(NoteContext {
        note_id: request.note_id,
        title,
        route,
        source_file,
        start_line: requested_start,
        end_line: requested_start + returned_lines.saturating_sub(1),
        markdown,
        truncated,
        source_revision,
        index_generation: manifest.generation.clone(),
    })
}

async fn related_notes_async(
    connection: &Connection,
    manifest: &CurrentIndexManifest,
    note_id: &str,
    limit: usize,
) -> Result<SearchResponse> {
    let mut rows = connection
        .query(
            "SELECT DISTINCT n.note_id, n.record_id, n.title, n.route, n.source_file,
                    n.excerpt, n.source_revision,
                    CASE WHEN l.source_note_id = ?1 THEN 'outgoing' ELSE 'backlink' END
             FROM note_links l
             JOIN notes n ON n.note_id = CASE
               WHEN l.source_note_id = ?1 THEN l.target_note_id ELSE l.source_note_id END
             WHERE (l.source_note_id = ?1 OR l.target_note_id = ?1)
             ORDER BY n.title
             LIMIT ?2",
            (note_id, limit as i64),
        )
        .await?;
    let mut results = Vec::new();
    while let Some(row) = rows.next().await? {
        let explanation: String = row.get(7)?;
        results.push(SearchResult {
            note_id: row.get(0)?,
            record_id: row.get(1)?,
            title: row.get(2)?,
            route: row.get(3)?,
            source_file: row.get(4)?,
            heading_path: String::new(),
            start_line: 1,
            end_line: 1,
            excerpt: row.get(5)?,
            lexical_score: 0.0,
            semantic_score: None,
            structured_score: 1.0,
            final_score: 1.0,
            explanation_codes: vec![explanation],
            source_revision: row.get(6)?,
            index_generation: manifest.generation.clone(),
        });
    }
    Ok(SearchResponse {
        query: String::new(),
        requested_mode: SearchMode::Lexical,
        mode_used: SearchMode::Lexical,
        semantic_available: false,
        degraded_reasons: Vec::new(),
        generation: manifest.generation.clone(),
        source_fingerprint: manifest.source_fingerprint.clone(),
        results,
    })
}

async fn query_entities_async(
    connection: &Connection,
    manifest: &CurrentIndexManifest,
    kind: EntityKind,
    request: EntityQuery,
    limit: usize,
) -> Result<StructuredQueryResponse> {
    let mut rows = connection
        .query(
            "SELECT payload_json FROM domain_entities
             WHERE kind = ?1 ORDER BY ordinal",
            [kind.as_str()],
        )
        .await?;
    let mut items = Vec::new();
    let mut matched = 0;
    while let Some(row) = rows.next().await? {
        let payload: String = row.get(0)?;
        let value: JsonValue = serde_json::from_str(&payload)?;
        if !entity_matches(&value, &request) {
            continue;
        }
        matched += 1;
        if items.len() < limit {
            items.push(value);
        }
    }
    Ok(StructuredQueryResponse {
        kind: kind.as_str().to_owned(),
        generation: manifest.generation.clone(),
        source_fingerprint: manifest.source_fingerprint.clone(),
        truncated: matched > items.len(),
        items,
    })
}

async fn knowledge_overview_async(
    connection: &Connection,
    manifest: &CurrentIndexManifest,
) -> Result<KnowledgeOverview> {
    let mut note_rows = connection
        .query(
            "SELECT COUNT(*), COALESCE(SUM(word_count), 0),
                    COALESCE(SUM(reading_minutes), 0)
             FROM notes",
            (),
        )
        .await?;
    let note_row = note_rows
        .next()
        .await?
        .ok_or_else(|| anyhow!("Castle index note analytics returned no row"))?;
    let notes = NoteAnalytics {
        total: unsigned_count(note_row.get::<i64>(0)?, "note count")?,
        word_count: unsigned_count(note_row.get::<i64>(1)?, "word count")?,
        reading_minutes: unsigned_count(note_row.get::<i64>(2)?, "reading minutes")?,
    };
    let links = scalar_count(connection, "SELECT COUNT(*) FROM note_links").await?;
    let chunks = scalar_count(connection, "SELECT COUNT(*) FROM note_chunks").await?;
    let embedded_chunks = scalar_count(
        connection,
        "SELECT COUNT(*) FROM note_chunks WHERE embedding IS NOT NULL",
    )
    .await?;

    let mut entity_rows = connection
        .query(
            "SELECT kind, status, COUNT(*)
             FROM domain_entities
             GROUP BY kind, status
             ORDER BY kind, status",
            (),
        )
        .await?;
    let mut entities = Vec::<EntityAnalytics>::new();
    while let Some(row) = entity_rows.next().await? {
        let kind: String = row.get(0)?;
        let status: String = row.get(1)?;
        let count = unsigned_count(row.get::<i64>(2)?, "entity count")?;
        if entities.last().is_none_or(|summary| summary.kind != kind) {
            entities.push(EntityAnalytics {
                kind: kind.clone(),
                total: 0,
                statuses: Vec::new(),
            });
        }
        let summary = entities
            .last_mut()
            .ok_or_else(|| anyhow!("Castle could not assemble entity analytics"))?;
        summary.total += count;
        if !status.is_empty() {
            summary.statuses.push(CountBucket {
                label: status,
                count,
            });
        }
    }

    Ok(KnowledgeOverview {
        generation: manifest.generation.clone(),
        source_fingerprint: manifest.source_fingerprint.clone(),
        notes,
        links,
        chunks,
        embedded_chunks,
        entities,
    })
}

fn validate_search_request(request: &SearchRequest) -> Result<()> {
    let query = request.query.trim();
    ensure!(!query.is_empty(), "Castle search query cannot be empty");
    ensure!(
        query.chars().count() <= MAXIMUM_QUERY_CHARACTERS,
        "Castle search query is too long"
    );
    ensure!(
        request.attached_note_ids.len() <= 20,
        "Castle search has too many attached notes"
    );
    for note_id in &request.attached_note_ids {
        validate_identifier(note_id, "attached note ID")?;
    }
    if let Some(note_id) = &request.current_note_id {
        validate_identifier(note_id, "current note ID")?;
    }
    for (value, label) in [
        (request.filters.project_id.as_deref(), "project filter"),
        (request.filters.person_id.as_deref(), "person filter"),
    ] {
        if let Some(value) = value {
            validate_identifier(value, label)?;
        }
    }
    for value in [
        request.filters.section.as_deref(),
        request.filters.record_type.as_deref(),
        request.filters.tag.as_deref(),
        request.filters.status.as_deref(),
        request.filters.modified_from.as_deref(),
        request.filters.modified_to.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        ensure!(
            !value.is_empty() && value.len() <= 512 && !value.contains('\0'),
            "Castle rejected an invalid search filter"
        );
    }
    bounded_limit(
        request.limit,
        DEFAULT_SEARCH_RESULTS,
        MAXIMUM_SEARCH_RESULTS,
    )?;
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= 512
            && !value.contains('\0')
            && !value.starts_with('/')
            && !value.contains(".."),
        "Castle rejected an invalid {label}"
    );
    Ok(())
}

fn bounded_limit(requested: Option<usize>, default: usize, maximum: usize) -> Result<usize> {
    let value = requested.unwrap_or(default);
    ensure!(
        (1..=maximum).contains(&value),
        "Castle query result limit is invalid"
    );
    Ok(value)
}

#[derive(Default)]
struct ReferenceFilterSets {
    project_notes: Option<HashSet<String>>,
    person_notes: Option<HashSet<String>>,
}

async fn load_reference_filters(
    connection: &Connection,
    filters: &SearchFilters,
) -> Result<ReferenceFilterSets> {
    Ok(ReferenceFilterSets {
        project_notes: load_reference_notes(connection, "project", filters.project_id.as_deref())
            .await?,
        person_notes: load_reference_notes(connection, "person", filters.person_id.as_deref())
            .await?,
    })
}

async fn load_reference_notes(
    connection: &Connection,
    kind: &str,
    reference_id: Option<&str>,
) -> Result<Option<HashSet<String>>> {
    let Some(reference_id) = reference_id else {
        return Ok(None);
    };
    let mut rows = connection
        .query(
            "SELECT note_id FROM note_entity_references
             WHERE reference_kind = ?1 AND reference_id = ?2",
            (kind, reference_id),
        )
        .await?;
    let mut note_ids = HashSet::new();
    while let Some(row) = rows.next().await? {
        note_ids.insert(row.get(0)?);
    }
    Ok(Some(note_ids))
}

async fn load_graph_neighbors(
    connection: &Connection,
    request: &SearchRequest,
) -> Result<HashSet<String>> {
    let mut seeds = request
        .attached_note_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    seeds.extend(request.current_note_id.iter().cloned());
    if seeds.is_empty() {
        return Ok(HashSet::new());
    }
    let mut rows = connection
        .query("SELECT source_note_id, target_note_id FROM note_links", ())
        .await?;
    let mut neighbors = HashSet::new();
    while let Some(row) = rows.next().await? {
        let source: String = row.get(0)?;
        let target: String = row.get(1)?;
        if seeds.contains(&source) && !seeds.contains(&target) {
            neighbors.insert(target);
        } else if seeds.contains(&target) && !seeds.contains(&source) {
            neighbors.insert(source);
        }
    }
    Ok(neighbors)
}

fn passes_filters(
    candidate: &Candidate,
    filters: &SearchFilters,
    references: &ReferenceFilterSets,
) -> bool {
    filters
        .section
        .as_deref()
        .is_none_or(|value| candidate.section == value)
        && filters
            .record_type
            .as_deref()
            .is_none_or(|value| candidate.record_type.as_deref() == Some(value))
        && filters
            .status
            .as_deref()
            .is_none_or(|value| candidate.status == value)
        && filters.tag.as_deref().is_none_or(|value| {
            let expected = normalize_search_text(value);
            normalize_search_text(&candidate.tags)
                .split_whitespace()
                .any(|tag| tag == expected)
        })
        && filters
            .modified_from
            .as_deref()
            .is_none_or(|value| candidate.modified_at.as_str() >= value)
        && filters
            .modified_to
            .as_deref()
            .is_none_or(|value| candidate.modified_at.as_str() <= value)
        && references
            .project_notes
            .as_ref()
            .is_none_or(|notes| notes.contains(&candidate.note_id))
        && references
            .person_notes
            .as_ref()
            .is_none_or(|notes| notes.contains(&candidate.note_id))
}

fn entity_matches(value: &JsonValue, request: &EntityQuery) -> bool {
    request
        .status
        .as_deref()
        .is_none_or(|expected| value.get("status").and_then(JsonValue::as_str) == Some(expected))
        && request.project_id.as_deref().is_none_or(|expected| {
            value
                .get("project")
                .and_then(|project| project.get("id"))
                .and_then(JsonValue::as_str)
                == Some(expected)
        })
        && request.person_id.as_deref().is_none_or(|expected| {
            value
                .get("people")
                .and_then(JsonValue::as_array)
                .is_some_and(|people| {
                    people.iter().any(|person| {
                        person.get("noteId").and_then(JsonValue::as_str) == Some(expected)
                    })
                })
        })
        && request
            .date_from
            .as_deref()
            .is_none_or(|expected| entity_date(value).is_some_and(|date| date >= expected))
        && request
            .date_to
            .as_deref()
            .is_none_or(|expected| entity_date(value).is_some_and(|date| date <= expected))
        && request.relation.as_deref().is_none_or(|expected| {
            value.get("relation").and_then(JsonValue::as_str) == Some(expected)
        })
        && request.alignment.as_deref().is_none_or(|expected| {
            value
                .get("alignments")
                .and_then(JsonValue::as_array)
                .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(expected)))
        })
        && request.known_from.as_deref().is_none_or(|expected| {
            value
                .get("knownFrom")
                .and_then(JsonValue::as_array)
                .is_some_and(|values| {
                    values.iter().any(|value| {
                        value.as_str().is_some_and(|value| {
                            value == expected
                                || value
                                    .strip_prefix(expected)
                                    .is_some_and(|suffix| suffix.starts_with('/'))
                        })
                    })
                })
        })
}

fn entity_date(value: &JsonValue) -> Option<&str> {
    ["targetDate", "startDate", "date", "startedAt"]
        .into_iter()
        .find_map(|key| value.get(key).and_then(JsonValue::as_str))
}

fn plain_excerpt(markdown: &str, maximum_characters: usize) -> String {
    let plain = markdown
        .lines()
        .filter(|line| !line.trim_start().starts_with("```"))
        .map(|line| {
            line.trim()
                .trim_start_matches(['#', '>', '-', '*', '+', ' '])
        })
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .replace(['`', '*', '_'], "");
    let mut result = plain.chars().take(maximum_characters).collect::<String>();
    if plain.chars().count() > maximum_characters {
        result.push('…');
    }
    result
}

fn truncate_utf8(value: &str, maximum_bytes: usize) -> (String, bool) {
    if value.len() <= maximum_bytes {
        return (value.to_owned(), false);
    }
    let mut boundary = maximum_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    (value[..boundary].to_owned(), true)
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

async fn scalar_count(connection: &Connection, sql: &str) -> Result<u64> {
    let mut rows = connection.query(sql, ()).await?;
    let row = rows
        .next()
        .await?
        .ok_or_else(|| anyhow!("Castle index analytics returned no row: {sql}"))?;
    unsigned_count(row.get::<i64>(0)?, "aggregate count")
}

fn unsigned_count(value: i64, label: &str) -> Result<u64> {
    u64::try_from(value).with_context(|| format!("Castle index returned an invalid {label}"))
}

async fn metadata_string(connection: &Connection, key: &str) -> Result<String> {
    scalar_string(
        connection,
        "SELECT value FROM index_metadata WHERE key = ?1",
        [key],
    )
    .await
}

async fn metadata_bool(connection: &Connection, key: &str) -> Result<bool> {
    Ok(metadata_string(connection, key).await? == "true")
}

fn utf8_path(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or_else(|| anyhow!("Castle requires a UTF-8 index path"))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use castle_core::{CompileOptions, build_index_projection, compile_library};

    use super::*;
    use crate::{IndexPublisherOptions, create_library_key};

    fn fixture() -> (tempfile::TempDir, TursoKnowledgeIndex) {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        fs::create_dir_all(library.join("notes")).unwrap();
        fs::write(
            library.join("notes/warsaw.md"),
            "---\naliases: [Stolica]\ntags: [Polska]\n---\n# Warszawa\n\n## Historia\n\nZażółć gęślą jaźń w Warszawie.\n",
        )
        .unwrap();
        fs::write(
            library.join("notes/related.md"),
            "# Related\n\nSee [[notes/warsaw]].\n",
        )
        .unwrap();
        let compilation = compile_library(&CompileOptions::new(&library, root.path())).unwrap();
        let projection = build_index_projection(&compilation);
        let publisher = IndexPublisher::new(IndexPublisherOptions {
            indexes_root: root.path().join("indexes"),
            library_key: create_library_key(&library).unwrap(),
        })
        .unwrap();
        publisher.publish(&projection).unwrap();
        let index = TursoKnowledgeIndex::open(&publisher).unwrap();
        (root, index)
    }

    #[test]
    fn searches_multilingual_chunks_with_citations_and_degradation() {
        let (_root, index) = fixture();
        let response = index
            .search(SearchRequest {
                query: "zazolc gesla".to_owned(),
                mode: SearchMode::Hybrid,
                ..SearchRequest::default()
            })
            .unwrap();

        assert_eq!(response.mode_used, SearchMode::Lexical);
        assert_eq!(response.results[0].note_id, "notes/warsaw");
        assert!(response.results[0].start_line > 0);
        assert!(!response.results[0].source_revision.is_empty());
        assert_eq!(
            response.degraded_reasons,
            ["semantic_embeddings_unavailable"]
        );
    }

    #[test]
    fn reads_bounded_context_and_related_notes() {
        let (_root, index) = fixture();
        let context = index
            .read_note(NoteContextRequest {
                note_id: "notes/warsaw".to_owned(),
                start_line: None,
                end_line: None,
                max_bytes: Some(20),
            })
            .unwrap();
        assert!(context.truncated);
        assert!(context.markdown.len() <= 20);

        let related = index
            .related_notes(RelatedNotesRequest {
                note_id: "notes/warsaw".to_owned(),
                limit: None,
            })
            .unwrap();
        assert!(
            related
                .results
                .iter()
                .any(|result| result.note_id == "notes/related")
        );
    }

    #[test]
    fn applies_project_and_person_filters_from_normalized_references() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library/notes");
        fs::create_dir_all(&library).unwrap();
        for name in ["project", "task", "person", "other"] {
            fs::write(
                library.join(format!("{name}.md")),
                format!("# {name}\n\nShared searchable material.\n"),
            )
            .unwrap();
        }
        let compilation = compile_library(&CompileOptions::new(
            root.path().join("library"),
            root.path(),
        ))
        .unwrap();
        let mut projection = build_index_projection(&compilation);
        projection.domain.projects = vec![
            serde_json::from_value(serde_json::json!({
                "id": "project_alpha",
                "noteId": "notes/project",
                "route": "/note/notes/project",
                "title": "Project alpha",
                "description": "Project",
                "status": "active",
                "startedAt": "",
                "completedAt": "",
                "modifiedAt": "2026-08-02T00:00:00Z",
                "tags": [],
                "people": [],
                "taskIds": ["task_alpha"],
                "eventIds": []
            }))
            .unwrap(),
        ];
        projection.domain.tasks = vec![
            serde_json::from_value(serde_json::json!({
                "id": "task_alpha",
                "noteId": "notes/task",
                "route": "/note/notes/task",
                "title": "Task alpha",
                "description": "Task",
                "status": "todo",
                "targetDate": "2026-08-02",
                "targetTime": "",
                "estimateMinutes": 0,
                "createdAt": "",
                "completedAt": "",
                "sortOrder": 1000,
                "modifiedAt": "2026-08-02T00:00:00Z",
                "tags": [],
                "project": {
                    "id": "project_alpha",
                    "title": "Project alpha",
                    "route": "/note/notes/project"
                },
                "people": [{
                    "noteId": "notes/person",
                    "name": "Person",
                    "route": "/note/notes/person",
                    "avatarUrl": ""
                }],
                "subtasks": []
            }))
            .unwrap(),
        ];
        projection.domain.relationship_graph = serde_json::json!({
            "nodes": [{
                "id": "person:notes/person",
                "noteId": "notes/person",
                "type": "person",
                "status": "active"
            }],
            "edges": []
        });
        projection.domain.entities = vec![
            castle_core::IndexEntity {
                kind: castle_core::IndexEntityKind::Project,
                entity_id: "project_alpha".to_owned(),
                note_id: Some("notes/project".to_owned()),
                ordinal: 0,
                status: "active".to_owned(),
                entity_date: String::new(),
                project_id: None,
                person_note_ids: Vec::new(),
                payload: serde_json::to_value(&projection.domain.projects[0]).unwrap(),
            },
            castle_core::IndexEntity {
                kind: castle_core::IndexEntityKind::Task,
                entity_id: "task_alpha".to_owned(),
                note_id: Some("notes/task".to_owned()),
                ordinal: 0,
                status: "todo".to_owned(),
                entity_date: "2026-08-02".to_owned(),
                project_id: Some("project_alpha".to_owned()),
                person_note_ids: vec!["notes/person".to_owned()],
                payload: serde_json::to_value(&projection.domain.tasks[0]).unwrap(),
            },
            castle_core::IndexEntity {
                kind: castle_core::IndexEntityKind::Person,
                entity_id: "notes/person".to_owned(),
                note_id: Some("notes/person".to_owned()),
                ordinal: 0,
                status: "active".to_owned(),
                entity_date: String::new(),
                project_id: None,
                person_note_ids: vec!["notes/person".to_owned()],
                payload: projection.domain.relationship_graph["nodes"][0].clone(),
            },
        ];
        let publisher = IndexPublisher::new(IndexPublisherOptions {
            indexes_root: root.path().join("indexes"),
            library_key: create_library_key(root.path().join("library").as_path()).unwrap(),
        })
        .unwrap();
        publisher.publish(&projection).unwrap();
        let index = TursoKnowledgeIndex::open(&publisher).unwrap();

        let project = index
            .search(SearchRequest {
                query: "shared".to_owned(),
                filters: SearchFilters {
                    project_id: Some("project_alpha".to_owned()),
                    ..SearchFilters::default()
                },
                ..SearchRequest::default()
            })
            .unwrap();
        assert_eq!(
            project
                .results
                .iter()
                .map(|result| result.note_id.as_str())
                .collect::<HashSet<_>>(),
            HashSet::from(["notes/project", "notes/task"])
        );

        let person = index
            .search(SearchRequest {
                query: "shared".to_owned(),
                filters: SearchFilters {
                    person_id: Some("notes/person".to_owned()),
                    ..SearchFilters::default()
                },
                ..SearchRequest::default()
            })
            .unwrap();
        assert_eq!(
            person
                .results
                .iter()
                .map(|result| result.note_id.as_str())
                .collect::<HashSet<_>>(),
            HashSet::from(["notes/person", "notes/task"])
        );
    }

    #[test]
    fn applies_a_bounded_graph_neighbor_boost() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library/notes");
        fs::create_dir_all(&library).unwrap();
        fs::write(
            library.join("context.md"),
            "# Context\n\nSee [[notes/neighbor]].\n",
        )
        .unwrap();
        fs::write(
            library.join("neighbor.md"),
            "# Candidate one\n\nShared material.\n",
        )
        .unwrap();
        fs::write(
            library.join("unlinked.md"),
            "# Candidate two\n\nShared material.\n",
        )
        .unwrap();
        let compilation = compile_library(&CompileOptions::new(
            root.path().join("library"),
            root.path(),
        ))
        .unwrap();
        let projection = build_index_projection(&compilation);
        assert!(projection.links.iter().any(|link| {
            link.source_note_id == "notes/context" && link.target_note_id == "notes/neighbor"
        }));
        let publisher = IndexPublisher::new(IndexPublisherOptions {
            indexes_root: root.path().join("indexes"),
            library_key: create_library_key(root.path().join("library").as_path()).unwrap(),
        })
        .unwrap();
        publisher.publish(&projection).unwrap();
        let index = TursoKnowledgeIndex::open(&publisher).unwrap();

        let response = index
            .search(SearchRequest {
                query: "shared".to_owned(),
                current_note_id: Some("notes/context".to_owned()),
                ..SearchRequest::default()
            })
            .unwrap();
        let neighbor = response
            .results
            .iter()
            .find(|result| result.note_id == "notes/neighbor")
            .unwrap();
        assert_eq!(neighbor.structured_score, 40.0);
        assert!(
            neighbor
                .explanation_codes
                .contains(&"graph_neighbor".to_owned())
        );
    }

    #[test]
    fn performs_exact_semantic_search_and_deterministic_rrf() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library/notes");
        fs::create_dir_all(&library).unwrap();
        fs::write(
            library.join("warsaw.md"),
            "# Warszawa\n\nZażółć gęślą jaźń w stolicy Polski.\n",
        )
        .unwrap();
        fs::write(
            library.join("database.md"),
            "# Database\n\nRelational tables and transactions.\n",
        )
        .unwrap();
        let compilation = compile_library(&CompileOptions::new(
            root.path().join("library"),
            root.path(),
        ))
        .unwrap();
        let projection = build_index_projection(&compilation);
        let provider = crate::DeterministicEmbeddingProvider::new(32).unwrap();
        let synchronized = crate::EmbeddingCache::new(root.path().join("embeddings.db"))
            .synchronize(&projection, &provider)
            .unwrap();
        let publisher = IndexPublisher::new(IndexPublisherOptions {
            indexes_root: root.path().join("indexes"),
            library_key: create_library_key(root.path().join("library").as_path()).unwrap(),
        })
        .unwrap();
        publisher
            .publish_with_embeddings(&projection, Some(&synchronized.embeddings))
            .unwrap();
        let index = TursoKnowledgeIndex::open(&publisher).unwrap();
        let query_embedding =
            crate::QueryEmbedding::from_provider(&provider, "zażółć gęślą stolica").unwrap();
        let mut incompatible_input = query_embedding.clone();
        incompatible_input.input_version = "different_input_contract".to_owned();
        assert!(
            index
                .search_with_embedding(
                    SearchRequest {
                        query: "polska stolica".to_owned(),
                        mode: SearchMode::Hybrid,
                        ..SearchRequest::default()
                    },
                    incompatible_input,
                )
                .is_err()
        );

        let first = index
            .search_with_embedding(
                SearchRequest {
                    query: "polska stolica".to_owned(),
                    mode: SearchMode::Hybrid,
                    ..SearchRequest::default()
                },
                query_embedding.clone(),
            )
            .unwrap();
        let second = index
            .search_with_embedding(
                SearchRequest {
                    query: "polska stolica".to_owned(),
                    mode: SearchMode::Hybrid,
                    ..SearchRequest::default()
                },
                query_embedding,
            )
            .unwrap();

        assert!(first.semantic_available);
        assert_eq!(first.mode_used, SearchMode::Hybrid);
        assert_eq!(first.results[0].note_id, "notes/warsaw");
        assert_eq!(
            first
                .results
                .iter()
                .map(|result| (&result.note_id, result.final_score))
                .collect::<Vec<_>>(),
            second
                .results
                .iter()
                .map(|result| (&result.note_id, result.final_score))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn computes_typed_cross_domain_analytics_with_sql_aggregates() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library/notes");
        fs::create_dir_all(&library).unwrap();
        fs::write(library.join("one.md"), "# One\n\nAlpha beta gamma.\n").unwrap();
        let compilation = compile_library(&CompileOptions::new(
            root.path().join("library"),
            root.path(),
        ))
        .unwrap();
        let mut projection = build_index_projection(&compilation);
        projection.domain.entities = vec![
            castle_core::IndexEntity {
                kind: castle_core::IndexEntityKind::Task,
                entity_id: "task_one".to_owned(),
                note_id: Some("notes/one".to_owned()),
                ordinal: 0,
                status: "todo".to_owned(),
                entity_date: String::new(),
                project_id: None,
                person_note_ids: Vec::new(),
                payload: serde_json::json!({ "id": "task_one", "status": "todo" }),
            },
            castle_core::IndexEntity {
                kind: castle_core::IndexEntityKind::Task,
                entity_id: "task_two".to_owned(),
                note_id: None,
                ordinal: 1,
                status: "done".to_owned(),
                entity_date: String::new(),
                project_id: None,
                person_note_ids: Vec::new(),
                payload: serde_json::json!({ "id": "task_two", "status": "done" }),
            },
        ];
        let publisher = IndexPublisher::new(IndexPublisherOptions {
            indexes_root: root.path().join("indexes"),
            library_key: create_library_key(root.path().join("library").as_path()).unwrap(),
        })
        .unwrap();
        publisher.publish(&projection).unwrap();
        let overview = TursoKnowledgeIndex::open(&publisher)
            .unwrap()
            .knowledge_overview()
            .unwrap();

        assert_eq!(overview.notes.total, 1);
        assert!(overview.chunks > 0);
        assert_eq!(overview.embedded_chunks, 0);
        assert_eq!(
            overview.entities,
            vec![EntityAnalytics {
                kind: "task".to_owned(),
                total: 2,
                statuses: vec![
                    CountBucket {
                        label: "done".to_owned(),
                        count: 1,
                    },
                    CountBucket {
                        label: "todo".to_owned(),
                        count: 1,
                    },
                ],
            },]
        );
    }
}
