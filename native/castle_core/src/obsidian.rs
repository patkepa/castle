use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::LazyLock,
};

use regex::Regex;
use serde_json::{Value, json};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

use crate::{model::SourceNote, normalization::github_slug};

static OBSIDIAN_LINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(!?)\[\[([^\]\r\n]+)\]\]").unwrap());
static MARKDOWN_LINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"!?\[[^\]]*\]\([^)]+\)").unwrap());
static INLINE_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"`+[^`\r\n]*`+").unwrap());

#[derive(Debug, Clone)]
struct IndexedNote {
    title: String,
    route: String,
    source_file: String,
}

#[derive(Debug)]
pub(crate) struct ObsidianIndex {
    notes: Vec<IndexedNote>,
    canonical: HashMap<String, Vec<usize>>,
    aliases: HashMap<String, Vec<usize>>,
    assets: Vec<String>,
    asset_canonical: HashMap<String, Vec<usize>>,
    asset_basenames: HashMap<String, Vec<usize>>,
}

pub(crate) struct TransformResult {
    pub content: String,
    pub diagnostics: Vec<Value>,
    pub replacement_count: usize,
}

pub(crate) fn create_index(
    notes: &[SourceNote],
    asset_files: &[std::path::PathBuf],
    library_root: &Path,
) -> ObsidianIndex {
    let mut index = ObsidianIndex {
        notes: Vec::new(),
        canonical: HashMap::new(),
        aliases: HashMap::new(),
        assets: Vec::new(),
        asset_canonical: HashMap::new(),
        asset_basenames: HashMap::new(),
    };

    for note in notes {
        let note_index = index.notes.len();
        index.notes.push(IndexedNote {
            title: note.title.clone(),
            route: note.route.clone(),
            source_file: note.source_file.clone(),
        });
        let source = without_extension(&note.source_file);
        let relative = without_extension(&note.relative_path);
        let canonical = vec![
            note.id.clone(),
            source,
            relative.clone(),
            format!("{}/{}", note.section, relative),
        ];
        let mut aliases = vec![
            note.title.clone(),
            relative.rsplit('/').next().unwrap_or(&relative).to_owned(),
        ];
        aliases.extend(note.aliases.iter().cloned());
        for target in canonical {
            add(&mut index.canonical, normalize_note(&target), note_index);
        }
        for alias in aliases {
            add(&mut index.aliases, normalize_note(&alias), note_index);
        }
    }

    for path in asset_files {
        let source = slash(path.strip_prefix(library_root).unwrap_or(path));
        let asset_index = index.assets.len();
        index.assets.push(source.clone());
        add(
            &mut index.asset_canonical,
            normalize_common(&source),
            asset_index,
        );
        add(
            &mut index.asset_basenames,
            normalize_common(source.rsplit('/').next().unwrap_or(&source)),
            asset_index,
        );
    }
    index
}

