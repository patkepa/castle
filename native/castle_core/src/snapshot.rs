use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::LazyLock,
};

use anyhow::{Context, Result};
use image::{ImageFormat, imageops::FilterType};
use regex::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::IndexProjection;
use crate::{CastleCompilation, model::KnowledgeBase};
use castle_contracts::{
    CONTENT_CONTRACT_VERSION, CalendarResource, GeneratedResourceDescriptor,
    GeneratedResourceManifest, NotesResource, ProjectsResource, PublicCatalogNote,
    PublicKnowledgeBase, PublicNoteContent, PublicSectionSummary, TasksResource,
};

const PUBLIC_CATALOG_FIELDS: [&str; 4] = ["contractVersion", "generatedAt", "sections", "notes"];
const PUBLIC_SECTION_FIELDS: [&str; 3] = ["id", "label", "count"];
const PUBLIC_NOTE_FIELDS: [&str; 10] = [
    "id",
    "section",
    "sectionLabel",
    "sourceFile",
    "route",
    "title",
    "excerpt",
    "contentPath",
    "wordCount",
    "readingMinutes",
];
const PUBLIC_NOTE_CONTENT_FIELDS: [&str; 2] = ["id", "content"];
const PUBLIC_ASSET_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "avif"];
static MARKDOWN_ASSET_DESTINATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"!?\[[^\]]*\]\(\s*(?:<([^>\r\n]+)>|([^\s)\r\n]+))"#).unwrap());

const BUILT_IN_OVERRIDE_SOURCE_FILES: [&str; 1] = ["notes/castle_help.md"];
const MAXIMUM_SHEET_BYTES: u64 = 50 * 1024 * 1024;
const MAXIMUM_SHEET_COUNT: usize = 500;
const MAXIMUM_SHEET_FOLDER_DEPTH: usize = 8;
const MAXIMUM_CANVAS_BYTES: u64 = 8 * 1024 * 1024;
const MAXIMUM_CANVAS_COUNT: usize = 500;
const MAXIMUM_CANVAS_FOLDER_DEPTH: usize = 8;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedSheetCatalog {
    generated_at: String,
    sheets: Vec<GeneratedSheet>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedSheet {
    relative_path: String,
    name: String,
    size: u64,
    modified_at: String,
    content_path: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedCanvasCatalog {
    generated_at: String,
    canvases: Vec<GeneratedCanvas>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedCanvas {
    relative_path: String,
    name: String,
    size: u64,
    modified_at: String,
    content_path: String,
}

#[derive(Debug, Clone)]
pub struct SnapshotOptions {
    pub generated_path: Option<PathBuf>,
    pub public_root: PathBuf,
    pub profile: SnapshotProfile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotProfile {
    Desktop,
    Public,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicSnapshotPolicy {
    profile: &'static str,
    contract_version: u32,
    catalog_fields: &'static [&'static str],
    section_fields: &'static [&'static str],
    note_fields: &'static [&'static str],
    note_content_fields: &'static [&'static str],
    asset_extensions: &'static [&'static str],
}

#[derive(Debug, Clone, Default)]
pub struct SnapshotDelta {
    pub changed_note_ids: HashSet<String>,
    pub search_index_changed: bool,
    pub relationship_graph_changed: bool,
    pub sync_assets: bool,
}

pub fn write_snapshot(compilation: &CastleCompilation, options: &SnapshotOptions) -> Result<()> {
    write_snapshot_contents(compilation, options)
}

pub fn write_snapshot_with_projection(
    compilation: &CastleCompilation,
    _projection: &IndexProjection,
    options: &SnapshotOptions,
) -> Result<()> {
    write_snapshot_contents(compilation, options)
}

fn write_snapshot_contents(
    compilation: &CastleCompilation,
    options: &SnapshotOptions,
) -> Result<()> {
    match options.profile {
        SnapshotProfile::Desktop => write_desktop_snapshot_contents(compilation, options),
        SnapshotProfile::Public => write_public_snapshot_contents(compilation, options),
    }
}

