use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, anyhow, bail};
use serde::Serialize;
use serde_yaml::Value;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::{CompileOptions, compile_library};

pub const CURRENT_RECORD_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone)]
pub struct MigrationOptions {
    pub library_root: PathBuf,
    pub repository_root: PathBuf,
    pub target_version: u32,
    pub backup_root: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPlan {
    pub target_version: u32,
    pub scanned_records: usize,
    pub version_counts: BTreeMap<u32, usize>,
    pub changes: Vec<MigrationChange>,
    pub diagnostics: Vec<MigrationDiagnostic>,
    #[serde(skip)]
    planned_changes: Vec<PlannedChange>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationChange {
    pub source_file: String,
    pub record_type: String,
    pub record_id: String,
    pub from_version: u32,
    pub to_version: u32,
    pub before_sha256: String,
    pub after_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationDiagnostic {
    pub severity: MigrationSeverity,
    pub source_file: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MigrationSeverity {
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationOutcome {
    pub changed_files: usize,
    pub backup_path: String,
    pub target_version: u32,
}

#[derive(Debug, Clone)]
struct PlannedChange {
    path: PathBuf,
    original: String,
    migrated: String,
}

struct MigratedDocument {
    source: String,
    record_type: String,
    record_id: String,
    from_version: u32,
    to_version: u32,
}

pub fn plan_record_migrations(options: &MigrationOptions) -> Result<MigrationPlan> {
    if options.target_version == 0 || options.target_version > CURRENT_RECORD_SCHEMA_VERSION {
        bail!(
            "Castle supports record schema migrations through version {}.",
            CURRENT_RECORD_SCHEMA_VERSION
        );
    }
    let library_root = options.library_root.canonicalize().with_context(|| {
        format!(
            "could not resolve Castle library {}",
            options.library_root.display()
        )
    })?;
    let mut plan = MigrationPlan {
        target_version: options.target_version,
        scanned_records: 0,
        version_counts: BTreeMap::new(),
        changes: Vec::new(),
        diagnostics: Vec::new(),
        planned_changes: Vec::new(),
    };

    for path in markdown_files(&library_root)? {
        let source_file = path
            .strip_prefix(&library_root)?
            .to_string_lossy()
            .replace('\\', "/");
        let source = fs::read_to_string(&path)?;
        match migrate_document(&source, &source_file, options.target_version) {
            Ok(None) => {}
            Ok(Some(document)) => {
                plan.scanned_records += 1;
                *plan
                    .version_counts
                    .entry(document.from_version)
                    .or_default() += 1;
                if document.from_version > options.target_version {
                    plan.diagnostics.push(MigrationDiagnostic {
                        severity: MigrationSeverity::Error,
                        source_file,
                        message: format!(
                            "record schema {} is newer than requested target {}",
                            document.from_version, options.target_version
                        ),
                    });
                    continue;
                }
                if document.source == source {
                    continue;
                }
                let idempotence =
                    migrate_document(&document.source, &source_file, options.target_version)?
                        .ok_or_else(|| anyhow!("Castle lost record identity after migration."))?;
                if idempotence.source != document.source {
                    bail!("{source_file}: record migration is not idempotent");
                }
                plan.changes.push(MigrationChange {
                    source_file: source_file.clone(),
                    record_type: document.record_type,
                    record_id: document.record_id,
                    from_version: document.from_version,
                    to_version: document.to_version,
                    before_sha256: sha256(source.as_bytes()),
                    after_sha256: sha256(document.source.as_bytes()),
                });
                plan.planned_changes.push(PlannedChange {
                    path,
                    original: source,
                    migrated: document.source,
                });
            }
            Err(reason) => plan.diagnostics.push(MigrationDiagnostic {
                severity: MigrationSeverity::Error,
                source_file,
                message: reason.to_string(),
            }),
        }
    }
    if plan.version_counts.len() > 1 {
        plan.diagnostics.push(MigrationDiagnostic {
            severity: MigrationSeverity::Warning,
            source_file: String::new(),
            message: format!(
                "mixed Castle Record schema versions detected: {:?}",
                plan.version_counts
            ),
        });
    }
    Ok(plan)
}

pub fn apply_record_migrations(
    options: &MigrationOptions,
    plan: &MigrationPlan,
) -> Result<MigrationOutcome> {
    if plan
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == MigrationSeverity::Error)
    {
        bail!("Castle will not apply migrations while the plan contains errors.");
    }
    if plan.target_version != options.target_version {
        bail!("Castle rejected a migration plan for a different target version.");
    }
    let library_root = options.library_root.canonicalize()?;
    for change in &plan.planned_changes {
        let current = fs::read_to_string(&change.path)?;
        if sha256(current.as_bytes()) != sha256(change.original.as_bytes()) {
            bail!(
                "{} changed after Castle prepared the migration plan; run the dry-run again.",
                change.path.display()
            );
        }
    }
    let backup_root = options
        .backup_root
        .clone()
        .unwrap_or_else(|| library_root.join(".castle/migration_backups"));
    fs::create_dir_all(&backup_root)?;
    let sequence = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let backup_path = backup_root.join(format!("{sequence}-schema-v{}", options.target_version));
    fs::create_dir_all(&backup_path)?;
    for change in &plan.planned_changes {
        let relative = change.path.strip_prefix(&library_root)?;
        atomic_write(&backup_path.join(relative), change.original.as_bytes())?;
    }
    atomic_write(
        &backup_path.join("migration_plan.json"),
        &serde_json::to_vec_pretty(plan)?,
    )?;

    let mut applied = Vec::new();
    let result = (|| -> Result<()> {
        for change in &plan.planned_changes {
            atomic_write(&change.path, change.migrated.as_bytes())?;
            applied.push(change);
        }
        compile_library(&CompileOptions::new(
            &library_root,
            &options.repository_root,
        ))
        .context("Castle validation failed after applying record migrations")?;
        Ok(())
    })();
    if let Err(reason) = result {
        for change in applied.into_iter().rev() {
            let _ = atomic_write(&change.path, change.original.as_bytes());
        }
        return Err(reason).context("Castle rolled back every migrated source file");
    }
    Ok(MigrationOutcome {
        changed_files: plan.changes.len(),
        backup_path: backup_path.to_string_lossy().into_owned(),
        target_version: options.target_version,
    })
}

fn migrate_document(
    source: &str,
    source_file: &str,
    target: u32,
) -> Result<Option<MigratedDocument>> {
    let Some((opening, frontmatter, closing, body)) = split_frontmatter(source)? else {
        return Ok(None);
    };
    let yaml: Value = serde_yaml::from_str(frontmatter)
        .with_context(|| format!("{source_file}: invalid YAML frontmatter"))?;
    let Some(mapping) = yaml.as_mapping() else {
        if inferred_record_type(source_file).is_some() {
            bail!("{source_file}: frontmatter must be a mapping");
        }
        return Ok(None);
    };
    let explicit_type = yaml_string(mapping, "type");
    let record_type = explicit_type
        .or_else(|| inferred_record_type(source_file))
        .map(str::to_owned);
    let Some(record_type) = record_type else {
        return Ok(None);
    };
    let from_version = yaml_u32(mapping, "schema_version").unwrap_or(0);
    let record_id = yaml_string(mapping, "id")
        .map(str::to_owned)
        .unwrap_or_else(|| inferred_record_id(&record_type, source_file));
    if from_version >= target {
        return Ok(Some(MigratedDocument {
            source: source.to_owned(),
            record_type,
            record_id,
            from_version,
            to_version: from_version,
        }));
    }
    if from_version != 0 || target != 1 {
        bail!("{source_file}: no registered migration from schema {from_version} to {target}");
    }
    let newline = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut lines = frontmatter.lines().map(str::to_owned).collect::<Vec<_>>();
    set_or_insert(&mut lines, "type", &record_type, 0);
    set_or_insert(&mut lines, "schema_version", "1", 1);
    set_or_insert(&mut lines, "id", &record_id, 2);
    if record_type == "task" {
        rename_property(&mut lines, "date", "due_date");
        rename_property(&mut lines, "time", "due_time");
    }
    let migrated = format!("{}{}{}{}", opening, lines.join(newline), closing, body);
    Ok(Some(MigratedDocument {
        source: migrated,
        record_type,
        record_id,
        from_version,
        to_version: 1,
    }))
}

fn split_frontmatter(source: &str) -> Result<Option<(&str, &str, &str, &str)>> {
    let offset = usize::from(source.starts_with('\u{feff}'));
    let content = &source[offset..];
    if !content.starts_with("---\n") && !content.starts_with("---\r\n") {
        return Ok(None);
    }
    let opening_end = content.find('\n').expect("frontmatter opening newline") + 1;
    let remainder = &content[opening_end..];
    let closing_start = remainder
        .find("\n---\n")
        .map(|index| (index, 5))
        .or_else(|| remainder.find("\r\n---\r\n").map(|index| (index, 7)))
        .or_else(|| {
            remainder
                .strip_suffix("\r\n---")
                .map(|frontmatter| (frontmatter.len(), 5))
        })
        .or_else(|| {
            remainder
                .strip_suffix("\n---")
                .map(|frontmatter| (frontmatter.len(), 4))
        })
        .ok_or_else(|| anyhow!("unclosed YAML frontmatter"))?;
    let frontmatter_end = closing_start.0;
    let closing_end = frontmatter_end + closing_start.1;
    Ok(Some((
        &source[..offset + opening_end],
        &remainder[..frontmatter_end],
        &remainder[frontmatter_end..closing_end],
        &remainder[closing_end..],
    )))
}

fn inferred_record_type(source_file: &str) -> Option<&'static str> {
    match source_file.split('/').next()? {
        "people" => Some("person"),
        "tasks" => Some("task"),
        "events" => Some("event"),
        "projects" if is_project_root_record(source_file) => Some("project"),
        _ => None,
    }
}

fn is_project_root_record(source_file: &str) -> bool {
    let path = Path::new(source_file);
    path.parent()
        .and_then(Path::file_name)
        .zip(path.file_stem())
        .is_some_and(|(directory, stem)| directory == stem)
}

fn inferred_record_id(record_type: &str, source_file: &str) -> String {
    let stem = Path::new(source_file)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("record");
    format!("{record_type}_{stem}")
}

fn yaml_string<'a>(mapping: &'a serde_yaml::Mapping, key: &str) -> Option<&'a str> {
    mapping
        .get(Value::String(key.to_owned()))
        .and_then(Value::as_str)
}

fn yaml_u32(mapping: &serde_yaml::Mapping, key: &str) -> Option<u32> {
    mapping
        .get(Value::String(key.to_owned()))
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn set_or_insert(lines: &mut Vec<String>, key: &str, value: &str, index: usize) {
    if let Some(existing) = property_index(lines, key) {
        lines[existing] = format!("{key}: {value}");
    } else {
        lines.insert(index.min(lines.len()), format!("{key}: {value}"));
    }
}

fn rename_property(lines: &mut [String], old_key: &str, new_key: &str) {
    if property_index(lines, new_key).is_some() {
        return;
    }
    if let Some(index) = property_index(lines, old_key) {
        lines[index] = lines[index].replacen(&format!("{old_key}:"), &format!("{new_key}:"), 1);
    }
}

fn property_index(lines: &[String], key: &str) -> Option<usize> {
    lines
        .iter()
        .position(|line| line.starts_with(&format!("{key}:")))
}

fn markdown_files(library_root: &Path) -> Result<Vec<PathBuf>> {
    let mut files = WalkDir::new(library_root)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0 || !entry.file_name().to_string_lossy().starts_with('.')
        })
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|entry| {
            entry.file_type().is_file()
                && matches!(
                    entry.path().extension().and_then(|value| value.to_str()),
                    Some("md" | "mdx")
                )
        })
        .map(|entry| entry.into_path())
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut temporary =
        tempfile::NamedTempFile::new_in(path.parent().unwrap_or_else(|| Path::new(".")))?;
    temporary.write_all(bytes)?;
    temporary.as_file_mut().sync_all()?;
    temporary
        .persist(path)
        .map(|_| ())
        .map_err(|error| error.error.into())
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_legacy_records_without_writing_and_is_idempotent() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        fs::create_dir_all(library.join("tasks")).unwrap();
        let path = library.join("tasks/legacy.md");
        let original = "---\nstatus: todo\ndate: \"2026-08-04\"\n---\n\n# Legacy\n";
        fs::write(&path, original).unwrap();
        let options = MigrationOptions {
            library_root: library,
            repository_root: root.path().to_owned(),
            target_version: 1,
            backup_root: None,
        };
        let plan = plan_record_migrations(&options).unwrap();
        assert_eq!(plan.changes.len(), 1);
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        let migrated = &plan.planned_changes[0].migrated;
        assert!(migrated.contains("type: task"));
        assert!(migrated.contains("schema_version: 1"));
        assert!(migrated.contains("id: task_legacy"));
        assert!(migrated.contains("due_date:"));
        assert_eq!(
            migrate_document(migrated, "tasks/legacy.md", 1)
                .unwrap()
                .unwrap()
                .source,
            *migrated
        );
    }

    #[test]
    fn preserves_crlf_frontmatter_that_closes_at_end_of_file() {
        let source = "---\r\nstatus: todo\r\ndate: \"2026-08-04\"\r\n---";
        let migrated = migrate_document(source, "tasks/crlf.md", 1)
            .unwrap()
            .unwrap()
            .source;
        assert!(migrated.starts_with(
            "---\r\ntype: task\r\nschema_version: 1\r\nid: task_crlf\r\nstatus: todo"
        ));
        assert!(migrated.ends_with("due_date: \"2026-08-04\"\r\n---"));
        assert!(!migrated.contains('\n') || !migrated.replace("\r\n", "").contains('\n'));
    }

    #[test]
    fn reports_mixed_and_future_record_versions() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        fs::create_dir_all(library.join("tasks")).unwrap();
        fs::write(
            library.join("tasks/current.md"),
            "---\ntype: task\nschema_version: 1\nid: task_current\nstatus: todo\n---\n# Current\n",
        )
        .unwrap();
        fs::write(
            library.join("tasks/future.md"),
            "---\ntype: task\nschema_version: 2\nid: task_future\nstatus: todo\n---\n# Future\n",
        )
        .unwrap();
        let plan = plan_record_migrations(&MigrationOptions {
            library_root: library,
            repository_root: root.path().to_owned(),
            target_version: 1,
            backup_root: None,
        })
        .unwrap();
        assert!(
            plan.diagnostics
                .iter()
                .any(|item| item.severity == MigrationSeverity::Error)
        );
        assert!(
            plan.diagnostics
                .iter()
                .any(|item| item.severity == MigrationSeverity::Warning)
        );
    }

    #[test]
    fn applies_valid_plans_with_backups_and_rolls_back_invalid_compilations() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("library");
        let backups = root.path().join("backups");
        fs::create_dir_all(library.join("tasks")).unwrap();
        let path = library.join("tasks/legacy.md");
        let original = "---\nstatus: todo\ndate: \"2026-08-04\"\n---\n\n# Legacy\n";
        fs::write(&path, original).unwrap();
        let options = MigrationOptions {
            library_root: library.clone(),
            repository_root: root.path().to_owned(),
            target_version: 1,
            backup_root: Some(backups),
        };
        let plan = plan_record_migrations(&options).unwrap();
        let outcome = apply_record_migrations(&options, &plan).unwrap();
        assert!(
            fs::read_to_string(&path)
                .unwrap()
                .contains("schema_version: 1")
        );
        assert_eq!(
            fs::read_to_string(Path::new(&outcome.backup_path).join("tasks/legacy.md")).unwrap(),
            original
        );

        let invalid_path = library.join("tasks/invalid.md");
        let invalid = "---\nstatus: todo\ndate: \"not-a-date\"\n---\n\n# Invalid\n";
        fs::write(&invalid_path, invalid).unwrap();
        let invalid_plan = plan_record_migrations(&options).unwrap();
        assert!(apply_record_migrations(&options, &invalid_plan).is_err());
        assert_eq!(fs::read_to_string(invalid_path).unwrap(), invalid);
    }
}