pub(crate) fn transform(
    content: &str,
    source_file: &str,
    index: &ObsidianIndex,
    line_offset: usize,
) -> TransformResult {
    let protected = protected_ranges(content);
    let mut replacements = Vec::<(usize, usize, String)>::new();
    let mut diagnostics = Vec::new();

    for capture in OBSIDIAN_LINK.captures_iter(content) {
        let whole = capture.get(0).unwrap();
        if protected
            .iter()
            .any(|(start, end)| whole.start() >= *start && whole.start() < *end)
        {
            continue;
        }
        let parsed = parse_target(&capture[2]);
        let (line, column) = location(content, whole.start());
        let line = line + line_offset;
        let embedded = &capture[1] == "!";
        if parsed.target.is_empty() && parsed.heading.is_empty() {
            diagnostics.push(diagnostic(
                "unresolved",
                source_file,
                line,
                column,
                "",
                "Obsidian target is empty.",
            ));
            continue;
        }

        if embedded && !parsed.target.is_empty() && Path::new(&parsed.target).extension().is_some()
        {
            match resolve_asset(&parsed.target, source_file, index) {
                Resolution::Resolved(asset) => {
                    let label = if parsed.alias.is_empty() {
                        Path::new(&parsed.target)
                            .file_stem()
                            .and_then(|value| value.to_str())
                            .unwrap_or("")
                    } else {
                        &parsed.alias
                    };
                    replacements.push((
                        whole.start(),
                        whole.end(),
                        format!(
                            "![{}]({})",
                            escape_label(label),
                            asset_url(&index.assets[asset])
                        ),
                    ));
                    continue;
                }
                Resolution::Ambiguous(candidates) => {
                    diagnostics.push(diagnostic(
                        "ambiguous",
                        source_file,
                        line,
                        column,
                        &parsed.target,
                        &format!(
                            "Ambiguous Obsidian asset; selected no target. Candidates: {}.",
                            candidates
                                .into_iter()
                                .map(|value| index.assets[value].clone())
                                .collect::<Vec<_>>()
                                .join(", ")
                        ),
                    ));
                    continue;
                }
                Resolution::Unresolved => {
                    diagnostics.push(diagnostic(
                        "unresolved",
                        source_file,
                        line,
                        column,
                        &parsed.target,
                        "Unresolved Obsidian asset.",
                    ));
                    continue;
                }
            }
        }

        let note_target = if parsed.target.is_empty() {
            source_file
        } else {
            &parsed.target
        };
        match resolve_note(note_target, source_file, index) {
            Resolution::Unresolved => diagnostics.push(diagnostic(
                "unresolved",
                source_file,
                line,
                column,
                &parsed.target,
                "Unresolved Obsidian note.",
            )),
            Resolution::Resolved(note) => replacements.push((
                whole.start(),
                whole.end(),
                note_link(&parsed, &index.notes[note]),
            )),
            Resolution::Ambiguous(candidates) => {
                let selected = select_note(&candidates, index);
                diagnostics.push(diagnostic(
                    "ambiguous",
                    source_file,
                    line,
                    column,
                    &parsed.target,
                    &format!(
                        "Ambiguous Obsidian note; selected {}. Candidates: {}.",
                        index.notes[selected].source_file,
                        candidates
                            .iter()
                            .map(|value| index.notes[*value].source_file.clone())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                ));
                replacements.push((
                    whole.start(),
                    whole.end(),
                    note_link(&parsed, &index.notes[selected]),
                ));
            }
        }
    }

    let replacement_count = replacements.len();
    replacements.sort_by_key(|value| std::cmp::Reverse(value.0));
    let mut transformed = content.to_owned();
    for (start, end, value) in replacements {
        transformed.replace_range(start..end, &value);
    }
    TransformResult {
        content: transformed,
        diagnostics,
        replacement_count,
    }
}

struct ParsedTarget {
    target: String,
    heading: String,
    alias: String,
}

fn parse_target(raw: &str) -> ParsedTarget {
    let (pipe_target, alias) = raw.split_once('|').unwrap_or((raw, ""));
    let target_heading = pipe_target.strip_suffix('\\').unwrap_or(pipe_target);
    let (target, heading) = target_heading
        .split_once('#')
        .unwrap_or((target_heading, ""));
    ParsedTarget {
        target: target.trim().to_owned(),
        heading: heading.trim().to_owned(),
        alias: alias.trim().to_owned(),
    }
}

fn note_link(parsed: &ParsedTarget, note: &IndexedNote) -> String {
    let label = if !parsed.alias.is_empty() {
        &parsed.alias
    } else if !parsed.heading.is_empty() {
        &parsed.heading
    } else if !note.title.is_empty() {
        &note.title
    } else {
        &parsed.target
    };
    let heading = if parsed.heading.is_empty() {
        String::new()
    } else {
        format!("#{}", github_slug(&parsed.heading))
    };
    format!("[{}]({}{})", escape_label(label), note.route, heading)
}

enum Resolution {
    Resolved(usize),
    Ambiguous(Vec<usize>),
    Unresolved,
}

fn resolve_note(raw: &str, source: &str, index: &ObsidianIndex) -> Resolution {
    let directory = source.rsplit_once('/').map(|value| value.0).unwrap_or("");
    let relative = normalize_note(&normalize_path(&format!("{directory}/{raw}")));
    let canonical = normalize_note(raw);
    let exact = unique(
        index
            .canonical
            .get(&relative)
            .into_iter()
            .flatten()
            .chain(index.canonical.get(&canonical).into_iter().flatten())
            .copied(),
    );
    if exact.len() == 1 {
        return Resolution::Resolved(exact[0]);
    }
    if exact.len() > 1 {
        return Resolution::Ambiguous(exact);
    }
    let aliases = unique(index.aliases.get(&canonical).into_iter().flatten().copied());
    match aliases.len() {
        0 => Resolution::Unresolved,
        1 => Resolution::Resolved(aliases[0]),
        _ => Resolution::Ambiguous(aliases),
    }
}

fn resolve_asset(raw: &str, source: &str, index: &ObsidianIndex) -> Resolution {
    let directory = source.rsplit_once('/').map(|value| value.0).unwrap_or("");
    let relative = normalize_common(&normalize_path(&format!("{directory}/{raw}")));
    let canonical = normalize_common(raw);
    let exact = unique(
        index
            .asset_canonical
            .get(&relative)
            .into_iter()
            .flatten()
            .chain(index.asset_canonical.get(&canonical).into_iter().flatten())
            .copied(),
    );
    if exact.len() == 1 {
        return Resolution::Resolved(exact[0]);
    }
    if exact.len() > 1 {
        return Resolution::Ambiguous(exact);
    }
    let basename = normalize_common(raw.rsplit('/').next().unwrap_or(raw));
    let values = unique(
        index
            .asset_basenames
            .get(&basename)
            .into_iter()
            .flatten()
            .copied(),
    );
    match values.len() {
        0 => Resolution::Unresolved,
        1 => Resolution::Resolved(values[0]),
        _ => Resolution::Ambiguous(values),
    }
}

fn select_note(candidates: &[usize], index: &ObsidianIndex) -> usize {
    let curated = candidates
        .iter()
        .copied()
        .filter(|value| {
            !index.notes[*value]
                .source_file
                .starts_with("notes/obsidian/")
        })
        .collect::<Vec<_>>();
    if curated.len() == 1 {
        curated[0]
    } else {
        candidates[0]
    }
}

fn protected_ranges(content: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut offset = 0;
    let mut fence_start = None;
    for line in content.split_inclusive('\n') {
        if line.trim_start().starts_with("```") {
            if let Some(start) = fence_start.take() {
                ranges.push((start, offset + line.len()));
            } else {
                fence_start = Some(offset);
            }
        } else if fence_start.is_none() {
            for value in MARKDOWN_LINK
                .find_iter(line)
                .chain(INLINE_CODE.find_iter(line))
            {
                ranges.push((offset + value.start(), offset + value.end()));
            }
        }
        offset += line.len();
    }
    if let Some(start) = fence_start {
        ranges.push((start, content.len()));
    }
    ranges
}

fn diagnostic(
    kind: &str,
    source: &str,
    line: usize,
    column: usize,
    target: &str,
    message: &str,
) -> Value {
    json!({
        "kind": kind,
        "sourceFile": source,
        "line": line,
        "column": column,
        "target": target,
        "message": message,
    })
}

fn location(content: &str, offset: usize) -> (usize, usize) {
    let prefix = &content[..offset];
    let line = prefix.bytes().filter(|value| *value == b'\n').count() + 1;
    let column = prefix.rsplit('\n').next().unwrap_or("").chars().count() + 1;
    (line, column)
}

fn asset_url(source: &str) -> String {
    let prefix = if source.starts_with("assets/") {
        ""
    } else {
        "content-assets/"
    };
    format!(
        "/{prefix}{}",
        source
            .split('/')
            .map(encode_component)
            .collect::<Vec<_>>()
            .join("/")
    )
}

fn encode_component(value: &str) -> String {
    let mut result = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            result.push(byte as char);
        } else {
            result.push_str(&format!("%{byte:02X}"));
        }
    }
    result
}

