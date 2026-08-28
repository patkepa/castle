use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use castle_contracts::{CatalogNote, KnowledgeBase, LibraryFolder, SectionSummary};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Heading {
    pub depth: usize,
    pub label: String,
    pub id: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkOccurrence {
    pub anchor_id: String,
    pub context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkGroup {
    pub source_note_id: String,
    pub occurrences: Vec<BacklinkOccurrence>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OutgoingLinkOccurrence {
    pub target_note_id: String,
    pub anchor_id: String,
    pub context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteContent {
    pub id: String,
    pub content: String,
    pub headings: Vec<Heading>,
    pub outgoing_note_ids: Vec<String>,
    pub backlink_note_ids: Vec<String>,
    pub backlinks: Vec<BacklinkGroup>,
    pub related_note_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchEntry {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndex {
    pub generated_at: String,
    pub entries: Vec<SearchEntry>,
}

#[derive(Debug, Clone)]
pub struct NoteResource {
    pub content_path: String,
    pub content: NoteContent,
}

#[derive(Debug, Clone)]
pub(crate) struct SourceNote {
    pub id: String,
    pub section: String,
    pub section_label: String,
    pub relative_path: String,
    pub source_file: String,
    pub route: String,
    pub title: String,
    pub content: String,
    pub excerpt: String,
    pub preview: Option<String>,
    pub headings: Vec<Heading>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub status: String,
    pub avatar_url: String,
    pub created_at: Option<String>,
    pub modified_at: String,
    pub word_count: usize,
    pub reading_minutes: usize,
    pub pinned: bool,
    pub outgoing_note_ids: Vec<String>,
    pub outgoing_link_occurrences: Vec<OutgoingLinkOccurrence>,
    pub backlink_note_ids: Vec<String>,
    pub backlinks: Vec<BacklinkGroup>,
    pub related_note_ids: Vec<String>,
    pub content_line_offset: usize,
    pub content_path: String,
    pub frontmatter: Value,
    pub search_text: String,
    pub obsidian_diagnostics: Vec<Value>,
    pub obsidian_replacement_count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompilationStats {
    pub note_count: usize,
    pub section_count: usize,
    pub record_count: usize,
    pub project_count: usize,
    pub task_count: usize,
    pub relationship_node_count: usize,
    pub calendar_event_count: usize,
    pub obsidian_replacement_count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompilationDiagnostics {
    pub obsidian: Vec<Value>,
    pub record_warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct CastleCompilation {
    pub knowledge_base: KnowledgeBase,
    pub note_resources: Vec<NoteResource>,
    pub relationship_graph: Value,
    pub search_index: SearchIndex,
    pub library_root: PathBuf,
    pub repository_root: PathBuf,
    pub asset_files: Vec<PathBuf>,
    pub source_files_by_note_id: BTreeMap<String, String>,
    pub diagnostics: CompilationDiagnostics,
    pub stats: CompilationStats,
    pub(crate) source_notes: Vec<SourceNote>,
    pub(crate) compiled_notes: Vec<SourceNote>,
    pub(crate) stash_created_at: HashMap<String, String>,
}
