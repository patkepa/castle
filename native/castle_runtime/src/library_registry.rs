use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};

const REGISTRY_VERSION: u32 = 1;
const MAX_RECENT_LIBRARIES: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecentLibrary {
    pub path: PathBuf,
    pub name: String,
    pub available: bool,
}

#[derive(Debug, Clone)]
pub struct LibraryRegistry {
    path: PathBuf,
    access: Arc<Mutex<()>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RegistryDocument {
    version: u32,
    libraries: Vec<PathBuf>,
}

impl LibraryRegistry {
    pub fn new(storage_root: impl Into<PathBuf>) -> Self {
        Self {
            path: storage_root.into().join("recent-libraries.json"),
            access: Arc::new(Mutex::new(())),
        }
    }

    pub fn recent_libraries(&self) -> Result<Vec<RecentLibrary>> {
        let _access = self
            .access
            .lock()
            .map_err(|_| anyhow!("Castle's recent-library registry lock was poisoned."))?;
        self.recent_libraries_unlocked()
    }

    fn recent_libraries_unlocked(&self) -> Result<Vec<RecentLibrary>> {
        Ok(self
            .load_document()?
            .libraries
            .into_iter()
            .map(|path| RecentLibrary {
                name: library_name(&path),
                available: path.is_dir(),
                path,
            })
            .collect())
    }

    pub fn remember(&self, library_root: &Path) -> Result<Vec<RecentLibrary>> {
        let _access = self
            .access
            .lock()
            .map_err(|_| anyhow!("Castle's recent-library registry lock was poisoned."))?;
        let canonical = library_root.canonicalize().with_context(|| {
            format!(
                "Castle could not canonicalize library {}",
                library_root.display()
            )
        })?;
        if !canonical.is_dir() {
            bail!("Castle library is not a directory: {}", canonical.display());
        }

        let mut document = self.load_document()?;
        document.libraries.retain(|path| path != &canonical);
        document.libraries.insert(0, canonical);
        document.libraries.truncate(MAX_RECENT_LIBRARIES);
        self.store_document(&document)?;
        self.recent_libraries_unlocked()
    }

    fn load_document(&self) -> Result<RegistryDocument> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(reason) if reason.kind() == std::io::ErrorKind::NotFound => {
                return Ok(RegistryDocument {
                    version: REGISTRY_VERSION,
                    libraries: Vec::new(),
                });
            }
            Err(reason) => {
                return Err(reason).with_context(|| {
                    format!(
                        "Castle could not read its recent-library registry at {}",
                        self.path.display()
                    )
                });
            }
        };
        let document: RegistryDocument = serde_json::from_slice(&bytes).with_context(|| {
            format!(
                "Castle's recent-library registry is invalid at {}",
                self.path.display()
            )
        })?;
        if document.version != REGISTRY_VERSION {
            bail!(
                "Castle's recent-library registry has unsupported version {}",
                document.version
            );
        }
        Ok(document)
    }

    fn store_document(&self, document: &RegistryDocument) -> Result<()> {
        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "Castle could not create registry directory {}",
                parent.display()
            )
        })?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        use std::io::Write;
        temporary.write_all(&serde_json::to_vec_pretty(document)?)?;
        temporary.as_file_mut().sync_all()?;
        temporary.persist(&self.path).map(|_| ()).map_err(|error| {
            anyhow::Error::new(error.error).context(format!(
                "Castle could not publish its recent-library registry at {}",
                self.path.display()
            ))
        })
    }
}

fn library_name(path: &Path) -> String {
    path.file_name()
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembers_canonical_libraries_in_most_recent_order() {
        let temporary = tempfile::tempdir().unwrap();
        let storage = temporary.path().join("state");
        let first = temporary.path().join("first");
        let second = temporary.path().join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let registry = LibraryRegistry::new(storage);

        registry.remember(&first).unwrap();
        registry.remember(&second).unwrap();
        let recents = registry.remember(&first.join("..").join("first")).unwrap();

        assert_eq!(recents.len(), 2);
        assert_eq!(recents[0].path, first.canonicalize().unwrap());
        assert_eq!(recents[0].name, "first");
        assert_eq!(recents[1].path, second.canonicalize().unwrap());
        assert!(recents.iter().all(|library| library.available));
    }

    #[test]
    fn retains_missing_libraries_as_unavailable_choices() {
        let temporary = tempfile::tempdir().unwrap();
        let library = temporary.path().join("moving-library");
        fs::create_dir(&library).unwrap();
        let registry = LibraryRegistry::new(temporary.path().join("state"));
        registry.remember(&library).unwrap();
        fs::remove_dir(&library).unwrap();

        let recents = registry.recent_libraries().unwrap();

        assert_eq!(recents.len(), 1);
        assert!(!recents[0].available);
    }

    #[test]
    fn rejects_unknown_registry_versions() {
        let temporary = tempfile::tempdir().unwrap();
        let storage = temporary.path().join("state");
        fs::create_dir(&storage).unwrap();
        fs::write(
            storage.join("recent-libraries.json"),
            r#"{"version":99,"libraries":[]}"#,
        )
        .unwrap();
        let registry = LibraryRegistry::new(storage);

        let reason = registry.recent_libraries().unwrap_err();

        assert!(format!("{reason:#}").contains("unsupported version 99"));
    }
}
