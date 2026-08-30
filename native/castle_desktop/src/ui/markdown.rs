#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Block {
    Heading {
        level: usize,
        text: String,
        id: String,
    },
    Paragraph(Vec<Inline>),
    BulletList(Vec<Vec<Inline>>),
    OrderedList(Vec<Vec<Inline>>),
    Quote(Vec<Inline>),
    Code {
        language: String,
        code: String,
    },
    Table {
        headers: Vec<Vec<Inline>>,
        rows: Vec<Vec<Vec<Inline>>>,
    },
    Image {
        alt: String,
        source: String,
    },
    Rule,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Inline {
    Text(String),
    Strong(String),
    Emphasis(String),
    Code(String),
    Link { label: String, target: String },
    InternalLink { label: String, note_id: String },
}

pub(super) fn parse(markdown: &str) -> Vec<Block> {
    let lines = markdown.lines().collect::<Vec<_>>();
    let mut blocks = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index].trim_end();
        if line.trim().is_empty() {
            index += 1;
            continue;
        }

        if let Some(fence) = line.trim_start().strip_prefix("```") {
            let language = fence.trim().to_owned();
            index += 1;
            let mut code = Vec::new();
            while index < lines.len() && !lines[index].trim_start().starts_with("```") {
                code.push(lines[index]);
                index += 1;
            }
            index += usize::from(index < lines.len());
            blocks.push(Block::Code {
                language,
                code: code.join("\n"),
            });
            continue;
        }

        if let Some((level, text)) = heading(line) {
            blocks.push(Block::Heading {
                level,
                id: slug(text),
                text: text.to_owned(),
            });
            index += 1;
            continue;
        }

        if let Some((alt, source)) = image(line.trim()) {
            blocks.push(Block::Image { alt, source });
            index += 1;
            continue;
        }

        if is_rule(line) {
            blocks.push(Block::Rule);
            index += 1;
            continue;
        }

        if index + 1 < lines.len() && is_table_separator(lines[index + 1]) {
            let headers = table_cells(line).into_iter().map(parse_inline).collect();
            index += 2;
            let mut rows = Vec::new();
            while index < lines.len()
                && lines[index].contains('|')
                && !lines[index].trim().is_empty()
            {
                rows.push(
                    table_cells(lines[index])
                        .into_iter()
                        .map(parse_inline)
                        .collect(),
                );
                index += 1;
            }
            blocks.push(Block::Table { headers, rows });
            continue;
        }

        if bullet_text(line).is_some() {
            let mut items = Vec::new();
            while index < lines.len() {
                let Some(text) = bullet_text(lines[index]) else {
                    break;
                };
                items.push(parse_inline(text));
                index += 1;
            }
            blocks.push(Block::BulletList(items));
            continue;
        }

        if ordered_text(line).is_some() {
            let mut items = Vec::new();
            while index < lines.len() {
                let Some(text) = ordered_text(lines[index]) else {
                    break;
                };
                items.push(parse_inline(text));
                index += 1;
            }
            blocks.push(Block::OrderedList(items));
            continue;
        }

        if let Some(text) = line.trim_start().strip_prefix('>') {
            blocks.push(Block::Quote(parse_inline(text.trim_start())));
            index += 1;
            continue;
        }

        let mut paragraph = vec![line.trim()];
        index += 1;
        while index < lines.len() && !lines[index].trim().is_empty() && !starts_block(&lines, index)
        {
            paragraph.push(lines[index].trim());
            index += 1;
        }
        blocks.push(Block::Paragraph(parse_inline(&paragraph.join(" "))));
    }
    blocks
}

