use std::collections::{HashMap, HashSet};

use anyhow::{Result, bail};
use castle_contracts::ProjectReference;
use serde_json::Value;

use crate::{
    model::SourceNote,
    normalization::{first_string, normalize_reference},
};

pub(crate) type ReferenceLookup = HashMap<String, Vec<usize>>;

pub(crate) fn build_reference_lookup(notes: &[&SourceNote]) -> ReferenceLookup {
    let mut lookup = ReferenceLookup::new();
    for (index, note) in notes.iter().enumerate() {
        let references = [
            note.id.as_str(),
            note.source_file.as_str(),
            note.relative_path.as_str(),
            note.route.as_str(),
            note.title.as_str(),
        ]
        .into_iter()
        .chain(note.aliases.iter().map(String::as_str));
        for reference in references {
            register(&mut lookup, reference, index);
            if let Some(basename) = normalize_reference(reference).rsplit('/').next() {
                register(&mut lookup, basename, index);
            }
        }
    }
    lookup
}

fn register(lookup: &mut ReferenceLookup, reference: &str, index: usize) {
    let key = normalize_reference(reference);
    if key.is_empty() {
        return;
    }
    let matches = lookup.entry(key).or_default();
    if !matches.contains(&index) {
        matches.push(index);
    }
}

pub(crate) fn resolve_many<'a>(
    value: Option<&Value>,
    notes: &'a [&SourceNote],
    lookup: &ReferenceLookup,
    context: &str,
    field: &str,
) -> Result<Vec<&'a SourceNote>> {
    let values = match value {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::String(value)) if value.trim().is_empty() => Vec::new(),
        Some(Value::Array(values)) => values.iter().collect(),
        Some(value) => vec![value],
    };
    let mut resolved = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        let reference = first_string(Some(value));
        if reference.is_empty() {
            bail!("{context}: {field} must contain note references");
        }
        let matches = lookup
            .get(&normalize_reference(&reference))
            .cloned()
            .unwrap_or_default();
        if matches.is_empty() {
            bail!(
                "{context}: unresolved {} reference \"{}\"",
                field.trim_end_matches('e').trim_end_matches('l'),
                reference
            );
        }
        if matches.len() > 1 {
            bail!(
                "{context}: ambiguous {} reference \"{}\"; use the full path",
                field.trim_end_matches('e').trim_end_matches('l'),
                reference
            );
        }
        let note = notes[matches[0]];
        if seen.insert(note.id.clone()) {
            resolved.push(note);
        }
    }
    Ok(resolved)
}

pub(crate) fn resolve_one<'a>(
    value: Option<&Value>,
    notes: &'a [&SourceNote],
    lookup: &ReferenceLookup,
    context: &str,
    field: &str,
) -> Result<Option<&'a SourceNote>> {
    let reference = first_string(value);
    if reference.is_empty() {
        return Ok(None);
    }
    let matches = lookup
        .get(&normalize_reference(&reference))
        .cloned()
        .unwrap_or_default();
    if matches.is_empty() {
        bail!("{context}: unresolved {field} reference \"{reference}\"");
    }
    if matches.len() > 1 {
        bail!("{context}: ambiguous {field} reference \"{reference}\"; use the full path");
    }
    Ok(Some(notes[matches[0]]))
}

pub(crate) fn project_reference(note: Option<&SourceNote>) -> Option<ProjectReference> {
    note.map(|note| ProjectReference {
        id: note.id.clone(),
        title: note.title.clone(),
        route: note.route.clone(),
    })
}
