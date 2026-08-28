mod chunking;
mod embedding;
mod embedding_runtime;
mod embedding_scheduler;
mod local_embedding;
mod probe;
mod publisher;
mod queries;
mod schema;
mod tools;

pub use chunking::{CHUNKING_VERSION, KnowledgeChunk, chunk_note};
pub use embedding::{
    DeterministicEmbeddingProvider, EmbeddingCache, EmbeddingCacheStatus,
    EmbeddingCancellationToken, EmbeddingFailureClass, EmbeddingProvider, EmbeddingProviderFailure,
    EmbeddingProviderMetadata, EmbeddingRecord, EmbeddingSet, EmbeddingSyncOptions,
    EmbeddingSyncResult, QueryEmbedding,
};
pub use embedding_runtime::{EmbeddingRuntime, EmbeddingRuntimeState, EmbeddingRuntimeStatus};
pub use embedding_scheduler::{
    EmbeddingEnricher, EmbeddingEnrichmentResult, EmbeddingEnrichmentState, EmbeddingScheduler,
    EmbeddingSchedulerState, EmbeddingSchedulerStatus,
};
pub use local_embedding::{
    LOCAL_EMBEDDING_DIMENSIONS, LOCAL_EMBEDDING_INPUT_VERSION, LOCAL_EMBEDDING_MAXIMUM_BATCH_SIZE,
    LOCAL_EMBEDDING_MODEL, LOCAL_EMBEDDING_MODEL_REVISION, LOCAL_EMBEDDING_PROVIDER,
    LocalEmbeddingOptions, LocalEmbeddingProvider, local_embedding_metadata,
};
pub use probe::{
    TURSO_PINNED_VERSION, TursoCapabilityReport, run_capability_probe, verify_database_integrity,
};
pub use publisher::{
    CurrentIndexManifest, IndexPublisher, IndexPublisherOptions, IndexStatus, PublishResult,
    ResolvedIndex, create_library_key,
};
pub use queries::{
    CountBucket, EntityAnalytics, EntityKind, EntityQuery, KnowledgeIndex, KnowledgeOverview,
    NoteAnalytics, NoteContext, NoteContextRequest, RelatedNotesRequest, SearchFilters, SearchMode,
    SearchRequest, SearchResponse, SearchResult, StructuredQueryResponse, TursoKnowledgeIndex,
};
pub use tools::{CastleToolService, ToolServerMetadata};
