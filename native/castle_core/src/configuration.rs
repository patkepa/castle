use std::{
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use crate::frontmatter::parse_markdown;

const CONFIGURATION_FILE: &str = "CONFIGURATION.md";
const LOCAL_CONFIGURATION_FILE: &str = "CONFIGURATION.local.md";

#[derive(Debug, Clone)]
pub struct CastleConfiguration {
    pub application_name: String,
    pub application_bundle_id: String,
    pub library_path: PathBuf,
    pub repository_path: PathBuf,
    pub owner_note_id: String,
    pub owner_display_name: String,
    pub owner_avatar_url: String,
}

#[derive(Debug, Default, Deserialize)]
struct ConfigurationFile {
    schema_version: Option<u64>,
    application: Option<ApplicationConfiguration>,
    library: Option<LibraryConfiguration>,
    owner: Option<OwnerConfiguration>,
}

#[derive(Debug, Default, Deserialize)]
struct ApplicationConfiguration {
    name: Option<String>,
    bundle_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct LibraryConfiguration {
    path: Option<String>,
    repository_path: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct OwnerConfiguration {
    note_id: Option<String>,
    display_name: Option<String>,
    avatar_url: Option<String>,
}

pub fn load_castle_configuration(search_root: &Path) -> Result<CastleConfiguration> {
    let configuration_path = configuration_path(search_root);
    let configuration_root = configuration_path.parent().unwrap_or(search_root);
    let mut configuration = if configuration_path.is_file() {
        read_configuration_file(&configuration_path)?
    } else {
        ConfigurationFile::default()
    };
    let local_path = configuration_root.join(LOCAL_CONFIGURATION_FILE);
    if local_path.is_file() {
        configuration.merge(read_configuration_file(&local_path)?);
    }

    let schema_version = configuration.schema_version.unwrap_or(1);
    if schema_version != 1 {
        bail!(
            "{} uses unsupported schema_version {schema_version}",
            configuration_path.display()
        );
    }

    let application = configuration.application.unwrap_or_default();
    let library = configuration.library.unwrap_or_default();
    let owner = configuration.owner.unwrap_or_default();
    let owner_note_id = optional_text(owner.note_id);
    if owner_note_id.starts_with('/')
        || owner_note_id.split('/').any(|segment| segment == "..")
        || owner_note_id.ends_with(".md")
    {
        bail!(
            "{} owner.note_id must be a library-relative note ID without .md",
            configuration_path.display()
        );
    }

    Ok(CastleConfiguration {
        application_name: required_text(application.name, "Castle"),
        application_bundle_id: required_text(application.bundle_id, "app.castle.desktop"),
        library_path: resolve_path(configuration_root, library.path, "examples/library"),
        repository_path: resolve_path(configuration_root, library.repository_path, "."),
        owner_note_id,
        owner_display_name: required_text(owner.display_name, "Owner"),
        owner_avatar_url: optional_text(owner.avatar_url),
    })
}

impl ConfigurationFile {
    fn merge(&mut self, other: Self) {
        if other.schema_version.is_some() {
            self.schema_version = other.schema_version;
        }
        merge_application(&mut self.application, other.application);
        merge_library(&mut self.library, other.library);
        merge_owner(&mut self.owner, other.owner);
    }
}

fn configuration_path(search_root: &Path) -> PathBuf {
    if let Some(explicit) = env::var_os("CASTLE_CONFIGURATION_PATH") {
        return PathBuf::from(explicit);
    }
    let direct = search_root.join(CONFIGURATION_FILE);
    if direct.is_file() {
        return direct;
    }
    let nested = search_root.join("castle").join(CONFIGURATION_FILE);
    if nested.is_file() {
        return nested;
    }
    direct
}

fn read_configuration_file(path: &Path) -> Result<ConfigurationFile> {
    let source = fs::read_to_string(path)
        .with_context(|| format!("could not read Castle configuration {}", path.display()))?;
    let parsed = parse_markdown(&source)
        .with_context(|| format!("could not parse Castle configuration {}", path.display()))?;
    serde_json::from_value(parsed.frontmatter)
        .with_context(|| format!("invalid Castle configuration {}", path.display()))
}

fn required_text(value: Option<String>, fallback: &str) -> String {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_owned())
}

fn optional_text(value: Option<String>) -> String {
    value.unwrap_or_default().trim().to_owned()
}

fn resolve_path(root: &Path, value: Option<String>, fallback: &str) -> PathBuf {
    let path = PathBuf::from(required_text(value, fallback));
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn merge_application(
    target: &mut Option<ApplicationConfiguration>,
    source: Option<ApplicationConfiguration>,
) {
    let Some(source) = source else { return };
    let target = target.get_or_insert_with(ApplicationConfiguration::default);
    if source.name.is_some() {
        target.name = source.name;
    }
    if source.bundle_id.is_some() {
        target.bundle_id = source.bundle_id;
    }
}

fn merge_library(target: &mut Option<LibraryConfiguration>, source: Option<LibraryConfiguration>) {
    let Some(source) = source else { return };
    let target = target.get_or_insert_with(LibraryConfiguration::default);
    if source.path.is_some() {
        target.path = source.path;
    }
    if source.repository_path.is_some() {
        target.repository_path = source.repository_path;
    }
}

fn merge_owner(target: &mut Option<OwnerConfiguration>, source: Option<OwnerConfiguration>) {
    let Some(source) = source else { return };
    let target = target.get_or_insert_with(OwnerConfiguration::default);
    if source.note_id.is_some() {
        target.note_id = source.note_id;
    }
    if source.display_name.is_some() {
        target.display_name = source.display_name;
    }
    if source.avatar_url.is_some() {
        target.avatar_url = source.avatar_url;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_configuration_uses_neutral_defaults() {
        let root = tempfile::tempdir().unwrap();
        let configuration = load_castle_configuration(root.path()).unwrap();
        assert_eq!(configuration.owner_note_id, "");
        assert_eq!(configuration.owner_display_name, "Owner");
        assert_eq!(configuration.application_bundle_id, "app.castle.desktop");
    }
}