pub(super) fn parse_inline(text: &str) -> Vec<Inline> {
    let mut result = Vec::new();
    let mut remaining = text;
    while !remaining.is_empty() {
        if let Some(rest) = remaining.strip_prefix("[[")
            && let Some(end) = rest.find("]] ").or_else(|| rest.find("]]"))
        {
            let raw = &rest[..end];
            let (target, label) = raw.split_once('|').unwrap_or((raw, raw));
            result.push(Inline::InternalLink {
                label: label.trim().to_owned(),
                note_id: target.split('#').next().unwrap_or(target).trim().to_owned(),
            });
            remaining = &rest[end + 2..];
            continue;
        }
        if let Some(rest) = remaining.strip_prefix("**")
            && let Some(end) = rest.find("**")
        {
            result.push(Inline::Strong(rest[..end].to_owned()));
            remaining = &rest[end + 2..];
            continue;
        }
        if let Some(rest) = remaining.strip_prefix('`')
            && let Some(end) = rest.find('`')
        {
            result.push(Inline::Code(rest[..end].to_owned()));
            remaining = &rest[end + 1..];
            continue;
        }
        if let Some(rest) = remaining.strip_prefix('[')
            && let Some(label_end) = rest.find("](")
            && let Some(target_end) = rest[label_end + 2..].find(')')
        {
            let label = &rest[..label_end];
            let target = &rest[label_end + 2..label_end + 2 + target_end];
            if let Some(note_id) = internal_note_id(target) {
                result.push(Inline::InternalLink {
                    label: label.to_owned(),
                    note_id,
                });
            } else {
                result.push(Inline::Link {
                    label: label.to_owned(),
                    target: target.to_owned(),
                });
            }
            remaining = &rest[label_end + 3 + target_end..];
            continue;
        }
        if let Some(rest) = remaining.strip_prefix('*')
            && let Some(end) = rest.find('*')
        {
            result.push(Inline::Emphasis(rest[..end].to_owned()));
            remaining = &rest[end + 1..];
            continue;
        }

        let next = ["[[", "**", "`", "[", "*"]
            .iter()
            .filter_map(|marker| remaining[1..].find(marker).map(|offset| offset + 1))
            .min()
            .unwrap_or(remaining.len());
        result.push(Inline::Text(remaining[..next].to_owned()));
        remaining = &remaining[next..];
    }
    result
}

fn starts_block(lines: &[&str], index: usize) -> bool {
    let line = lines[index];
    line.trim_start().starts_with("```")
        || heading(line).is_some()
        || image(line.trim()).is_some()
        || is_rule(line)
        || bullet_text(line).is_some()
        || ordered_text(line).is_some()
        || line.trim_start().starts_with('>')
        || index + 1 < lines.len() && is_table_separator(lines[index + 1])
}

fn heading(line: &str) -> Option<(usize, &str)> {
    let trimmed = line.trim_start();
    let level = trimmed
        .chars()
        .take_while(|character| *character == '#')
        .count();
    (1..=6)
        .contains(&level)
        .then(|| trimmed[level..].strip_prefix(' ').map(|text| (level, text)))
        .flatten()
}

fn bullet_text(line: &str) -> Option<&str> {
    let line = line.trim_start();
    ["- ", "* ", "+ "]
        .iter()
        .find_map(|prefix| line.strip_prefix(prefix))
}

fn ordered_text(line: &str) -> Option<&str> {
    let line = line.trim_start();
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    (digits > 0)
        .then(|| line[digits..].strip_prefix(". "))
        .flatten()
}

fn is_rule(line: &str) -> bool {
    matches!(line.trim(), "---" | "***" | "___")
}

fn image(line: &str) -> Option<(String, String)> {
    let rest = line.strip_prefix("![")?;
    let alt_end = rest.find("](")?;
    let source = rest[alt_end + 2..].strip_suffix(')')?;
    Some((rest[..alt_end].to_owned(), source.to_owned()))
}

fn table_cells(line: &str) -> Vec<&str> {
    line.trim()
        .trim_matches('|')
        .split('|')
        .map(str::trim)
        .collect()
}

fn is_table_separator(line: &str) -> bool {
    let cells = table_cells(line);
    !cells.is_empty()
        && cells.iter().all(|cell| {
            let cell = cell.trim_matches(':');
            cell.len() >= 3 && cell.chars().all(|character| character == '-')
        })
}

fn internal_note_id(target: &str) -> Option<String> {
    let path = target.split('#').next().unwrap_or(target);
    path.strip_prefix("/notes/")
        .or_else(|| path.strip_prefix("notes/"))
        .map(|id| id.trim_end_matches('/').to_owned())
}

fn slug(text: &str) -> String {
    text.chars()
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::{Block, Inline, parse};

    #[test]
    fn parses_reader_structures_and_links() {
        let blocks = parse(
            "# Hello\n\nRead **bold**, [[note-two|Note two]], and [docs](https://example.com).\n\n- One\n- Two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```rust\nfn main() {}\n```\n\n![Map](/content-assets/map.png)",
        );
        assert!(matches!(&blocks[0], Block::Heading { id, .. } if id == "hello"));
        assert!(
            matches!(&blocks[1], Block::Paragraph(parts) if parts.iter().any(|part| matches!(part, Inline::InternalLink { note_id, .. } if note_id == "note-two")))
        );
        assert!(matches!(&blocks[2], Block::BulletList(items) if items.len() == 2));
        assert!(matches!(&blocks[3], Block::Table { rows, .. } if rows.len() == 1));
        assert!(matches!(&blocks[4], Block::Code { language, .. } if language == "rust"));
        assert!(matches!(&blocks[5], Block::Image { source, .. } if source.ends_with("map.png")));
    }
}