fn write_desktop_snapshot_contents(
    compilation: &CastleCompilation,
    options: &SnapshotOptions,
) -> Result<()> {
    let knowledge_base = &compilation.knowledge_base;
    let note_resources = &compilation.note_resources;
    let search_index = &compilation.search_index;
    if let Some(generated_path) = &options.generated_path {
        if let Some(parent) = generated_path.parent() {
            fs::create_dir_all(parent)?;
        }
        atomic_write(generated_path, &serde_json::to_vec_pretty(knowledge_base)?)?;
    }

    let generated_root = options.public_root.join("generated");
    let notes_root = generated_root.join("notes");
    fs::create_dir_all(&notes_root)?;
    let mut desired_notes = HashSet::new();
    for resource in note_resources {
        let relative = resource
            .content_path
            .trim_start_matches('/')
            .trim_start_matches("generated/");
        desired_notes.insert(relative.to_owned());
        let destination = generated_root.join(relative);
        let bytes = serde_json::to_vec(&resource.content)?;
        let current_length = fs::metadata(&destination).ok().map(|value| value.len());
        if current_length != Some(bytes.len() as u64) {
            fs::write(&destination, bytes)?;
        }
    }
    atomic_write(
        &generated_root.join("search-index.json"),
        &serde_json::to_vec(search_index)?,
    )?;
    let relationship_graph = graph_with_thumbnails(
        compilation,
        &compilation.relationship_graph,
        &generated_root,
    )?;
    atomic_write(
        &generated_root.join("relationship-graph.json"),
        &serde_json::to_vec(&relationship_graph)?,
    )?;
    atomic_write(
        &generated_root.join("bootstrap.json"),
        &serde_json::to_vec(&bootstrap_knowledge_base(knowledge_base))?,
    )?;
    // Catalog is the snapshot pointer, so publish it after all resources it
    // references are durable.
    atomic_write(
        &generated_root.join("catalog.json"),
        &serde_json::to_vec(knowledge_base)?,
    )?;
    write_domain_resources(knowledge_base, &generated_root)?;
    for entry in fs::read_dir(&notes_root)? {
        let entry = entry?;
        let relative = format!("notes/{}", entry.file_name().to_string_lossy());
        if entry.file_type()?.is_file() && !desired_notes.contains(&relative) {
            fs::remove_file(entry.path())?;
        }
    }
    sync_assets(compilation, &options.public_root)?;
    sync_sheets(compilation, &options.public_root)?;
    sync_canvases(compilation, &options.public_root)?;
    Ok(())
}

fn write_public_snapshot_contents(
    compilation: &CastleCompilation,
    options: &SnapshotOptions,
) -> Result<()> {
    let catalog = public_knowledge_base(&compilation.knowledge_base);
    if let Some(generated_path) = &options.generated_path {
        if let Some(parent) = generated_path.parent() {
            fs::create_dir_all(parent)?;
        }
        atomic_write(generated_path, &serde_json::to_vec_pretty(&catalog)?)?;
    }

    let generated_root = options.public_root.join("generated");
    let notes_root = generated_root.join("notes");
    fs::create_dir_all(&notes_root)?;
    let mut desired_notes = HashSet::new();
    for resource in &compilation.note_resources {
        let relative = resource
            .content_path
            .trim_start_matches('/')
            .trim_start_matches("generated/");
        desired_notes.insert(relative.to_owned());
        atomic_write(
            &generated_root.join(relative),
            &serde_json::to_vec(&PublicNoteContent {
                id: resource.content.id.clone(),
                content: resource.content.content.clone(),
            })?,
        )?;
    }
    remove_stale_note_resources(&notes_root, &desired_notes)?;
    remove_private_generated_resources(&generated_root)?;
    sync_public_assets(compilation, &options.public_root)?;
    atomic_write(
        &generated_root.join("public-profile.json"),
        &serde_json::to_vec_pretty(&PublicSnapshotPolicy {
            profile: "public",
            contract_version: CONTENT_CONTRACT_VERSION,
            catalog_fields: &PUBLIC_CATALOG_FIELDS,
            section_fields: &PUBLIC_SECTION_FIELDS,
            note_fields: &PUBLIC_NOTE_FIELDS,
            note_content_fields: &PUBLIC_NOTE_CONTENT_FIELDS,
            asset_extensions: &PUBLIC_ASSET_EXTENSIONS,
        })?,
    )?;
    // Catalog is the publication pointer, so publish it last.
    atomic_write(
        &generated_root.join("catalog.json"),
        &serde_json::to_vec(&catalog)?,
    )?;
    Ok(())
}

fn public_knowledge_base(knowledge_base: &KnowledgeBase) -> PublicKnowledgeBase {
    PublicKnowledgeBase {
        contract_version: knowledge_base.contract_version,
        generated_at: knowledge_base.generated_at.clone(),
        sections: knowledge_base
            .sections
            .iter()
            .map(|section| PublicSectionSummary {
                id: section.id.clone(),
                label: section.label.clone(),
                count: section.count,
            })
            .collect(),
        notes: knowledge_base
            .notes
            .iter()
            .map(|note| PublicCatalogNote {
                id: note.id.clone(),
                section: note.section.clone(),
                section_label: note.section_label.clone(),
                source_file: note.source_file.clone(),
                route: note.route.clone(),
                title: note.title.clone(),
                excerpt: note.excerpt.clone(),
                content_path: note.content_path.clone(),
                word_count: note.word_count,
                reading_minutes: note.reading_minutes,
            })
            .collect(),
    }
}

