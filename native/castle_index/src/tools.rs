use std::sync::Arc;

use anyhow::{Result, anyhow, ensure};
use serde::Serialize;
use serde_json::{Value as JsonValue, json};

use crate::{
    EmbeddingProvider, EntityKind, EntityQuery, KnowledgeIndex, KnowledgeOverview, NoteContext,
    NoteContextRequest, QueryEmbedding, RelatedNotesRequest, SearchFilters, SearchMode,
    SearchRequest, SearchResponse, StructuredQueryResponse,
};

const MAXIMUM_TOOL_RESPONSE_BYTES: usize = 512 * 1024;

#[derive(Clone)]
pub struct CastleToolService {
    index: Arc<dyn KnowledgeIndex>,
    embedding_provider: Option<Arc<dyn EmbeddingProvider>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolServerMetadata {
    pub generation: String,
    pub source_fingerprint: String,
    pub index_schema_version: u32,
    pub semantic_available: bool,
}

impl CastleToolService {
    pub fn new(index: Arc<dyn KnowledgeIndex>) -> Self {
        Self {
            index,
            embedding_provider: None,
        }
    }

    pub fn with_embedding_provider(mut self, provider: Arc<dyn EmbeddingProvider>) -> Self {
        self.embedding_provider = Some(provider);
        self
    }

    pub fn metadata(&self) -> ToolServerMetadata {
        let metadata = self.index.metadata();
        ToolServerMetadata {
            generation: metadata.generation.clone(),
            source_fingerprint: metadata.source_fingerprint.clone(),
            index_schema_version: metadata.index_schema_version,
            semantic_available: metadata.semantic_available,
        }
    }

    pub fn search_knowledge(&self, request: SearchRequest) -> Result<SearchResponse> {
        if request.mode != SearchMode::Lexical && self.index.metadata().semantic_available {
            let semantic = self
                .embedding_provider
                .as_ref()
                .map(|provider| QueryEmbedding::from_provider(provider.as_ref(), &request.query))
                .transpose();
            if let Ok(Some(embedding)) = semantic
                && let Ok(response) = self.index.search_with_embedding(request.clone(), embedding)
            {
                return bounded(response);
            }
        }
        bounded(self.index.search(request)?)
    }

    pub fn search_knowledge_with_embedding(
        &self,
        request: SearchRequest,
        embedding: QueryEmbedding,
    ) -> Result<SearchResponse> {
        bounded(self.index.search_with_embedding(request, embedding)?)
    }

    pub fn read_note(&self, request: NoteContextRequest) -> Result<NoteContext> {
        bounded(self.index.read_note(request)?)
    }

    pub fn read_note_section(
        &self,
        note_id: String,
        start_line: usize,
        end_line: usize,
        max_bytes: Option<usize>,
    ) -> Result<NoteContext> {
        self.read_note(NoteContextRequest {
            note_id,
            start_line: Some(start_line),
            end_line: Some(end_line),
            max_bytes,
        })
    }

    pub fn related_notes(&self, request: RelatedNotesRequest) -> Result<SearchResponse> {
        bounded(self.index.related_notes(request)?)
    }

    pub fn find_people(&self, query: String, limit: Option<usize>) -> Result<SearchResponse> {
        self.search_knowledge(SearchRequest {
            query,
            filters: SearchFilters {
                section: Some("people".to_owned()),
                ..SearchFilters::default()
            },
            limit,
            ..SearchRequest::default()
        })
    }

    pub fn get_person(&self, note_id: String, max_bytes: Option<usize>) -> Result<NoteContext> {
        ensure!(
            note_id.starts_with("person_") || note_id.starts_with("people/"),
            "Castle rejected a non-person identifier"
        );
        self.read_note(NoteContextRequest {
            note_id,
            start_line: None,
            end_line: None,
            max_bytes,
        })
    }

    pub fn list_projects(&self, request: EntityQuery) -> Result<StructuredQueryResponse> {
        bounded(self.index.query_entities(EntityKind::Project, request)?)
    }

    pub fn get_project_context(&self, project_id: String) -> Result<JsonValue> {
        ensure!(!project_id.is_empty(), "Castle project ID cannot be empty");
        let projects = self.index.query_entities(
            EntityKind::Project,
            EntityQuery {
                limit: Some(100),
                ..EntityQuery::default()
            },
        )?;
        let project = projects
            .items
            .into_iter()
            .find(|project| {
                project.get("id").and_then(JsonValue::as_str) == Some(project_id.as_str())
            })
            .ok_or_else(|| anyhow!("Castle could not find project {project_id}"))?;
        let filter = EntityQuery {
            project_id: Some(project_id),
            limit: Some(100),
            ..EntityQuery::default()
        };
        bounded(json!({
            "project": project,
            "tasks": self.index.query_entities(EntityKind::Task, filter.clone())?,
            "events": self.index.query_entities(EntityKind::Event, filter)?,
            "index": self.metadata(),
        }))
    }

    pub fn query_tasks(&self, request: EntityQuery) -> Result<StructuredQueryResponse> {
        bounded(self.index.query_entities(EntityKind::Task, request)?)
    }

    pub fn query_events(&self, request: EntityQuery) -> Result<StructuredQueryResponse> {
        bounded(self.index.query_entities(EntityKind::Event, request)?)
    }

    pub fn query_people(&self, request: EntityQuery) -> Result<StructuredQueryResponse> {
        bounded(self.index.query_entities(EntityKind::Person, request)?)
    }

    pub fn query_relationships(&self, request: EntityQuery) -> Result<StructuredQueryResponse> {
        bounded(
            self.index
                .query_entities(EntityKind::Relationship, request)?,
        )
    }

    pub fn knowledge_overview(&self) -> Result<KnowledgeOverview> {
        bounded(self.index.knowledge_overview()?)
    }
}

fn bounded<T: Serialize>(value: T) -> Result<T> {
    ensure!(
        serde_json::to_vec(&value)?.len() <= MAXIMUM_TOOL_RESPONSE_BYTES,
        "Castle tool response exceeds the maximum serialized size"
    );
    Ok(value)
}
