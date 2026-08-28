use std::collections::HashSet;

use anyhow::{Result, bail};
use castle_contracts::{Shortcut, ShortcutCollection};
use serde_json::Value;

use crate::{model::SourceNote, normalization::first_string};

pub(crate) fn build_shortcut_collections(notes: &[&SourceNote]) -> Result<Vec<ShortcutCollection>> {
    let mut collections = notes
        .iter()
        .map(|note| parse_shortcut_collection(&note.frontmatter, &note.title, &note.source_file))
        .collect::<Result<Vec<_>>>()?;
    let mut ids = HashSet::new();
    for collection in &collections {
        if !ids.insert(collection.id.as_str()) {
            bail!("duplicate shortcut collection id {:?}", collection.id);
        }
    }
    collections.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.label.cmp(&right.label))
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(collections)
}

fn parse_shortcut_collection(
    frontmatter: &Value,
    note_title: &str,
    source_file: &str,
) -> Result<ShortcutCollection> {
    let id = first_string(frontmatter.get("shortcut_collection"));
    if id.is_empty() {
        bail!("{source_file}: shortcut_collection must be a non-empty string");
    }
    if !id.chars().all(|character| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || matches!(character, '-' | '_')
    }) {
        bail!("{source_file}: shortcut_collection must use lowercase letters, digits, '-' or '_'");
    }

    let label = first_string(frontmatter.get("label"));
    let label = if label.is_empty() {
        note_title.trim().to_owned()
    } else {
        label
    };
    if label.is_empty() {
        bail!("{source_file}: shortcut collection label must not be empty");
    }

    let sort_order = frontmatter
        .get("sort_order")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let entries = frontmatter
        .get("shortcuts")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("{source_file}: shortcuts must be a YAML list"))?;
    let mut destinations = HashSet::new();
    let shortcuts = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let context = format!("{source_file}: shortcuts item {}", index + 1);
            let shortcut = Shortcut {
                category: required_string(entry, "category", &context)?,
                label: required_string(entry, "label", &context)?,
                description: required_string(entry, "description", &context)?,
                href: required_string(entry, "href", &context)?,
            };
            if !is_safe_shortcut_href(&shortcut.href) {
                bail!("{context} href must be an http(s) URL or an absolute Castle route");
            }
            if !destinations.insert(shortcut.href.clone()) {
                bail!(
                    "{context} duplicates shortcut destination {:?}",
                    shortcut.href
                );
            }
            Ok(shortcut)
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(ShortcutCollection {
        id,
        label,
        sort_order,
        shortcuts,
    })
}

fn required_string(entry: &Value, field: &str, context: &str) -> Result<String> {
    let value = first_string(entry.get(field));
    if value.is_empty() {
        bail!("{context} {field} must be a non-empty string");
    }
    Ok(value)
}

fn is_safe_shortcut_href(href: &str) -> bool {
    href.starts_with('/') || href.starts_with("https://") || href.starts_with("http://")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_a_markdown_backed_shortcut_collection() {
        let collection = parse_shortcut_collection(
            &json!({
                "shortcut_collection": "main",
                "label": "Main",
                "sort_order": 10,
                "shortcuts": [{
                    "category": "Development",
                    "label": "Repository",
                    "description": "Open the project repository",
                    "href": "https://example.com/repository"
                }]
            }),
            "Fallback",
            "shortcuts/main.md",
        )
        .unwrap();

        assert_eq!(collection.id, "main");
        assert_eq!(collection.label, "Main");
        assert_eq!(collection.sort_order, 10);
        assert_eq!(collection.shortcuts[0].label, "Repository");
    }

    #[test]
    fn rejects_unsafe_shortcut_destinations() {
        let error = parse_shortcut_collection(
            &json!({
                "shortcut_collection": "main",
                "shortcuts": [{
                    "category": "Unsafe",
                    "label": "Script",
                    "description": "Do not run this",
                    "href": "javascript:alert(1)"
                }]
            }),
            "Main",
            "shortcuts/main.md",
        )
        .unwrap_err();

        assert!(error.to_string().contains("http(s) URL"));
    }
}
