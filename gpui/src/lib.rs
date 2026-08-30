use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use castle_core::{CompileOptions, compile_library, load_castle_configuration};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoSection {
    pub id: String,
    pub label: String,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoNote {
    pub id: String,
    pub section: String,
    pub title: String,
    pub excerpt: String,
    pub markdown: String,
    pub reading_minutes: usize,
    pub word_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoLibrary {
    pub name: String,
    pub root: PathBuf,
    pub sections: Vec<DemoSection>,
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
                title: note.title,
                excerpt: note.excerpt,
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
                count: section.count,
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
            title: id.into(),
            excerpt: String::new(),
            markdown: String::new(),
            reading_minutes: 0,
            word_count: 0,
        }
    }
}
