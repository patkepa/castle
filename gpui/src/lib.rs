use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use castle_core::{CompileOptions, compile_library, load_castle_configuration};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoSection {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoNote {
    pub id: String,
    pub section: String,
    pub section_label: String,
    pub title: String,
    pub excerpt: String,
    pub markdown: String,
    pub relative_path: String,
    pub modified_at: String,
    pub tags: Vec<String>,
    pub reading_minutes: usize,
    pub word_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoFolder {
    pub section: String,
    pub directory: Vec<String>,
    pub entry_count: usize,
    pub note_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoLibrary {
    pub name: String,
    pub root: PathBuf,
    pub sections: Vec<DemoSection>,
    pub folders: Vec<DemoFolder>,
    pub notes: Vec<DemoNote>,
}

impl DemoLibrary {
    pub fn load(repository_root: &Path, library_override: Option<&Path>) -> Result<Self> {
        let configuration = load_castle_configuration(repository_root)?;
        let library_root = library_override
            .map(Path::to_path_buf)
            .unwrap_or(configuration.library_path);
        let compilation = compile_library(&CompileOptions::new(
            &library_root,
            &configuration.repository_path,
        ))
        .with_context(|| format!("could not compile {}", library_root.display()))?;

        let mut note_content = compilation
            .note_resources
            .into_iter()
            .map(|resource| (resource.content.id, resource.content.content))
            .collect::<std::collections::HashMap<_, _>>();
        let notes = compilation
            .knowledge_base
            .notes
            .into_iter()
            .map(|note| DemoNote {
                markdown: note_content.remove(&note.id).unwrap_or_default(),
                id: note.id,
                section: note.section,
                section_label: note.section_label,
                title: note.title,
                excerpt: note.excerpt,
                relative_path: note.relative_path,
                modified_at: note.modified_at,
                tags: note.tags,
                reading_minutes: note.reading_minutes,
                word_count: note.word_count,
            })
            .collect();
        let sections = compilation
            .knowledge_base
            .sections
            .into_iter()
            .map(|section| DemoSection {
                id: section.id,
                label: section.label,
                icon: section.icon,
                count: section.count,
            })
            .collect();
        let folders = compilation
            .knowledge_base
            .folders
            .into_iter()
            .map(|folder| DemoFolder {
                section: folder.section_id,
                directory: folder.directory,
                entry_count: folder.entry_count,
                note_count: folder.note_count,
            })
            .collect();

        let canonical_root = library_root.canonicalize().unwrap_or(library_root);
        let name = canonical_root
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            .unwrap_or("Castle")
            .to_owned();

        Ok(Self {
            name,
            root: canonical_root,
            sections,
            folders,
            notes,
        })
    }

    pub fn notes_in_section(&self, section: Option<&str>) -> Vec<usize> {
        self.notes
            .iter()
            .enumerate()
            .filter(|(_, note)| section.is_none_or(|section| note.section == section))
            .map(|(index, _)| index)
            .collect()
    }

    pub fn notes_in_directory(&self, section: &str, directory: &[String]) -> Vec<usize> {
        self.notes
            .iter()
            .enumerate()
            .filter(|(_, note)| note.section == section && note.directory().as_slice() == directory)
            .map(|(index, _)| index)
            .collect()
    }

    pub fn folders_in_directory(&self, section: &str, directory: &[String]) -> Vec<usize> {
        self.folders
            .iter()
            .enumerate()
            .filter(|(_, folder)| {
                folder.section == section
                    && folder.directory.len() == directory.len() + 1
                    && folder.directory.starts_with(directory)
            })
            .map(|(index, _)| index)
            .collect()
    }

    pub fn section(&self, id: &str) -> Option<&DemoSection> {
        self.sections.iter().find(|section| section.id == id)
    }
}

impl DemoNote {
    pub fn directory(&self) -> Vec<String> {
        let mut parts = self
            .relative_path
            .split('/')
            .map(str::to_owned)
            .collect::<Vec<_>>();
        parts.pop();
        parts
    }
}

pub fn parse_library_override(
    arguments: impl IntoIterator<Item = String>,
) -> Result<Option<PathBuf>> {
    let mut arguments = arguments.into_iter();
    let mut library = None;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--library" => {
                let value = arguments.next().context("--library requires a path")?;
                library = Some(PathBuf::from(value));
            }
            "--help" | "-h" => {}
            unknown if unknown.starts_with('-') => anyhow::bail!("unknown option {unknown}"),
            _ => {}
        }
    }
    Ok(library)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_library_override() {
        assert_eq!(
            parse_library_override(["--library".into(), "/tmp/vault".into()]).unwrap(),
            Some(PathBuf::from("/tmp/vault"))
        );
    }

    #[test]
    fn rejects_missing_library_path() {
        assert!(parse_library_override(["--library".into()]).is_err());
    }

    #[test]
    fn filters_notes_by_section() {
        let library = DemoLibrary {
            name: "Demo".into(),
            root: PathBuf::from("/demo"),
            sections: Vec::new(),
            folders: Vec::new(),
            notes: vec![
                note("one", "notes"),
                note("two", "people"),
                note("three", "notes"),
            ],
        };

        assert_eq!(library.notes_in_section(Some("notes")), vec![0, 2]);
        assert_eq!(library.notes_in_section(None), vec![0, 1, 2]);
    }

    fn note(id: &str, section: &str) -> DemoNote {
        DemoNote {
            id: id.into(),
            section: section.into(),
            section_label: section.into(),
            title: id.into(),
            excerpt: String::new(),
            markdown: String::new(),
            relative_path: format!("{id}.md"),
            modified_at: String::new(),
            tags: Vec::new(),
            reading_minutes: 0,
            word_count: 0,
        }
    }

    #[test]
    fn resolves_direct_directory_contents() {
        let mut library = DemoLibrary {
            name: "Demo".into(),
            root: PathBuf::from("/demo"),
            sections: Vec::new(),
            folders: vec![
                DemoFolder {
                    section: "notes".into(),
                    directory: vec!["work".into()],
                    entry_count: 2,
                    note_count: 1,
                },
                DemoFolder {
                    section: "notes".into(),
                    directory: vec!["work".into(), "archive".into()],
                    entry_count: 1,
                    note_count: 1,
                },
            ],
            notes: vec![note("root", "notes"), note("nested", "notes")],
        };
        library.notes[1].relative_path = "work/nested.md".into();

        assert_eq!(library.folders_in_directory("notes", &[]), vec![0]);
        assert_eq!(
            library.folders_in_directory("notes", &["work".into()]),
            vec![1]
        );
        assert_eq!(library.notes_in_directory("notes", &[]), vec![0]);
        assert_eq!(
            library.notes_in_directory("notes", &["work".into()]),
            vec![1]
        );
    }
}
