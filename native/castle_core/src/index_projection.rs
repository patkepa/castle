use std::collections::HashMap;

use castle_contracts::{CalendarEvent, PersonNoteSidebar, Project, Task};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    CastleCompilation, CompilationStats,
    model::{BacklinkGroup, Heading, SectionSummary, SourceNote},
};

#[cfg(test)]
use crate::model::{
    CatalogNote, KnowledgeBase, NoteContent, NoteResource, SearchEntry, SearchIndex,
};

pub const INDEX_PROJECTION_SCHEMA_VERSION: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexProjection {
    pub schema_version: u32,
    pub generated_at: String,
    pub source_fingerprint: String,
    pub stats: CompilationStats,
    pub sections: Vec<SectionSummary>,
    pub notes: Vec<IndexNote>,
    pub links: Vec<IndexLink>,
    pub domain: IndexDomainData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexNote {
    pub note_id: String,
    pub record_id: Option<String>,
    pub record_type: Option<String>,
    pub section: String,
    pub section_label: String,
    pub relative_path: String,
    pub source_file: String,
    pub route: String,
    pub title: String,
    pub excerpt: String,
    pub preview: Option<String>,
    pub compiled_markdown: String,
    pub search_text: String,
    pub source_revision: String,
    pub source_line_offset: usize,
    pub created_at: Option<String>,
    pub modified_at: String,
    pub word_count: usize,
    pub reading_minutes: usize,
    pub pinned: bool,
    pub status: String,
    pub avatar_url: String,
    pub content_path: String,
    pub sidebar: Option<PersonNoteSidebar>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub headings: Vec<Heading>,
    pub backlinks: Vec<BacklinkGroup>,
    pub frontmatter: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IndexLinkKind {
    Outgoing,
    Related,
}

impl IndexLinkKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Outgoing => "outgoing",
            Self::Related => "related",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexLink {
    pub source_note_id: String,
    pub target_note_id: String,
    pub kind: IndexLinkKind,
    pub source_line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDomainData {
    pub relationship_graph: Value,
    pub tasks: Vec<Task>,
    pub calendar_events: Vec<CalendarEvent>,
    pub projects: Vec<Project>,
    pub entities: Vec<IndexEntity>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IndexEntityKind {
    Task,
    Event,
    Project,
    Person,
    Relationship,
}

impl IndexEntityKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Event => "event",
            Self::Project => "project",
            Self::Person => "person",
            Self::Relationship => "relationship",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntity {
    pub kind: IndexEntityKind,
    pub entity_id: String,
    pub note_id: Option<String>,
    pub ordinal: usize,
    pub status: String,
    pub entity_date: String,
    pub project_id: Option<String>,
    pub person_note_ids: Vec<String>,
    pub payload: Value,
}

pub fn build_index_projection(compilation: &CastleCompilation) -> IndexProjection {
    let resources = compilation
        .note_resources
        .iter()
        .map(|resource| (resource.content.id.as_str(), &resource.content))
        .collect::<HashMap<_, _>>();
    let sources = compilation
        .source_notes
        .iter()
        .map(|note| (note.id.as_str(), note))
        .collect::<HashMap<_, _>>();
    let search = compilation
        .search_index
        .entries
        .iter()
        .map(|entry| (entry.id.as_str(), entry.text.as_str()))
        .collect::<HashMap<_, _>>();

    let notes = compilation
        .knowledge_base
        .notes
        .iter()
        .filter_map(|catalog| {
            let content = resources.get(catalog.id.as_str())?;
            let source = sources.get(catalog.id.as_str())?;
            Some(IndexNote {
                note_id: catalog.id.clone(),
                record_id: nonempty_frontmatter(source, "id"),
                record_type: nonempty_frontmatter(source, "type"),
                section: catalog.section.clone(),
                section_label: catalog.section_label.clone(),
                relative_path: catalog.relative_path.clone(),
                source_file: catalog.source_file.clone(),
                route: catalog.route.clone(),
                title: catalog.title.clone(),
                excerpt: catalog.excerpt.clone(),
                preview: catalog.preview.clone(),
                compiled_markdown: content.content.clone(),
                search_text: search
                    .get(catalog.id.as_str())
                    .copied()
                    .unwrap_or_default()
                    .to_owned(),
                source_revision: source_projection_revision(source),
                source_line_offset: source.content_line_offset,
                created_at: catalog.created_at.clone(),
                modified_at: catalog.modified_at.clone(),
                word_count: catalog.word_count,
                reading_minutes: catalog.reading_minutes,
                pinned: catalog.pinned,
                status: catalog.status.clone(),
                avatar_url: catalog.avatar_url.clone(),
                content_path: catalog.content_path.clone(),
                sidebar: catalog.sidebar.clone(),
                tags: catalog.tags.clone(),
                aliases: catalog.aliases.clone(),
                headings: content.headings.clone(),
                backlinks: content.backlinks.clone(),
                frontmatter: source.frontmatter.clone(),
            })
        })
        .collect::<Vec<_>>();

    let mut links = compilation
        .note_resources
        .iter()
        .flat_map(|resource| {
            let source_note_id = &resource.content.id;
            let outgoing = resource
                .content
                .outgoing_note_ids
                .iter()
                .map(|target| IndexLink {
                    source_note_id: source_note_id.clone(),
                    target_note_id: target.clone(),
                    kind: IndexLinkKind::Outgoing,
                    source_line: None,
                });
            let related = resource
                .content
                .related_note_ids
                .iter()
                .map(|target| IndexLink {
                    source_note_id: source_note_id.clone(),
                    target_note_id: target.clone(),
                    kind: IndexLinkKind::Related,
                    source_line: None,
                });
            outgoing.chain(related)
        })
        .collect::<Vec<_>>();
    links.sort_by(|left, right| {
        left.source_note_id
            .cmp(&right.source_note_id)
            .then_with(|| left.target_note_id.cmp(&right.target_note_id))
            .then_with(|| left.kind.as_str().cmp(right.kind.as_str()))
    });
    links.dedup_by(|left, right| {
        left.source_note_id == right.source_note_id
            && left.target_note_id == right.target_note_id
            && left.kind == right.kind
    });

    let source_fingerprint = projection_fingerprint(&notes, &links);
    let entities = build_index_entities(
        &compilation.knowledge_base.tasks,
        &compilation.knowledge_base.calendar_events,
        &compilation.knowledge_base.projects,
        &compilation.relationship_graph,
    );
    IndexProjection {
        schema_version: INDEX_PROJECTION_SCHEMA_VERSION,
        generated_at: compilation.knowledge_base.generated_at.clone(),
        source_fingerprint,
        stats: compilation.stats.clone(),
        sections: compilation.knowledge_base.sections.clone(),
        notes,
        links,
        domain: IndexDomainData {
            relationship_graph: compilation.relationship_graph.clone(),
            tasks: compilation.knowledge_base.tasks.clone(),
            calendar_events: compilation.knowledge_base.calendar_events.clone(),
            projects: compilation.knowledge_base.projects.clone(),
            entities,
        },
    }
}

fn build_index_entities(
    tasks: &[Task],
    events: &[CalendarEvent],
    projects: &[Project],
    relationship_graph: &Value,
) -> Vec<IndexEntity> {
    let mut entities = Vec::new();
    entities.extend(tasks.iter().enumerate().map(|(ordinal, task)| {
        IndexEntity {
            kind: IndexEntityKind::Task,
            entity_id: task.id.clone(),
            note_id: Some(task.note_id.clone()),
            ordinal,
            status: task.status.as_str().to_owned(),
            entity_date: task.target_date.clone(),
            project_id: task.project.as_ref().map(|project| project.id.clone()),
            person_note_ids: task
                .people
                .iter()
                .map(|person| person.note_id.clone())
                .collect(),
            payload: serde_json::to_value(task).expect("task contract serializes"),
        }
    }));
    entities.extend(events.iter().enumerate().map(|(ordinal, event)| {
        IndexEntity {
            kind: IndexEntityKind::Event,
            entity_id: event.id.clone(),
            note_id: Some(event.note_id.clone()),
            ordinal,
            status: String::new(),
            entity_date: event.date.clone(),
            project_id: event.project.as_ref().map(|project| project.id.clone()),
            person_note_ids: event
                .people
                .iter()
                .map(|person| person.note_id.clone())
                .collect(),
            payload: serde_json::to_value(event).expect("calendar-event contract serializes"),
        }
    }));
    entities.extend(projects.iter().enumerate().map(|(ordinal, project)| {
        IndexEntity {
            kind: IndexEntityKind::Project,
            entity_id: project.id.clone(),
            note_id: Some(project.note_id.clone()),
            ordinal,
            status: project.status.as_str().to_owned(),
            entity_date: project.started_at.clone(),
            project_id: Some(project.id.clone()),
            person_note_ids: project
                .people
                .iter()
                .map(|person| person.note_id.clone())
                .collect(),
            payload: serde_json::to_value(project).expect("project contract serializes"),
        }
    }));
    if let Some(nodes) = relationship_graph.get("nodes").and_then(Value::as_array) {
        entities.extend(
            nodes
                .iter()
                .filter(|node| node.get("type").and_then(Value::as_str) == Some("person"))
                .enumerate()
                .filter_map(|(ordinal, value)| {
                    let note_id = value.get("noteId")?.as_str()?.to_owned();
                    Some(IndexEntity {
                        kind: IndexEntityKind::Person,
                        entity_id: note_id.clone(),
                        note_id: Some(note_id.clone()),
                        ordinal,
                        status: value
                            .get("status")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_owned(),
                        entity_date: String::new(),
                        project_id: None,
                        person_note_ids: vec![note_id],
                        payload: value.clone(),
                    })
                }),
        );
    }
    if let Some(edges) = relationship_graph.get("edges").and_then(Value::as_array) {
        entities.extend(
            edges
                .iter()
                .filter(|edge| {
                    matches!(
                        edge.get("type").and_then(Value::as_str),
                        Some("person-relation" | "note-link")
                    )
                })
                .enumerate()
                .map(|(ordinal, value)| IndexEntity {
                    kind: IndexEntityKind::Relationship,
                    entity_id: value
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                        .unwrap_or_else(|| format!("relationship_anonymous_{ordinal}")),
                    note_id: None,
                    ordinal,
                    status: value
                        .get("relation")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    entity_date: String::new(),
                    project_id: None,
                    person_note_ids: ["source", "target"]
                        .into_iter()
                        .filter_map(|key| {
                            value
                                .get(key)
                                .and_then(Value::as_str)
                                .and_then(|id| id.strip_prefix("person:"))
                                .map(str::to_owned)
                        })
                        .collect(),
                    payload: value.clone(),
                }),
        );
    }
    entities
}

#[cfg(test)]
impl IndexProjection {
    pub(crate) fn knowledge_base(&self) -> KnowledgeBase {
        KnowledgeBase {
            contract_version: castle_contracts::CONTENT_CONTRACT_VERSION,
            generated_at: self.generated_at.clone(),
            sections: self.sections.clone(),
            folders: Vec::new(),
            notes: self.notes.iter().map(IndexNote::catalog_note).collect(),
            calendar_events: self.domain.calendar_events.clone(),
            tasks: self.domain.tasks.clone(),
            projects: self.domain.projects.clone(),
            shortcut_collections: Vec::new(),
        }
    }

    pub(crate) fn search_index(&self) -> SearchIndex {
        SearchIndex {
            generated_at: self.generated_at.clone(),
            entries: self
                .notes
                .iter()
                .map(|note| SearchEntry {
                    id: note.note_id.clone(),
                    text: note.search_text.clone(),
                })
                .collect(),
        }
    }

    pub(crate) fn note_resources(&self) -> Vec<NoteResource> {
        let mut outgoing = HashMap::<&str, Vec<String>>::new();
        let mut backlinks = HashMap::<&str, Vec<String>>::new();
        let mut related = HashMap::<&str, Vec<String>>::new();
        for link in &self.links {
            match link.kind {
                IndexLinkKind::Outgoing => {
                    outgoing
                        .entry(link.source_note_id.as_str())
                        .or_default()
                        .push(link.target_note_id.clone());
                    backlinks
                        .entry(link.target_note_id.as_str())
                        .or_default()
                        .push(link.source_note_id.clone());
                }
                IndexLinkKind::Related => related
                    .entry(link.source_note_id.as_str())
                    .or_default()
                    .push(link.target_note_id.clone()),
            }
        }
        self.notes
            .iter()
            .map(|note| NoteResource {
                content_path: note.content_path.clone(),
                content: NoteContent {
                    id: note.note_id.clone(),
                    content: note.compiled_markdown.clone(),
                    headings: note.headings.clone(),
                    outgoing_note_ids: outgoing
                        .get(note.note_id.as_str())
                        .cloned()
                        .unwrap_or_default(),
                    backlink_note_ids: backlinks
                        .get(note.note_id.as_str())
                        .cloned()
                        .unwrap_or_default(),
                    backlinks: note.backlinks.clone(),
                    related_note_ids: related
                        .get(note.note_id.as_str())
                        .cloned()
                        .unwrap_or_default(),
                },
            })
            .collect()
    }
}

#[cfg(test)]
impl IndexNote {
    fn catalog_note(&self) -> CatalogNote {
        CatalogNote {
            id: self.note_id.clone(),
            section: self.section.clone(),
            section_label: self.section_label.clone(),
            relative_path: self.relative_path.clone(),
            source_file: self.source_file.clone(),
            route: self.route.clone(),
            title: self.title.clone(),
            excerpt: self.excerpt.clone(),
            preview: self.preview.clone(),
            tags: self.tags.clone(),
            aliases: self.aliases.clone(),
            status: self.status.clone(),
            avatar_url: self.avatar_url.clone(),
            created_at: self.created_at.clone(),
            modified_at: self.modified_at.clone(),
            content_path: self.content_path.clone(),
            word_count: self.word_count,
            reading_minutes: self.reading_minutes,
            pinned: self.pinned,
            sidebar: self.sidebar.clone(),
        }
    }
}

/// Matches the normalization contract used by Castle's static search adapter.
pub fn normalize_search_text(value: &str) -> String {
    crate::normalization::normalize_search_text(value)
}

fn nonempty_frontmatter(note: &SourceNote, key: &str) -> Option<String> {
    note.frontmatter
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn source_projection_revision(note: &SourceNote) -> String {
    let mut digest = Sha256::new();
    digest.update(note.source_file.as_bytes());
    digest.update([0]);
    digest.update(serde_json::to_vec(&note.frontmatter).unwrap_or_default());
    digest.update([0]);
    digest.update(note.content.as_bytes());
    format!("{:x}", digest.finalize())
}

fn projection_fingerprint(notes: &[IndexNote], links: &[IndexLink]) -> String {
    let mut digest = Sha256::new();
    digest.update(INDEX_PROJECTION_SCHEMA_VERSION.to_le_bytes());
    for note in notes {
        digest.update(note.note_id.as_bytes());
        digest.update([0]);
        digest.update(note.source_revision.as_bytes());
        digest.update([0]);
    }
    for link in links {
        digest.update(link.source_note_id.as_bytes());
        digest.update([0]);
        digest.update(link.target_note_id.as_bytes());
        digest.update([0]);
        digest.update(link.kind.as_str().as_bytes());
        digest.update([0]);
    }
    format!("{:x}", digest.finalize())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::{CompileOptions, compile_library};

    use super::*;

    #[test]
    fn projection_contains_compiled_notes_links_and_stable_fingerprint() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        fs::create_dir_all(library.join("notes")).unwrap();
        fs::write(
            library.join("notes/first.md"),
            "---\ntags: [Polska]\n---\n# First\n\nSee [[notes/second]].\n",
        )
        .unwrap();
        fs::write(
            library.join("notes/second.md"),
            "# Żółty second\n\nZażółć gęślą jaźń.\n",
        )
        .unwrap();

        let compilation = compile_library(&CompileOptions::new(&library, root.path())).unwrap();
        let first = build_index_projection(&compilation);
        let second = build_index_projection(&compilation);

        assert_eq!(first.schema_version, INDEX_PROJECTION_SCHEMA_VERSION);
        assert_eq!(first.notes.len(), 2);
        assert_eq!(first.source_fingerprint, second.source_fingerprint);
        assert_eq!(
            serde_json::to_value(first.knowledge_base()).unwrap(),
            serde_json::to_value(&compilation.knowledge_base).unwrap()
        );
        assert_eq!(
            serde_json::to_value(first.search_index()).unwrap(),
            serde_json::to_value(&compilation.search_index).unwrap()
        );
        assert_eq!(
            first
                .note_resources()
                .iter()
                .map(|resource| (
                    resource.content_path.clone(),
                    serde_json::to_value(&resource.content).unwrap()
                ))
                .collect::<HashMap<_, _>>(),
            compilation
                .note_resources
                .iter()
                .map(|resource| (
                    resource.content_path.clone(),
                    serde_json::to_value(&resource.content).unwrap()
                ))
                .collect::<HashMap<_, _>>()
        );
        assert!(first.links.iter().any(|link| {
            link.source_note_id == "notes/first"
                && link.target_note_id == "notes/second"
                && link.kind == IndexLinkKind::Outgoing
        }));
        assert_eq!(normalize_search_text("ŻÓŁTY Łódź"), "zolty lodz");
    }
}