fn escape_label(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

fn normalize_note(value: &str) -> String {
    let value = normalize_common(value);
    let value = without_extension(&value);
    value.strip_suffix("/index").unwrap_or(&value).to_owned()
}

fn normalize_common(value: &str) -> String {
    value
        .nfkd()
        .filter(|character| !is_combining_mark(*character))
        .collect::<String>()
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches('/')
        .trim()
        .to_lowercase()
}

fn normalize_path(value: &str) -> String {
    let normalized = value.replace('\\', "/");
    let mut parts = Vec::new();
    for part in normalized.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    parts.join("/")
}

fn without_extension(value: &str) -> String {
    value
        .strip_suffix(".mdx")
        .or_else(|| value.strip_suffix(".md"))
        .unwrap_or(value)
        .to_owned()
}

fn add(map: &mut HashMap<String, Vec<usize>>, key: String, value: usize) {
    if key.is_empty() {
        return;
    }
    let values = map.entry(key).or_default();
    if !values.contains(&value) {
        values.push(value);
    }
}

fn unique(values: impl Iterator<Item = usize>) -> Vec<usize> {
    let mut seen = HashSet::new();
    values.filter(|value| seen.insert(*value)).collect()
}

fn slash(path: &Path) -> String {
    path.components()
        .map(|value| value.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_target_aliases_and_headings() {
        let parsed = parse_target("people/alex#Details|Read this");
        assert_eq!(parsed.target, "people/alex");
        assert_eq!(parsed.heading, "Details");
        assert_eq!(parsed.alias, "Read this");
    }

    #[test]
    fn protects_inline_and_fenced_code() {
        let source = "`[[inline]]`\n```md\n[[fenced]]\n```\n[[visible]]";
        let ranges = protected_ranges(source);
        assert!(
            ranges
                .iter()
                .any(|(start, end)| &source[*start..*end] == "`[[inline]]`")
        );
        assert!(
            ranges
                .iter()
                .any(|(start, end)| source[*start..*end].contains("[[fenced]]"))
        );
    }
}