fn remove_stale_note_resources(notes_root: &Path, desired_notes: &HashSet<String>) -> Result<()> {
    for entry in fs::read_dir(notes_root)? {
        let entry = entry?;
        let relative = format!("notes/{}", entry.file_name().to_string_lossy());
        if entry.file_type()?.is_file() && !desired_notes.contains(&relative) {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

fn remove_private_generated_resources(generated_root: &Path) -> Result<()> {
    for entry in fs::read_dir(generated_root)? {
        let entry = entry?;
        let name = entry.file_name();
        if matches!(
            name.to_str(),
            Some("notes" | "catalog.json" | "public-profile.json")
        ) {
            continue;
        }
        if entry.file_type()?.is_dir() {
            fs::remove_dir_all(entry.path())?;
        } else {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

pub fn write_incremental_snapshot(
    compilation: &CastleCompilation,
    options: &SnapshotOptions,
    delta: &SnapshotDelta,
) -> Result<()> {
    anyhow::ensure!(
        options.profile == SnapshotProfile::Desktop,
        "public snapshots must be written atomically with write_snapshot"
    );
    let knowledge_base = &compilation.knowledge_base;
    let generated_root = options.public_root.join("generated");
    write_incremental_note_resources(compilation, options, &delta.changed_note_ids)?;
    fs::create_dir_all(&generated_root)?;
    if delta.search_index_changed {
        atomic_write(
            &generated_root.join("search-index.json"),
            &serde_json::to_vec(&compilation.search_index)?,
        )?;
    }
    if delta.relationship_graph_changed {
        let relationship_graph = graph_with_thumbnails(
            compilation,
            &compilation.relationship_graph,
            &generated_root,
        )?;
        atomic_write(
            &generated_root.join("relationship-graph.json"),
            &serde_json::to_vec(&relationship_graph)?,
        )?;
    }
    atomic_write(
        &generated_root.join("bootstrap.json"),
        &serde_json::to_vec(&bootstrap_knowledge_base(knowledge_base))?,
    )?;
    atomic_write(
        &generated_root.join("catalog.json"),
        &serde_json::to_vec(knowledge_base)?,
    )?;
    write_domain_resources(knowledge_base, &generated_root)?;
    if delta.sync_assets {
        sync_assets(compilation, &options.public_root)?;
        sync_sheets(compilation, &options.public_root)?;
        sync_canvases(compilation, &options.public_root)?;
    }
    Ok(())
}

pub fn write_incremental_note_resources(
    compilation: &CastleCompilation,
    options: &SnapshotOptions,
    changed_note_ids: &HashSet<String>,
) -> Result<()> {
    anyhow::ensure!(
        options.profile == SnapshotProfile::Desktop,
        "public note resources must be written atomically with write_snapshot"
    );
    let generated_root = options.public_root.join("generated");
    fs::create_dir_all(generated_root.join("notes"))?;
    for resource in compilation
        .note_resources
        .iter()
        .filter(|resource| changed_note_ids.contains(&resource.content.id))
    {
        let relative = resource
            .content_path
            .trim_start_matches('/')
            .trim_start_matches("generated/");
        let destination = generated_root.join(relative);
        if !destination.is_file() {
            atomic_write(&destination, &serde_json::to_vec(&resource.content)?)?;
        }
    }
    Ok(())
}

fn graph_with_thumbnails(
    compilation: &CastleCompilation,
    relationship_graph: &Value,
    generated_root: &Path,
) -> Result<Value> {
    let mut graph = relationship_graph.clone();
    let mut avatar_urls = HashSet::new();
    collect_avatar_urls(&graph, &mut avatar_urls);
    let avatars_root = generated_root.join("avatars");
    fs::create_dir_all(&avatars_root)?;
    let mut desired_files = HashSet::new();
    let mut replacements = std::collections::HashMap::new();

    for source in &compilation.asset_files {
        let relative = source.strip_prefix(&compilation.library_root)?;
        let public_relative = if relative.starts_with("assets") {
            relative.to_owned()
        } else {
            PathBuf::from("content-assets").join(relative)
        };
        let source_url = uri_path(&format!(
            "/{}",
            public_relative.to_string_lossy().replace('\\', "/")
        ));
        if !avatar_urls.contains(source_url.as_str()) {
            continue;
        }

        let bytes = fs::read(source)?;
        let Ok(image) = image::load_from_memory(&bytes) else {
            // Browsers can render formats (notably SVG) that the thumbnailer
            // cannot decode. Keep the original graph URL in that case.
            continue;
        };
        let mut hasher = Sha256::new();
        hasher.update(b"castle-graph-avatar-v1\0");
        hasher.update(&bytes);
        let digest = format!("{:x}", hasher.finalize());
        let file_name = format!("{digest}.webp");
        desired_files.insert(file_name.clone());
        let destination = avatars_root.join(&file_name);
        if !destination.is_file() {
            let thumbnail = image.resize_to_fill(128, 128, FilterType::Lanczos3);
            let mut output = Cursor::new(Vec::new());
            thumbnail.write_to(&mut output, ImageFormat::WebP)?;
            atomic_write(&destination, output.get_ref())?;
        }
        replacements.insert(source_url, format!("/generated/avatars/{file_name}"));
    }

    rewrite_avatar_urls(&mut graph, &replacements);
    for entry in fs::read_dir(&avatars_root)? {
        let entry = entry?;
        if entry.file_type()?.is_file()
            && !desired_files.contains(&entry.file_name().to_string_lossy().into_owned())
        {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(graph)
}

fn collect_avatar_urls<'a>(value: &'a Value, avatars: &mut HashSet<&'a str>) {
    match value {
        Value::Array(values) => {
            for value in values {
                collect_avatar_urls(value, avatars);
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                if key == "avatarUrl" {
                    if let Some(url) = value.as_str().filter(|url| !url.is_empty()) {
                        avatars.insert(url);
                    }
                } else {
                    collect_avatar_urls(value, avatars);
                }
            }
        }
        _ => {}
    }
}

fn rewrite_avatar_urls(
    value: &mut Value,
    replacements: &std::collections::HashMap<String, String>,
) {
    match value {
        Value::Array(values) => {
            for value in values {
                rewrite_avatar_urls(value, replacements);
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                if key == "avatarUrl" {
                    if let Some(replacement) = value.as_str().and_then(|url| replacements.get(url))
                    {
                        *value = Value::String(replacement.clone());
                    }
                } else {
                    rewrite_avatar_urls(value, replacements);
                }
            }
        }
        _ => {}
    }
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

fn bootstrap_knowledge_base(knowledge_base: &KnowledgeBase) -> KnowledgeBase {
    let mut by_modified = knowledge_base.notes.clone();
    by_modified.sort_by(|left, right| {
        right
            .modified_at
            .cmp(&left.modified_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    let mut notes = Vec::new();
    let mut note_ids = HashSet::new();
    for note in by_modified
        .iter()
        .filter(|note| {
            note.pinned || BUILT_IN_OVERRIDE_SOURCE_FILES.contains(&note.source_file.as_str())
        })
        .chain(by_modified.iter().take(6))
        .chain(
            by_modified
                .iter()
                .filter(|note| note.section != "people")
                .take(5),
        )
    {
        if note_ids.insert(note.id.clone()) {
            notes.push(note.clone());
        }
    }

    KnowledgeBase {
        contract_version: knowledge_base.contract_version,
        generated_at: knowledge_base.generated_at.clone(),
        sections: knowledge_base.sections.clone(),
        folders: knowledge_base.folders.clone(),
        notes,
        calendar_events: knowledge_base.calendar_events.clone(),
        tasks: Vec::new(),
        projects: Vec::new(),
        shortcut_collections: knowledge_base.shortcut_collections.clone(),
    }
}

fn write_domain_resources(knowledge_base: &KnowledgeBase, generated_root: &Path) -> Result<()> {
    let domains_root = generated_root.join("domains");
    fs::create_dir_all(&domains_root)?;
    let previous_resources = fs::read(generated_root.join("manifest.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<GeneratedResourceManifest>(&bytes).ok());
    let generated_at = knowledge_base.generated_at.clone();
    let bootstrap = bootstrap_knowledge_base(knowledge_base);
    let payloads = [
        (
            "bootstrap",
            serde_json::to_vec(&bootstrap)?,
            bootstrap.notes.len(),
        ),
        (
            "notes",
            serde_json::to_vec(&NotesResource {
                contract_version: CONTENT_CONTRACT_VERSION,
                generated_at: generated_at.clone(),
                notes: knowledge_base.notes.clone(),
            })?,
            knowledge_base.notes.len(),
        ),
        (
            "tasks",
            serde_json::to_vec(&TasksResource {
                contract_version: CONTENT_CONTRACT_VERSION,
                generated_at: generated_at.clone(),
                tasks: knowledge_base.tasks.clone(),
            })?,
            knowledge_base.tasks.len(),
        ),
        (
            "projects",
            serde_json::to_vec(&ProjectsResource {
                contract_version: CONTENT_CONTRACT_VERSION,
                generated_at: generated_at.clone(),
                projects: knowledge_base.projects.clone(),
            })?,
            knowledge_base.projects.len(),
        ),
        (
            "calendar",
            serde_json::to_vec(&CalendarResource {
                contract_version: CONTENT_CONTRACT_VERSION,
                generated_at: generated_at.clone(),
                calendar_events: knowledge_base.calendar_events.clone(),
            })?,
            knowledge_base.calendar_events.len(),
        ),
    ];
    let mut resources = std::collections::BTreeMap::new();
    let mut desired_files = HashSet::new();
    if let Some(previous) = previous_resources {
        desired_files.extend(previous.resources.values().filter_map(|resource| {
            Path::new(&resource.path)
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
        }));
    }
    for (name, bytes, item_count) in payloads {
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let file_name = format!("{name}-{sha256}.json");
        let destination = domains_root.join(&file_name);
        if !destination.is_file() {
            atomic_write(&destination, &bytes)?;
        }
        desired_files.insert(file_name.clone());
        resources.insert(
            name.to_owned(),
            GeneratedResourceDescriptor {
                path: format!("/generated/domains/{file_name}"),
                sha256,
                item_count,
            },
        );
    }
    for entry in fs::read_dir(&domains_root)? {
        let entry = entry?;
        if entry.file_type()?.is_file()
            && !desired_files.contains(&entry.file_name().to_string_lossy().into_owned())
        {
            fs::remove_file(entry.path())?;
        }
    }
    let manifest = GeneratedResourceManifest {
        contract_version: CONTENT_CONTRACT_VERSION,
        generated_at,
        resources,
    };
    // The manifest is the publication pointer. Write it only after every
    // immutable resource it names is durable.
    atomic_write(
        &generated_root.join("manifest.json"),
        &serde_json::to_vec(&manifest)?,
    )?;
    Ok(())
}

fn sync_assets(compilation: &CastleCompilation, public_root: &Path) -> Result<()> {
    let mut desired = HashSet::new();
    for source in &compilation.asset_files {
        let relative = source.strip_prefix(&compilation.library_root)?;
        let public_relative = if relative.starts_with("assets") {
            relative.to_owned()
        } else {
            PathBuf::from("content-assets").join(relative)
        };
        desired.insert(public_relative.clone());
        let destination = public_root.join(public_relative);
        if destination.is_file() {
            let source_metadata = fs::metadata(source)?;
            let destination_metadata = fs::metadata(&destination)?;
            if source_metadata.len() == destination_metadata.len()
                && source_metadata.modified().ok() == destination_metadata.modified().ok()
            {
                continue;
            }
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source, &destination)
            .with_context(|| format!("could not copy {}", source.display()))?;
    }
    for root in [
        public_root.join("assets"),
        public_root.join("content-assets"),
    ] {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(&root).contents_first(true) {
            let entry = entry?;
            let path = entry.path();
            if entry.file_type().is_dir() {
                let _ = fs::remove_dir(path);
            } else if !desired.contains(path.strip_prefix(public_root)?) {
                fs::remove_file(path)?;
            }
        }
    }
    Ok(())
}

fn sync_public_assets(compilation: &CastleCompilation, public_root: &Path) -> Result<()> {
    let source_files = compilation
        .knowledge_base
        .notes
        .iter()
        .map(|note| (note.id.as_str(), note.source_file.as_str()))
        .collect::<HashMap<_, _>>();
    let mut referenced = HashSet::new();
    for resource in &compilation.note_resources {
        let Some(source_file) = source_files.get(resource.content.id.as_str()) else {
            continue;
        };
        for captures in MARKDOWN_ASSET_DESTINATION.captures_iter(&resource.content.content) {
            let Some(destination) = captures.get(1).or_else(|| captures.get(2)) else {
                continue;
            };
            if let Some(relative) =
                resolve_public_asset_reference(source_file, destination.as_str())
            {
                referenced.insert(relative);
            }
        }
    }

    let mut desired = HashSet::new();
    for source in &compilation.asset_files {
        let relative = source.strip_prefix(&compilation.library_root)?;
        let relative_path = relative.to_string_lossy().replace('\\', "/");
        let extension = relative
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        if !extension
            .as_deref()
            .is_some_and(|value| PUBLIC_ASSET_EXTENSIONS.contains(&value))
            || !referenced.contains(&relative_path)
        {
            continue;
        }
        let public_relative = if relative.starts_with("assets") {
            relative.to_owned()
        } else {
            PathBuf::from("content-assets").join(relative)
        };
        desired.insert(public_relative.clone());
        let destination = public_root.join(&public_relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source, &destination)
            .with_context(|| format!("could not copy public asset {}", source.display()))?;
    }
    remove_stale_assets(public_root, &desired)
}

fn resolve_public_asset_reference(source_file: &str, raw: &str) -> Option<String> {
    let raw = raw.split(['?', '#']).next().unwrap_or(raw);
    if raw.is_empty()
        || raw.starts_with("data:")
        || raw.starts_with("http://")
        || raw.starts_with("https://")
        || raw.starts_with("//")
    {
        return None;
    }
    let decoded = percent_decode(raw)?;
    let relative = if let Some(value) = decoded.strip_prefix("/content-assets/") {
        value.to_owned()
    } else if let Some(value) = decoded.strip_prefix('/') {
        value.to_owned()
    } else if let Some(value) = decoded.strip_prefix("content-assets/") {
        value.to_owned()
    } else if decoded.starts_with("assets/") {
        decoded
    } else {
        let directory = source_file.rsplit_once('/').map_or("", |value| value.0);
        format!("{directory}/{decoded}")
    };
    normalize_public_asset_path(&relative)
}

fn normalize_public_asset_path(value: &str) -> Option<String> {
    let normalized = value.replace('\\', "/");
    let mut parts = Vec::new();
    for part in normalized.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            value => parts.push(value),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = *bytes.get(index + 1)?;
            let low = *bytes.get(index + 2)?;
            decoded.push(hex_value(high)? * 16 + hex_value(low)?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn remove_stale_assets(public_root: &Path, desired: &HashSet<PathBuf>) -> Result<()> {
    for root in [
        public_root.join("assets"),
        public_root.join("content-assets"),
    ] {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(&root).contents_first(true) {
            let entry = entry?;
            let path = entry.path();
            if entry.file_type().is_dir() {
                let _ = fs::remove_dir(path);
            } else if !desired.contains(path.strip_prefix(public_root)?) {
                fs::remove_file(path)?;
            }
        }
    }
    Ok(())
}

/// Publishes the managed spreadsheet library as immutable binary assets plus a
/// small catalog for the full desktop snapshot.
fn sync_sheets(compilation: &CastleCompilation, public_root: &Path) -> Result<()> {
    let sheets_root = compilation.library_root.join("sheets");
    sync_sheets_from_root(
        &sheets_root,
        public_root,
        &compilation.knowledge_base.generated_at,
    )
}

fn sync_sheets_from_root(sheets_root: &Path, public_root: &Path, generated_at: &str) -> Result<()> {
    let generated_root = public_root.join("generated").join("sheets");
    let files_root = generated_root.join("files");
    fs::create_dir_all(&files_root)?;

    let mut sheets = Vec::new();
    let mut desired_files = HashSet::new();
    if sheets_root.is_dir() {
        for entry in WalkDir::new(sheets_root)
            .follow_links(false)
            .sort_by_file_name()
            .into_iter()
            .filter_entry(|entry| {
                entry.path() == sheets_root || !entry.file_name().to_string_lossy().starts_with('.')
            })
        {
            let entry = entry?;
            let path = entry.path();
            let relative = match path.strip_prefix(sheets_root) {
                Ok(relative) if !relative.as_os_str().is_empty() => relative,
                _ => continue,
            };
            let folder_depth = relative.components().count().saturating_sub(1);
            if entry.file_type().is_dir() {
                continue;
            }
            if !entry.file_type().is_file()
                || folder_depth > MAXIMUM_SHEET_FOLDER_DEPTH
                || path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_none_or(|extension| !extension.eq_ignore_ascii_case("ods"))
            {
                continue;
            }

            let metadata = entry.metadata()?;
            if metadata.len() > MAXIMUM_SHEET_BYTES {
                continue;
            }
            let bytes = fs::read(path)?;
            let sha256 = format!("{:x}", Sha256::digest(&bytes));
            let file_name = format!("{sha256}.ods");
            let destination = files_root.join(&file_name);
            if !destination.is_file() {
                atomic_write(&destination, &bytes)?;
            }
            desired_files.insert(file_name.clone());
            let relative_path = relative.to_string_lossy().replace('\\', "/");
            sheets.push(GeneratedSheet {
                name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                relative_path,
                size: metadata.len(),
                modified_at: chrono::DateTime::<chrono::Utc>::from(metadata.modified()?)
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                content_path: format!("/generated/sheets/files/{file_name}"),
            });
            if sheets.len() >= MAXIMUM_SHEET_COUNT {
                break;
            }
        }
    }
    sheets.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    for entry in fs::read_dir(&files_root)? {
        let entry = entry?;
        if entry.file_type()?.is_file()
            && !desired_files.contains(&entry.file_name().to_string_lossy().into_owned())
        {
            fs::remove_file(entry.path())?;
        }
    }
    atomic_write(
        &generated_root.join("catalog.json"),
        &serde_json::to_vec(&GeneratedSheetCatalog {
            generated_at: generated_at.to_owned(),
            sheets,
        })?,
    )?;
    Ok(())
}

/// Publishes JSON Canvas files for the full desktop snapshot.
fn sync_canvases(compilation: &CastleCompilation, public_root: &Path) -> Result<()> {
    sync_canvases_from_root(
        &compilation.library_root.join("canvas"),
        public_root,
        &compilation.knowledge_base.generated_at,
    )
}

fn sync_canvases_from_root(
    canvases_root: &Path,
    public_root: &Path,
    generated_at: &str,
) -> Result<()> {
    let generated_root = public_root.join("generated").join("canvases");
    let files_root = generated_root.join("files");
    fs::create_dir_all(&files_root)?;

    let mut canvases = Vec::new();
    let mut desired_files = HashSet::new();
    if canvases_root.is_dir() {
        for entry in WalkDir::new(canvases_root)
            .follow_links(false)
            .sort_by_file_name()
            .into_iter()
            .filter_entry(|entry| {
                entry.path() == canvases_root
                    || !entry.file_name().to_string_lossy().starts_with('.')
            })
        {
            let entry = entry?;
            let path = entry.path();
            let relative = match path.strip_prefix(canvases_root) {
                Ok(relative) if !relative.as_os_str().is_empty() => relative,
                _ => continue,
            };
            let folder_depth = relative.components().count().saturating_sub(1);
            if entry.file_type().is_dir() {
                continue;
            }
            if !entry.file_type().is_file()
                || folder_depth > MAXIMUM_CANVAS_FOLDER_DEPTH
                || path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_none_or(|extension| !extension.eq_ignore_ascii_case("canvas"))
            {
                continue;
            }

            let metadata = entry.metadata()?;
            if metadata.len() > MAXIMUM_CANVAS_BYTES {
                continue;
            }
            let bytes = fs::read(path)?;
            let sha256 = format!("{:x}", Sha256::digest(&bytes));
            let file_name = format!("{sha256}.canvas");
            let destination = files_root.join(&file_name);
            if !destination.is_file() {
                atomic_write(&destination, &bytes)?;
            }
            desired_files.insert(file_name.clone());
            canvases.push(GeneratedCanvas {
                relative_path: relative.to_string_lossy().replace('\\', "/"),
                name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                size: metadata.len(),
                modified_at: chrono::DateTime::<chrono::Utc>::from(metadata.modified()?)
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                content_path: format!("/generated/canvases/files/{file_name}"),
            });
            if canvases.len() >= MAXIMUM_CANVAS_COUNT {
                break;
            }
        }
    }
    canvases.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    for entry in fs::read_dir(&files_root)? {
        let entry = entry?;
        if entry.file_type()?.is_file()
            && !desired_files.contains(&entry.file_name().to_string_lossy().into_owned())
        {
            fs::remove_file(entry.path())?;
        }
    }
    atomic_write(
        &generated_root.join("catalog.json"),
        &serde_json::to_vec(&GeneratedCanvasCatalog {
            generated_at: generated_at.to_owned(),
            canvases,
        })?,
    )?;
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut temporary =
        tempfile::NamedTempFile::new_in(path.parent().unwrap_or_else(|| Path::new(".")))?;
    use std::io::Write;
    temporary.write_all(bytes)?;
    temporary.as_file_mut().sync_all()?;
    temporary
        .persist(path)
        .map(|_| ())
        .map_err(|error| error.error.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CompileOptions, compile_library};
    use castle_contracts::CatalogNote;

    #[test]
    fn bootstrap_retains_built_in_overrides_outside_the_recent_window() {
        let mut notes = (0..12)
            .map(|index| {
                catalog_note(
                    &format!("notes/recent_{index}"),
                    &format!("notes/recent_{index}.md"),
                    &format!("2026-08-03T12:{index:02}:00Z"),
                )
            })
            .collect::<Vec<_>>();
        notes.push(catalog_note(
            "notes/castle_help",
            "notes/castle_help.md",
            "2020-01-01T00:00:00Z",
        ));
        let knowledge_base = KnowledgeBase {
            contract_version: CONTENT_CONTRACT_VERSION,
            generated_at: "2026-08-03T00:00:00Z".to_owned(),
            sections: Vec::new(),
            folders: Vec::new(),
            notes,
            calendar_events: Vec::new(),
            tasks: Vec::new(),
            projects: Vec::new(),
            shortcut_collections: Vec::new(),
        };

        let bootstrap = bootstrap_knowledge_base(&knowledge_base);
        let bootstrap_ids = bootstrap
            .notes
            .iter()
            .map(|note| note.id.as_str())
            .collect::<HashSet<_>>();
        assert!(bootstrap_ids.contains("notes/castle_help"));
        assert_eq!(bootstrap_ids.len(), bootstrap.notes.len());
    }

    #[test]
    fn manifest_points_only_to_complete_immutable_domain_resources() {
        let root = tempfile::tempdir().unwrap();
        let generated = root.path().join("generated");
        let knowledge_base = KnowledgeBase {
            contract_version: CONTENT_CONTRACT_VERSION,
            generated_at: "2026-08-03T00:00:00Z".to_owned(),
            sections: Vec::new(),
            folders: Vec::new(),
            notes: Vec::new(),
            calendar_events: Vec::new(),
            tasks: Vec::new(),
            projects: Vec::new(),
            shortcut_collections: Vec::new(),
        };

        write_domain_resources(&knowledge_base, &generated).unwrap();
        let manifest: GeneratedResourceManifest =
            serde_json::from_slice(&fs::read(generated.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(
            manifest.resources.keys().cloned().collect::<Vec<_>>(),
            ["bootstrap", "calendar", "notes", "projects", "tasks"]
        );
        for descriptor in manifest.resources.values() {
            let relative = descriptor.path.trim_start_matches("/generated/");
            let bytes = fs::read(generated.join(relative)).unwrap();
            assert_eq!(format!("{:x}", Sha256::digest(bytes)), descriptor.sha256);
        }
    }

    #[test]
    fn publishes_managed_sheets_as_a_read_only_web_snapshot() {
        let root = tempfile::tempdir().unwrap();
        let sheets = root.path().join("library/sheets/planning");
        fs::create_dir_all(&sheets).unwrap();
        let workbook = b"an ods workbook";
        fs::write(sheets.join("budget.ods"), workbook).unwrap();
        fs::write(sheets.join("ignored.txt"), b"not a workbook").unwrap();
        fs::write(sheets.join(".hidden.ods"), b"hidden workbook").unwrap();

        sync_sheets_from_root(
            &root.path().join("library/sheets"),
            root.path(),
            "2026-08-09T12:00:00.000Z",
        )
        .unwrap();

        let catalog: serde_json::Value = serde_json::from_slice(
            &fs::read(root.path().join("generated/sheets/catalog.json")).unwrap(),
        )
        .unwrap();
        let published = &catalog["sheets"];
        assert_eq!(published.as_array().unwrap().len(), 1);
        assert_eq!(published[0]["relativePath"], "planning/budget.ods");
        assert_eq!(published[0]["size"], workbook.len() as u64);
        let content_path = published[0]["contentPath"].as_str().unwrap();
        assert!(content_path.starts_with("/generated/sheets/files/"));
        assert_eq!(
            fs::read(root.path().join(content_path.trim_start_matches('/'))).unwrap(),
            workbook
        );
    }

    #[test]
    fn publishes_managed_canvases_as_a_read_only_web_snapshot() {
        let root = tempfile::tempdir().unwrap();
        let canvases = root.path().join("library/canvas/plans");
        fs::create_dir_all(&canvases).unwrap();
        let canvas = br#"{"nodes":[],"edges":[]}"#;
        fs::write(canvases.join("summer.canvas"), canvas).unwrap();
        fs::write(canvases.join("ignored.json"), b"{}").unwrap();
        fs::write(canvases.join(".hidden.canvas"), canvas).unwrap();

        sync_canvases_from_root(
            &root.path().join("library/canvas"),
            root.path(),
            "2026-08-09T12:00:00.000Z",
        )
        .unwrap();

        let catalog: serde_json::Value = serde_json::from_slice(
            &fs::read(root.path().join("generated/canvases/catalog.json")).unwrap(),
        )
        .unwrap();
        let published = &catalog["canvases"];
        assert_eq!(published.as_array().unwrap().len(), 1);
        assert_eq!(published[0]["relativePath"], "plans/summer.canvas");
        let content_path = published[0]["contentPath"].as_str().unwrap();
        assert!(content_path.starts_with("/generated/canvases/files/"));
        assert_eq!(
            fs::read(root.path().join(content_path.trim_start_matches('/'))).unwrap(),
            canvas
        );
    }

    #[test]
    fn public_snapshot_enforces_field_and_asset_allowlists() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        let public = root.path().join("public");
        fs::create_dir_all(library.join("notes")).unwrap();
        fs::create_dir_all(library.join("assets/images")).unwrap();
        fs::write(
            library.join("notes/hello.md"),
            concat!(
                "---\ntags: [private-tag]\nstatus: private\n---\n",
                "# Hello\n\nPublic body.\n\n",
                "![Published](assets/images/published.png)\n",
                "![Unsafe](assets/images/unsafe.svg)\n",
            ),
        )
        .unwrap();
        fs::write(library.join("assets/images/published.png"), b"published").unwrap();
        fs::write(library.join("assets/images/unreferenced.png"), b"private").unwrap();
        fs::write(
            library.join("assets/images/unsafe.svg"),
            br#"<svg onload="alert(1)"/>"#,
        )
        .unwrap();

        fs::create_dir_all(public.join("generated/domains")).unwrap();
        fs::create_dir_all(public.join("generated/sheets/files")).unwrap();
        fs::create_dir_all(public.join("assets/images")).unwrap();
        fs::write(public.join("generated/search-index.json"), b"private").unwrap();
        fs::write(public.join("generated/domains/tasks.json"), b"private").unwrap();
        fs::write(
            public.join("generated/sheets/files/private.ods"),
            b"private",
        )
        .unwrap();
        fs::write(public.join("assets/images/stale.png"), b"private").unwrap();

        let compilation = compile_library(&CompileOptions::new(&library, root.path())).unwrap();
        write_snapshot(
            &compilation,
            &SnapshotOptions {
                generated_path: None,
                public_root: public.clone(),
                profile: SnapshotProfile::Public,
            },
        )
        .unwrap();

        let catalog: Value =
            serde_json::from_slice(&fs::read(public.join("generated/catalog.json")).unwrap())
                .unwrap();
        assert_object_keys(&catalog, &PUBLIC_CATALOG_FIELDS);
        assert_object_keys(&catalog["sections"][0], &PUBLIC_SECTION_FIELDS);
        assert_object_keys(&catalog["notes"][0], &PUBLIC_NOTE_FIELDS);
        assert!(catalog["notes"][0].get("tags").is_none());
        assert!(catalog.get("tasks").is_none());

        let content_path = catalog["notes"][0]["contentPath"].as_str().unwrap();
        let content: Value = serde_json::from_slice(
            &fs::read(public.join(content_path.trim_start_matches('/'))).unwrap(),
        )
        .unwrap();
        assert_object_keys(&content, &PUBLIC_NOTE_CONTENT_FIELDS);
        assert!(content.get("headings").is_none());

        assert!(public.join("assets/images/published.png").is_file());
        assert!(!public.join("assets/images/unreferenced.png").exists());
        assert!(!public.join("assets/images/unsafe.svg").exists());
        assert!(!public.join("assets/images/stale.png").exists());
        assert!(!public.join("generated/search-index.json").exists());
        assert!(!public.join("generated/domains").exists());
        assert!(!public.join("generated/sheets").exists());

        let policy: Value = serde_json::from_slice(
            &fs::read(public.join("generated/public-profile.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(policy["profile"], "public");
        assert_eq!(
            policy["assetExtensions"],
            serde_json::json!(PUBLIC_ASSET_EXTENSIONS)
        );
    }

    fn assert_object_keys(value: &Value, expected: &[&str]) {
        let mut actual = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        let mut expected = expected.to_vec();
        actual.sort_unstable();
        expected.sort_unstable();
        assert_eq!(actual, expected);
    }

    fn catalog_note(id: &str, source_file: &str, modified_at: &str) -> CatalogNote {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "section": "notes",
            "sectionLabel": "Notes",
            "relativePath": source_file.trim_start_matches("notes/"),
            "sourceFile": source_file,
            "route": format!("/note/{id}"),
            "title": id,
            "excerpt": "",
            "tags": [],
            "aliases": [],
            "status": "",
            "avatarUrl": "",
            "modifiedAt": modified_at,
            "contentPath": "/generated/notes/example.json",
            "wordCount": 0,
            "readingMinutes": 0,
            "pinned": false
        }))
        .unwrap()
    }
}
