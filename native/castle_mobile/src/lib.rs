use std::path::{Path, PathBuf};

use castle_contracts::CONTENT_CONTRACT_VERSION;
use castle_core::{
    CompileOptions, RepositoryHistoryPolicy, SnapshotOptions, SnapshotProfile, compile_library,
    write_snapshot,
};

#[derive(Debug, Clone, uniffi::Record)]
pub struct MobileCompileRequest {
    pub repository_root: String,
    pub library_root: String,
    pub output_root: String,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct MobileCompileResult {
    pub content_contract_version: u32,
    pub generated_at: String,
    pub catalog_path: String,
    pub manifest_path: String,
    pub note_count: u64,
    pub section_count: u64,
    pub project_count: u64,
    pub task_count: u64,
    pub calendar_event_count: u64,
    pub warning_count: u64,
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum MobileCompileError {
    #[error("Castle received an invalid mobile path: {reason}")]
    InvalidPath { reason: String },
    #[error("Castle could not compile the mobile library: {reason}")]
    CompilationFailed { reason: String },
    #[error("Castle could not write the mobile snapshot: {reason}")]
    SnapshotFailed { reason: String },
}

#[uniffi::export]
pub fn content_contract_version() -> u32 {
    CONTENT_CONTRACT_VERSION
}

#[uniffi::export]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

#[uniffi::export]
pub fn compile_mobile_snapshot(
    request: MobileCompileRequest,
) -> Result<MobileCompileResult, MobileCompileError> {
    let repository_root = canonical_directory(&request.repository_root, "repository")?;
    let library_root = canonical_directory(&request.library_root, "library")?;
    if !library_root.starts_with(&repository_root) {
        return Err(MobileCompileError::InvalidPath {
            reason: "the library must be contained by the downloaded repository".to_owned(),
        });
    }
    let output_root = nonempty_path(&request.output_root, "output")?;

    let compilation = compile_library(
        &CompileOptions::new(&library_root, &repository_root)
            .with_repository_history(RepositoryHistoryPolicy::Unavailable),
    )
    .map_err(|error| MobileCompileError::CompilationFailed {
        reason: format!("{error:#}"),
    })?;
    write_snapshot(
        &compilation,
        &SnapshotOptions {
            generated_path: None,
            public_root: output_root,
            profile: SnapshotProfile::MobileReadOnly,
        },
    )
    .map_err(|error| MobileCompileError::SnapshotFailed {
        reason: format!("{error:#}"),
    })?;

    let stats = &compilation.stats;
    Ok(MobileCompileResult {
        content_contract_version: CONTENT_CONTRACT_VERSION,
        generated_at: compilation.knowledge_base.generated_at.clone(),
        catalog_path: "generated/catalog.json".to_owned(),
        manifest_path: "generated/manifest.json".to_owned(),
        note_count: stats.note_count as u64,
        section_count: stats.section_count as u64,
        project_count: stats.project_count as u64,
        task_count: stats.task_count as u64,
        calendar_event_count: stats.calendar_event_count as u64,
        warning_count: compilation.diagnostics.record_warnings.len() as u64,
    })
}

fn canonical_directory(value: &str, label: &str) -> Result<PathBuf, MobileCompileError> {
    let path = nonempty_path(value, label)?;
    let canonical = path
        .canonicalize()
        .map_err(|error| MobileCompileError::InvalidPath {
            reason: format!("{label} directory could not be resolved: {error}"),
        })?;
    if !canonical.is_dir() {
        return Err(MobileCompileError::InvalidPath {
            reason: format!("{label} path is not a directory"),
        });
    }
    Ok(canonical)
}

fn nonempty_path(value: &str, label: &str) -> Result<PathBuf, MobileCompileError> {
    if value.trim().is_empty() {
        return Err(MobileCompileError::InvalidPath {
            reason: format!("{label} path is empty"),
        });
    }
    Ok(Path::new(value).to_owned())
}

uniffi::setup_scaffolding!();

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn compiles_a_read_only_mobile_snapshot() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        let output = root.path().join("output");
        fs::create_dir_all(library.join("notes")).unwrap();
        fs::write(
            library.join("notes/welcome.md"),
            "# Welcome\n\nHello mobile.\n",
        )
        .unwrap();

        let result = compile_mobile_snapshot(MobileCompileRequest {
            repository_root: root.path().to_string_lossy().into_owned(),
            library_root: library.to_string_lossy().into_owned(),
            output_root: output.to_string_lossy().into_owned(),
        })
        .unwrap();

        assert_eq!(result.content_contract_version, CONTENT_CONTRACT_VERSION);
        assert_eq!(result.note_count, 1);
        assert!(output.join(&result.catalog_path).is_file());
        assert!(output.join(&result.manifest_path).is_file());
        assert!(output.join("generated/mobile-profile.json").is_file());
        assert!(!output.join("generated/relationship-graph.json").exists());
    }

    #[test]
    fn rejects_a_library_outside_the_repository() {
        let repository = tempfile::tempdir().unwrap();
        let library = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();

        let error = compile_mobile_snapshot(MobileCompileRequest {
            repository_root: repository.path().to_string_lossy().into_owned(),
            library_root: library.path().to_string_lossy().into_owned(),
            output_root: output.path().to_string_lossy().into_owned(),
        })
        .unwrap_err();

        assert!(matches!(error, MobileCompileError::InvalidPath { .. }));
    }
}
