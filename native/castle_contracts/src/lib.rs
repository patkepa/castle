use schemars::{JsonSchema, schema_for};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const RPC_PROTOCOL_VERSION: u32 = 1;
pub const CONTENT_CONTRACT_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolHandshake {
    pub protocol_version: u32,
    pub content_contract_version: u32,
    pub server_version: String,
    pub capabilities: Vec<String>,
}

impl ProtocolHandshake {
    pub fn current(capabilities: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            protocol_version: RPC_PROTOCOL_VERSION,
            content_contract_version: CONTENT_CONTRACT_VERSION,
            server_version: env!("CARGO_PKG_VERSION").to_owned(),
            capabilities: capabilities.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceState {
    pub protocol: ProtocolHandshake,
    pub generated_at: String,
    pub public_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceDocument {
    pub note_id: String,
    pub source_file: String,
    pub markdown: String,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveSourceInput {
    pub note_id: String,
    pub source_file: String,
    pub markdown: String,
    pub expected_revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateSourceInput {
    pub note_id: String,
    pub source_file: String,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderInput {
    pub source_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSourceInput {
    pub note_id: String,
    pub source_file: String,
    pub expected_revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFolderInput {
    pub source_directory: String,
    pub recursive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSourceInput {
    pub note_id: String,
    pub source_file: String,
    pub trash_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MoveSourceInput {
    pub note_id: String,
    pub source_file: String,
    pub destination_source_file: String,
    pub expected_revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveSourceResult {
    pub note_id: String,
    pub source_file: String,
    pub revision: String,
    pub generated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publication_pending: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSourceResult {
    pub note_id: String,
    pub source_file: String,
    pub generated_at: String,
    pub trash_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publication_pending: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderResult {
    pub source_directory: String,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFolderResult {
    pub source_directory: String,
    pub entry_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trash_id: Option<String>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MoveSourceResult {
    pub note_id: String,
    pub previous_source_file: String,
    pub source_file: String,
    pub route: String,
    pub revision: String,
    pub generated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publication_pending: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SectionSummary {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolder {
    pub section_id: String,
    pub directory: Vec<String>,
    pub entry_count: usize,
    pub note_count: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PersonContactKind {
    Phone,
    Email,
    Address,
    Website,
    Social,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSidebarFact {
    pub label: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersonContact {
    pub kind: PersonContactKind,
    pub label: String,
    pub value: String,
    pub detail: String,
    pub href: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersonNoteSidebar {
    pub kind: String,
    pub title: String,
    pub avatar_url: String,
    pub facts: Vec<NoteSidebarFact>,
    pub contacts: Vec<PersonContact>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogNote {
    pub id: String,
    pub section: String,
    pub section_label: String,
    pub relative_path: String,
    pub source_file: String,
    pub route: String,
    pub title: String,
    pub excerpt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub status: String,
    pub avatar_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    pub modified_at: String,
    pub content_path: String,
    pub word_count: usize,
    pub reading_minutes: usize,
    pub pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sidebar: Option<PersonNoteSidebar>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Todo,
    InProgress,
    Blocked,
    Done,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::InProgress => "in_progress",
            Self::Blocked => "blocked",
            Self::Done => "done",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskPerson {
    pub note_id: String,
    pub name: String,
    pub route: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectReference {
    pub id: String,
    pub title: String,
    pub route: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSubtask {
    pub id: String,
    pub title: String,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub note_id: String,
    pub route: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub target_date: String,
    pub target_time: String,
    pub estimate_minutes: i64,
    pub created_at: String,
    pub completed_at: String,
    pub sort_order: f64,
    pub modified_at: String,
    pub tags: Vec<String>,
    pub people: Vec<TaskPerson>,
    pub project: Option<ProjectReference>,
    pub subtasks: Vec<TaskSubtask>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Idea,
    Planned,
    Active,
    Paused,
    Completed,
    Archived,
}

impl ProjectStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idea => "idea",
            Self::Planned => "planned",
            Self::Active => "active",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Archived => "archived",
        }
    }

    pub fn rank(self) -> usize {
        match self {
            Self::Active => 0,
            Self::Planned => 1,
            Self::Idea => 2,
            Self::Paused => 3,
            Self::Completed => 4,
            Self::Archived => 5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub note_id: String,
    pub route: String,
    pub title: String,
    pub description: String,
    pub status: ProjectStatus,
    pub started_at: String,
    pub completed_at: String,
    pub modified_at: String,
    pub tags: Vec<String>,
    pub people: Vec<TaskPerson>,
    pub task_ids: Vec<String>,
    pub event_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CalendarEventKind {
    Work,
    Social,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CalendarEventRecurrence {
    Weekly,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventPerson {
    pub note_id: String,
    pub name: String,
    pub route: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub note_id: String,
    pub route: String,
    pub date: String,
    pub start_time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<CalendarEventRecurrence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_until: Option<String>,
    pub title: String,
    pub description: String,
    pub kind: CalendarEventKind,
    pub people: Vec<CalendarEventPerson>,
    pub project: Option<ProjectReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Shortcut {
    pub category: String,
    pub label: String,
    pub description: String,
    pub href: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutCollection {
    pub id: String,
    pub label: String,
    pub sort_order: i64,
    pub shortcuts: Vec<Shortcut>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBase {
    pub contract_version: u32,
    pub generated_at: String,
    pub sections: Vec<SectionSummary>,
    pub folders: Vec<LibraryFolder>,
    pub notes: Vec<CatalogNote>,
    pub calendar_events: Vec<CalendarEvent>,
    pub tasks: Vec<Task>,
    pub projects: Vec<Project>,
    pub shortcut_collections: Vec<ShortcutCollection>,
}

/// The only section metadata that may cross the static publication boundary.
/// Adding a field here is a deliberate public API and privacy decision.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicSectionSummary {
    pub id: String,
    pub label: String,
    pub count: usize,
}

/// The deny-by-default catalog projection consumed by the read-only Astro app.
/// Source metadata, personal sidebars, tags, status, and timestamps stay in the
/// desktop snapshot unless they are explicitly added to this contract.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicCatalogNote {
    pub id: String,
    pub section: String,
    pub section_label: String,
    pub source_file: String,
    pub route: String,
    pub title: String,
    pub excerpt: String,
    pub content_path: String,
    pub word_count: usize,
    pub reading_minutes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicKnowledgeBase {
    pub contract_version: u32,
    pub generated_at: String,
    pub sections: Vec<PublicSectionSummary>,
    pub notes: Vec<PublicCatalogNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicNoteContent {
    pub id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedResourceDescriptor {
    pub path: String,
    pub sha256: String,
    pub item_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedResourceManifest {
    pub contract_version: u32,
    pub generated_at: String,
    pub resources: BTreeMap<String, GeneratedResourceDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotesResource {
    pub contract_version: u32,
    pub generated_at: String,
    pub notes: Vec<CatalogNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TasksResource {
    pub contract_version: u32,
    pub generated_at: String,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsResource {
    pub contract_version: u32,
    pub generated_at: String,
    pub projects: Vec<Project>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarResource {
    pub contract_version: u32,
    pub generated_at: String,
    pub calendar_events: Vec<CalendarEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EntityDelta<T> {
    pub upserted: Vec<T>,
    pub removed_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ordered_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompilationDelta {
    pub contract_version: u32,
    pub generated_at: String,
    pub sections: Vec<SectionSummary>,
    pub folders: Vec<LibraryFolder>,
    pub notes: EntityDelta<CatalogNote>,
    pub tasks: EntityDelta<Task>,
    pub projects: EntityDelta<Project>,
    pub calendar_events: EntityDelta<CalendarEvent>,
    pub shortcut_collections: Vec<ShortcutCollection>,
    pub mutable_resource_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskFields {
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub target_date: String,
    pub target_time: String,
    pub estimate_minutes: i64,
    pub project_id: String,
    pub people_ids: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TaskCommand {
    Update { fields: TaskFields },
    ChangeStatus { status: TaskStatus },
    Move { status: TaskStatus, sort_order: f64 },
    ToggleSubtask { subtask_id: String },
    AddSubtask { title: String },
    RemoveSubtask { subtask_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MutateTaskInput {
    pub task_id: String,
    pub command: TaskCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub fields: TaskFields,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskMutationResult {
    pub source: SaveSourceResult,
    pub task: Task,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTaskInput {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTaskResult {
    pub source: DeleteSourceResult,
    pub task: Task,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreTaskInput {
    pub task_id: String,
    pub note_id: String,
    pub source_file: String,
    pub trash_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PersonStatus {
    Active,
    Former,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PersonRelation {
    Positive,
    Neutral,
    Flirty,
    Mixed,
    Negative,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersonFields {
    pub name: String,
    pub nickname: String,
    pub birthday: String,
    pub birthplace: String,
    pub nationality: String,
    pub status: PersonStatus,
    pub alignments: Vec<String>,
    pub relation: PersonRelation,
    pub known_from: Vec<String>,
    pub company: String,
    pub departments: Vec<String>,
    pub location: String,
    pub avatar: String,
    pub tags: Vec<String>,
    pub met: String,
    pub met_through: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePersonInput {
    pub note_id: String,
    pub fields: PersonFields,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersonMutationResult {
    pub source: SaveSourceResult,
    pub note: CatalogNote,
}

#[derive(Debug, JsonSchema)]
#[allow(dead_code)]
pub struct CastleContractBundle {
    pub protocol_handshake: ProtocolHandshake,
    pub service_state: ServiceState,
    pub source_document: SourceDocument,
    pub save_source_input: SaveSourceInput,
    pub create_source_input: CreateSourceInput,
    pub create_folder_input: CreateFolderInput,
    pub delete_source_input: DeleteSourceInput,
    pub delete_folder_input: DeleteFolderInput,
    pub restore_source_input: RestoreSourceInput,
    pub move_source_input: MoveSourceInput,
    pub save_source_result: SaveSourceResult,
    pub delete_source_result: DeleteSourceResult,
    pub create_folder_result: CreateFolderResult,
    pub delete_folder_result: DeleteFolderResult,
    pub move_source_result: MoveSourceResult,
    pub knowledge_base: KnowledgeBase,
    pub public_knowledge_base: PublicKnowledgeBase,
    pub public_note_content: PublicNoteContent,
    pub generated_resource_manifest: GeneratedResourceManifest,
    pub notes_resource: NotesResource,
    pub tasks_resource: TasksResource,
    pub projects_resource: ProjectsResource,
    pub calendar_resource: CalendarResource,
    pub compilation_delta: CompilationDelta,
    pub mutate_task_input: MutateTaskInput,
    pub create_task_input: CreateTaskInput,
    pub task_mutation_result: TaskMutationResult,
    pub delete_task_input: DeleteTaskInput,
    pub delete_task_result: DeleteTaskResult,
    pub restore_task_input: RestoreTaskInput,
    pub update_person_input: UpdatePersonInput,
    pub person_mutation_result: PersonMutationResult,
}

pub fn contract_schema() -> serde_json::Value {
    let mut schema = serde_json::to_value(schema_for!(CastleContractBundle))
        .expect("Castle contract schema must serialize");
    let root = schema
        .as_object_mut()
        .expect("Castle contract schema root must be an object");
    root.insert(
        "x-castle-rpc-protocol-version".to_owned(),
        RPC_PROTOCOL_VERSION.into(),
    );
    root.insert(
        "x-castle-content-contract-version".to_owned(),
        CONTENT_CONTRACT_VERSION.into(),
    );
    schema
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_versions_are_explicit() {
        let handshake = ProtocolHandshake::current(["typedMutations"]);
        assert_eq!(handshake.protocol_version, RPC_PROTOCOL_VERSION);
        assert_eq!(handshake.content_contract_version, CONTENT_CONTRACT_VERSION);
    }

    #[test]
    fn schema_contains_transport_and_domain_contracts() {
        let schema = contract_schema();
        let definitions = schema["$defs"].as_object().expect("schema definitions");
        for name in [
            "KnowledgeBase",
            "PublicKnowledgeBase",
            "PublicNoteContent",
            "CompilationDelta",
            "MutateTaskInput",
            "UpdatePersonInput",
        ] {
            assert!(definitions.contains_key(name), "missing {name}");
        }
    }

    #[test]
    fn checked_in_schema_matches_rust_contracts() {
        let checked_in: serde_json::Value = serde_json::from_str(include_str!(
            "../../../packages/contracts/src/castle_contract_schema.json"
        ))
        .expect("checked-in contract schema");
        assert_eq!(
            checked_in,
            contract_schema(),
            "run cargo xtask generate contracts"
        );
    }
}
