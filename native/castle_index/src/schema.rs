pub const INDEX_SCHEMA_VERSION: u32 = 2;

pub const SCHEMA_V2: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE index_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE notes (
  note_id TEXT PRIMARY KEY,
  record_id TEXT,
  record_type TEXT,
  section TEXT NOT NULL,
  section_label TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  source_file TEXT NOT NULL UNIQUE,
  route TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  compiled_markdown TEXT NOT NULL,
  search_text TEXT NOT NULL,
  normalized_search_text TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  source_line_offset INTEGER NOT NULL,
  created_at TEXT,
  modified_at TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  reading_minutes INTEGER NOT NULL,
  pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
  status TEXT NOT NULL,
  frontmatter_json TEXT NOT NULL
);

CREATE INDEX notes_record_id ON notes(record_id);
CREATE INDEX notes_record_type ON notes(record_type);
CREATE INDEX notes_section ON notes(section);
CREATE INDEX notes_status ON notes(status);
CREATE INDEX notes_modified_at ON notes(modified_at);

CREATE TABLE note_headings (
  note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  depth INTEGER NOT NULL,
  label TEXT NOT NULL,
  slug TEXT NOT NULL,
  source_line INTEGER NOT NULL,
  PRIMARY KEY (note_id, ordinal)
);

CREATE TABLE note_tags (
  note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  normalized_tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX note_tags_normalized ON note_tags(normalized_tag);

CREATE TABLE note_aliases (
  note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  PRIMARY KEY (note_id, alias)
);
CREATE INDEX note_aliases_normalized ON note_aliases(normalized_alias);

CREATE TABLE note_links (
  source_note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  target_note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('outgoing', 'related')),
  source_line INTEGER,
  PRIMARY KEY (source_note_id, target_note_id, kind)
);
CREATE INDEX note_links_target ON note_links(target_note_id, kind);

CREATE TABLE search_documents (
  note_id TEXT PRIMARY KEY REFERENCES notes(note_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  aliases TEXT NOT NULL,
  tags TEXT NOT NULL,
  headings TEXT NOT NULL,
  body TEXT NOT NULL,
  normalized_text TEXT NOT NULL
);

CREATE TABLE note_chunks (
  chunk_key TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  heading_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  plain_text TEXT NOT NULL,
  search_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL,
  embedding BLOB,
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  UNIQUE (note_id, ordinal)
);
CREATE INDEX note_chunks_note ON note_chunks(note_id, ordinal);
CREATE INDEX note_chunks_content_hash ON note_chunks(content_hash);

CREATE TABLE domain_entities (
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  note_id TEXT,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL,
  entity_date TEXT NOT NULL,
  project_id TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (kind, entity_id)
);
CREATE INDEX domain_entities_note ON domain_entities(note_id);
CREATE INDEX domain_entities_order ON domain_entities(kind, ordinal);
CREATE INDEX domain_entities_status ON domain_entities(kind, status);
CREATE INDEX domain_entities_date ON domain_entities(kind, entity_date);
CREATE INDEX domain_entities_project ON domain_entities(kind, project_id);

CREATE TABLE domain_entity_people (
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  person_note_id TEXT NOT NULL,
  PRIMARY KEY (kind, entity_id, person_note_id),
  FOREIGN KEY (kind, entity_id) REFERENCES domain_entities(kind, entity_id) ON DELETE CASCADE
);
CREATE INDEX domain_entity_people_person ON domain_entity_people(person_note_id, kind);

CREATE TABLE note_entity_references (
  note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  reference_kind TEXT NOT NULL CHECK (reference_kind IN ('person', 'project')),
  reference_id TEXT NOT NULL,
  PRIMARY KEY (note_id, reference_kind, reference_id)
);
CREATE INDEX note_entity_references_lookup
  ON note_entity_references(reference_kind, reference_id, note_id);

CREATE TABLE domain_documents (
  kind TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);
"#;
