use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, anyhow, bail};
use castle_contracts::SourceDocument;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::{
    frontmatter::parse_markdown,
    normalization::{first_string, github_slug},
    records::validate_record_frontmatter,
};

const MAXIMUM_MARKDOWN_BYTES: usize = 16 * 1024 * 1024;
static TEMPORARY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub struct SourceConflict;

impl std::fmt::Display for SourceConflict {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("This note changed outside Castle. Reload it before saving your edits.")
    }
}

impl std::error::Error for SourceConflict {}

pub(crate) fn source_document(
    note_id: &str,
    source_file: String,
    markdown: String,
) -> SourceDocument {
    SourceDocument {
        note_id: note_id.to_owned(),
        source_file,
        revision: source_revision(&markdown),
        markdown,
    }
}

pub(crate) fn validate_source_identity(
    note_id: &str,
    source_file: &str,
    markdown: &str,
    library_root: &Path,
) -> Result<()> {
    let parsed =
        parse_markdown(markdown).with_context(|| format!("could not parse {source_file}"))?;
    let explicit_id = first_string(parsed.frontmatter.get("id"));
    let derived_id = if explicit_id.is_empty() {
        source_file
            .strip_suffix(".mdx")
            .or_else(|| source_file.strip_suffix(".md"))
            .unwrap_or(source_file)
            .to_owned()
    } else {
        explicit_id
    };
    if derived_id != note_id {
        bail!("{source_file}: note id \"{derived_id}\" does not match \"{note_id}\"");
    }
    validate_record_frontmatter(&parsed.frontmatter, source_file, note_id, library_root)
}

pub(crate) fn ensure_explicit_note_id(markdown: &str, note_id: &str) -> Result<String> {
    let parsed = parse_markdown(markdown)?;
    if !first_string(parsed.frontmatter.get("id")).is_empty() {
        return Ok(markdown.to_owned());
    }
    let encoded_id = serde_json::to_string(note_id)?;
    if let Some(rest) = markdown.strip_prefix("---\r\n") {
        return Ok(format!("---\r\nid: {encoded_id}\r\n{rest}"));
    }
    if let Some(rest) = markdown.strip_prefix("---\n") {
        return Ok(format!("---\nid: {encoded_id}\n{rest}"));
    }
    Ok(format!("---\nid: {encoded_id}\n---\n\n{markdown}"))
}

pub(crate) fn source_route(source_file: &str) -> String {
    let without_extension = source_file
        .strip_suffix(".mdx")
        .or_else(|| source_file.strip_suffix(".md"))
        .unwrap_or(source_file);
    let mut parts = without_extension.split('/');
    let section = parts.next().unwrap_or_default();
    let path = parts.map(github_slug).collect::<Vec<_>>().join("/");
    format!("/note/{section}/{path}")
}

pub fn source_revision(markdown: &str) -> String {
    format!("{:x}", Sha256::digest(markdown.as_bytes()))
}

pub(crate) fn assert_revision(markdown: &str, expected: &str) -> Result<()> {
    if source_revision(markdown) != expected {
        return Err(SourceConflict.into());
    }
    Ok(())
}

pub(crate) fn validate_note_id(note_id: &str) -> Result<()> {
    if note_id.is_empty() || note_id.len() > 512 {
        bail!("Castle rejected an invalid note ID.");
    }
    Ok(())
}

pub(crate) fn validate_source_file_metadata(source_file: &str) -> Result<()> {
    if source_file.is_empty()
        || source_file.len() > 2048
        || Path::new(source_file).is_absolute()
        || !(source_file.to_ascii_lowercase().ends_with(".md")
            || source_file.to_ascii_lowercase().ends_with(".mdx"))
        || source_file
            .split(['/', '\\'])
            .any(|segment| segment.is_empty() || segment.starts_with('.'))
        || Path::new(source_file)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        bail!("Castle can only open Markdown source documents.");
    }
    Ok(())
}

pub(crate) fn validate_new_source_file(source_file: &str) -> Result<()> {
    if validate_source_file_metadata(source_file).is_err()
        || !source_file.to_ascii_lowercase().ends_with(".md")
    {
        bail!("Castle rejected an invalid source path.");
    }
    Ok(())
}

pub(crate) fn validate_source_directory(source_directory: &str) -> Result<()> {
    let path = Path::new(source_directory);
    let segments = source_directory.split('/').collect::<Vec<_>>();
    if source_directory.is_empty()
        || source_directory.len() > 2048
        || source_directory.contains('\\')
        || path.is_absolute()
        || segments.len() < 2
        || segments.iter().any(|segment| {
            segment.is_empty() || *segment == "." || *segment == ".." || segment.starts_with('.')
        })
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || !matches!(
            segments.first().copied(),
            Some(
                "personal"
                    | "people"
                    | "wiki"
                    | "journal"
                    | "events"
                    | "notes"
                    | "stash"
                    | "playlists"
                    | "projects"
                    | "tasks"
            )
        )
    {
        bail!("Castle can only manage folders inside a supported library section.");
    }
    Ok(())
}

