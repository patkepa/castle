use castle_core::{IndexNote, normalize_search_text};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const CHUNKING_VERSION: u32 = 1;
const TARGET_TOKENS: usize = 600;
const MAXIMUM_TOKENS: usize = 800;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeChunk {
    pub chunk_key: String,
    pub note_id: String,
    pub ordinal: usize,
    pub heading_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub plain_text: String,
    pub search_text: String,
    pub content_hash: String,
    pub estimated_tokens: usize,
}

#[derive(Debug)]
struct StructuralBlock {
    heading_path: String,
    start_line: usize,
    end_line: usize,
    text: String,
}

pub fn chunk_note(note: &IndexNote) -> Vec<KnowledgeChunk> {
    let blocks = structural_blocks(note);
    let mut packed = Vec::<StructuralBlock>::new();
    for block in blocks {
        if estimate_tokens(&block.text) <= MAXIMUM_TOKENS {
            packed.push(block);
        } else {
            packed.extend(split_large_block(block));
        }
    }

    let mut groups = Vec::<Vec<StructuralBlock>>::new();
    for block in packed {
        let can_append = groups.last().is_some_and(|group| {
            group.last().is_some_and(|previous| {
                previous.heading_path == block.heading_path
                    && estimate_tokens(
                        &group
                            .iter()
                            .map(|item| item.text.as_str())
                            .chain(std::iter::once(block.text.as_str()))
                            .collect::<Vec<_>>()
                            .join("\n\n"),
                    ) <= TARGET_TOKENS
            })
        });
        if can_append {
            groups.last_mut().unwrap().push(block);
        } else {
            groups.push(vec![block]);
        }
    }

    groups
        .into_iter()
        .enumerate()
        .map(|(ordinal, group)| {
            let first = group.first().unwrap();
            let last = group.last().unwrap();
            let text = group
                .iter()
                .map(|block| block.text.trim())
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n");
            let heading_path = first.heading_path.clone();
            let content_hash = format!("{:x}", Sha256::digest(text.as_bytes()));
            let heading_key = if heading_path.is_empty() {
                "root".to_owned()
            } else {
                format!("{:x}", Sha256::digest(heading_path.as_bytes()))[..12].to_owned()
            };
            KnowledgeChunk {
                chunk_key: format!(
                    "{}:{}:{}:{}",
                    note.note_id, CHUNKING_VERSION, heading_key, ordinal
                ),
                note_id: note.note_id.clone(),
                ordinal,
                heading_path,
                start_line: note.source_line_offset + first.start_line,
                end_line: note.source_line_offset + last.end_line,
                search_text: normalize_search_text(&text),
                estimated_tokens: estimate_tokens(&text),
                plain_text: text,
                content_hash,
            }
        })
        .filter(|chunk| !chunk.plain_text.is_empty())
        .collect()
}

fn structural_blocks(note: &IndexNote) -> Vec<StructuralBlock> {
    let lines = note.compiled_markdown.lines().collect::<Vec<_>>();
    let headings = note
        .headings
        .iter()
        .map(|heading| (heading.line, (heading.depth, heading.label.as_str())))
        .collect::<std::collections::HashMap<_, _>>();
    let mut heading_stack = Vec::<(usize, String)>::new();
    let mut blocks = Vec::new();
    let mut current = Vec::<(usize, &str)>::new();
    let mut inside_fence = false;

    for (index, line) in lines.iter().enumerate() {
        let line_number = index + 1;
        if let Some((depth, label)) = headings.get(&line_number) {
            flush_block(&mut blocks, &mut current, &heading_stack);
            while heading_stack
                .last()
                .is_some_and(|(current, _)| current >= depth)
            {
                heading_stack.pop();
            }
            heading_stack.push((*depth, (*label).to_owned()));
            continue;
        }

        let starts_fence = line.trim_start().starts_with("```");
        if starts_fence {
            inside_fence = !inside_fence;
        }
        if line.trim().is_empty() && !inside_fence {
            flush_block(&mut blocks, &mut current, &heading_stack);
            continue;
        }
        current.push((line_number, line));
    }
    flush_block(&mut blocks, &mut current, &heading_stack);
    blocks
}

fn flush_block(
    blocks: &mut Vec<StructuralBlock>,
    current: &mut Vec<(usize, &str)>,
    heading_stack: &[(usize, String)],
) {
    if current.is_empty() {
        return;
    }
    let start_line = current.first().unwrap().0;
    let end_line = current.last().unwrap().0;
    let text = current
        .iter()
        .map(|(_, line)| *line)
        .collect::<Vec<_>>()
        .join("\n");
    blocks.push(StructuralBlock {
        heading_path: heading_stack
            .iter()
            .map(|(_, label)| label.as_str())
            .collect::<Vec<_>>()
            .join(" > "),
        start_line,
        end_line,
        text,
    });
    current.clear();
}

fn split_large_block(block: StructuralBlock) -> Vec<StructuralBlock> {
    let lines = block.text.lines().collect::<Vec<_>>();
    let mut blocks = Vec::new();
    let mut start = 0;
    while start < lines.len() {
        let mut end = start + 1;
        while end < lines.len() && estimate_tokens(&lines[start..=end].join("\n")) <= MAXIMUM_TOKENS
        {
            end += 1;
        }
        blocks.push(StructuralBlock {
            heading_path: block.heading_path.clone(),
            start_line: block.start_line + start,
            end_line: block.start_line + end - 1,
            text: lines[start..end].join("\n"),
        });
        start = end;
    }
    blocks
}

fn estimate_tokens(value: &str) -> usize {
    value.chars().count().div_ceil(4).max(1)
}

#[cfg(test)]
mod tests {
    use castle_core::IndexNote;
    use serde_json::json;

    use super::*;

    fn note() -> IndexNote {
        IndexNote {
            note_id: "notes/example".to_owned(),
            record_id: None,
            record_type: None,
            section: "notes".to_owned(),
            section_label: "Notes".to_owned(),
            relative_path: "example".to_owned(),
            source_file: "notes/example.md".to_owned(),
            route: "/note/notes/example".to_owned(),
            title: "Example".to_owned(),
            excerpt: String::new(),
            preview: None,
            compiled_markdown: "Intro line.\n\n## Polish\n\nZażółć gęślą jaźń.\n\n```rust\nfn main() {}\n```\n\n- one\n- two".to_owned(),
            search_text: String::new(),
            source_revision: "revision".to_owned(),
            source_line_offset: 5,
            created_at: None,
            modified_at: String::new(),
            word_count: 0,
            reading_minutes: 0,
            pinned: false,
            status: String::new(),
            avatar_url: String::new(),
            content_path: "/generated/notes/example.json".to_owned(),
            sidebar: None,
            tags: Vec::new(),
            aliases: Vec::new(),
            headings: vec![castle_core::Heading {
                depth: 2,
                label: "Polish".to_owned(),
                id: "polish".to_owned(),
                line: 3,
            }],
            backlinks: Vec::new(),
            frontmatter: json!({}),
        }
    }

    #[test]
    fn preserves_heading_paths_structures_and_source_lines() {
        let chunks = chunk_note(&note());

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].start_line, 6);
        assert_eq!(chunks[1].heading_path, "Polish");
        assert!(chunks[1].plain_text.contains("```rust\nfn main() {}\n```"));
        assert!(chunks[1].plain_text.contains("- one\n- two"));
        assert_eq!(chunks[1].start_line, 10);
        assert_eq!(chunks[1].end_line, 17);
        assert_eq!(chunks, chunk_note(&note()));
    }
}
