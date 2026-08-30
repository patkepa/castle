mod calendar;
mod compiler;
mod configuration;
mod frontmatter;
mod index_projection;
mod migrations;
mod model;
mod normalization;
mod obsidian;
mod projects;
mod records;
mod references;
mod relationships;
mod service;
mod shortcuts;
mod sidebar;
mod snapshot;
mod source_storage;
mod structured_mutations;
mod tasks;

pub use compiler::{
    CompileOptions, compile_changed_sources, compile_library, compile_source_overrides,
};
pub use configuration::{CastleConfiguration, load_castle_configuration};
pub use index_projection::{
    INDEX_PROJECTION_SCHEMA_VERSION, IndexDomainData, IndexEntity, IndexEntityKind, IndexLink,
    IndexLinkKind, IndexNote, IndexProjection, build_index_projection, normalize_search_text,
};
pub use migrations::{
    CURRENT_RECORD_SCHEMA_VERSION, MigrationChange, MigrationDiagnostic, MigrationOptions,
    MigrationOutcome, MigrationPlan, MigrationSeverity, apply_record_migrations,
    plan_record_migrations,
};
pub use model::{
    BacklinkGroup, BacklinkOccurrence, CastleCompilation, CompilationStats, Heading, NoteContent,
};
pub use service::{
    CastleService, CompilationDelta, CreateFolderInput, CreateFolderResult, CreateSourceInput,
    DeleteFolderInput, DeleteFolderResult, DeleteSourceInput, DeleteSourceResult, MoveSourceInput,
    MoveSourceResult, RestoreSourceInput, SaveSourceInput, SaveSourceResult, ServiceOptions,
    ServiceState, SourceDocument,
};
pub use snapshot::{
    SnapshotDelta, SnapshotOptions, write_incremental_note_resources, write_incremental_snapshot,
    write_snapshot, write_snapshot_with_projection,
};
pub use source_storage::{SourceConflict, source_revision};