pub(crate) fn validate_trash_id(trash_id: &str) -> Result<()> {
    if trash_id.is_empty()
        || trash_id.len() > 4096
        || Path::new(trash_id).is_absolute()
        || Path::new(trash_id)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        bail!("Castle rejected an invalid trash identifier.");
    }
    Ok(())
}

pub(crate) fn validate_markdown(markdown: &str) -> Result<()> {
    if markdown.len() > MAXIMUM_MARKDOWN_BYTES {
        bail!("Castle rejected an oversized Markdown document.");
    }
    Ok(())
}

pub(crate) fn validate_revision(revision: &str) -> Result<()> {
    if revision.len() != 64
        || !revision
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
    {
        bail!("Castle rejected an invalid source revision.");
    }
    Ok(())
}

pub(crate) fn assert_contained(root: &Path, candidate: &Path) -> Result<()> {
    if candidate == root || !candidate.starts_with(root) {
        bail!("Castle rejected a source path outside the selected library.");
    }
    Ok(())
}

pub(crate) fn atomic_replace(path: &Path, bytes: &[u8]) -> Result<()> {
    let permissions = fs::metadata(path)?.permissions();
    let mut temporary = tempfile::NamedTempFile::new_in(
        path.parent()
            .ok_or_else(|| anyhow!("source path has no parent"))?,
    )?;
    temporary.as_file_mut().set_permissions(permissions)?;
    temporary.write_all(bytes)?;
    temporary.as_file_mut().sync_all()?;
    temporary
        .persist(path)
        .map_err(|error| error.error)
        .with_context(|| format!("could not replace {}", path.display()))?;
    sync_directory(path.parent().unwrap_or(Path::new(".")));
    Ok(())
}

pub(crate) fn open_new_private(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .with_context(|| format!("could not create {}", path.display()))
}

pub(crate) fn temporary_sibling(path: &Path, extension: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = TEMPORARY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!(
        ".{name}.{}.{}.{}.{}",
        std::process::id(),
        timestamp,
        sequence,
        extension
    ))
}

pub(crate) fn prepare_trash_destination(
    library_root: &Path,
    source_file: &str,
) -> Result<(PathBuf, String)> {
    validate_source_file_metadata(source_file)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let sequence = TEMPORARY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let trash_id = format!(
        "{timestamp}-{}-{sequence}/{source_file}",
        std::process::id()
    );
    validate_trash_id(&trash_id)?;
    let destination = library_root.join(".castle/trash").join(&trash_id);
    let parent = destination
        .parent()
        .ok_or_else(|| anyhow!("Castle could not prepare the trash directory."))?;
    fs::create_dir_all(parent)?;
    Ok((destination, trash_id))
}

pub(crate) fn prepare_folder_trash_destination(
    library_root: &Path,
    source_directory: &str,
) -> Result<(PathBuf, String)> {
    validate_source_directory(source_directory)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let sequence = TEMPORARY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let trash_id = format!(
        "{timestamp}-{}-{sequence}/folders/{source_directory}",
        std::process::id()
    );
    validate_trash_id(&trash_id)?;
    let destination = library_root.join(".castle/trash").join(&trash_id);
    let parent = destination
        .parent()
        .ok_or_else(|| anyhow!("Castle could not prepare the trash directory."))?;
    fs::create_dir_all(parent)?;
    Ok((destination, trash_id))
}

pub(crate) fn sync_directory(directory: &Path) {
    let _ = File::open(directory).and_then(|file| file.sync_all());
}

pub(crate) fn prune_empty_trash_directories(start: &Path, trash_root: &Path) {
    let mut current = start.to_path_buf();
    while current != trash_root {
        if fs::remove_dir(&current).is_err() {
            break;
        }
        let Some(parent) = current.parent() else {
            break;
        };
        current = parent.to_path_buf();
    }
}

pub(crate) fn library_fingerprint(library_root: &Path) -> Result<Vec<u8>> {
    let mut entries = Vec::new();
    for entry in WalkDir::new(library_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.path() == library_root || !entry.file_name().to_string_lossy().starts_with('.')
        })
    {
        let entry = entry?;
        if entry.path() != library_root && entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let metadata = entry.metadata()?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_nanos())
            .unwrap_or_default();
        entries.push((
            entry
                .path()
                .strip_prefix(library_root)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .into_owned(),
            metadata.len(),
            modified,
        ));
    }
    entries.sort_unstable();
    let mut digest = Sha256::new();
    for (path, length, modified) in entries {
        digest.update(path.as_bytes());
        digest.update([0]);
        digest.update(length.to_le_bytes());
        digest.update(modified.to_le_bytes());
    }
    Ok(digest.finalize().to_vec())
}
