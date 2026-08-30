use castle_runtime::{AppSnapshot, CatalogNote};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ViewMode {
    List,
    Grid,
}

pub(super) fn recent_note_indexes(library: &AppSnapshot) -> Vec<usize> {
    let mut indexes = (0..library.notes.len()).collect::<Vec<_>>();
    indexes.sort_by(|left, right| {
        library.notes[*right]
            .modified_at
            .cmp(&library.notes[*left].modified_at)
    });
    indexes.truncate(5);
    indexes
}

pub(super) fn section_glyph(icon: &str) -> &'static str {
    match icon {
        "person" => "○",
        "heart" => "♡",
        "book" => "▤",
        "calendar" => "□",
        "document" => "▧",
        "inbox" => "↓",
        "video" => "▷",
        "folder-open" => "◇",
        "tick-circle" => "✓",
        "link" => "↗",
        _ => "◇",
    }
}

pub(super) fn title_case(value: &str) -> String {
    let normalized = value.replace(['_', '-'], " ");
    let mut characters = normalized.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
        None => normalized,
    }
}

pub(super) fn note_directory(note: &CatalogNote) -> Vec<String> {
    let mut parts = note
        .relative_path
        .split('/')
        .map(str::to_owned)
        .collect::<Vec<_>>();
    parts.pop();
    parts
}

pub(super) fn plural<'a>(count: usize, singular: &'a str, plural: &'a str) -> &'a str {
    if count == 1 { singular } else { plural }
}

pub(super) fn note_search_text(note: &CatalogNote) -> String {
    format!(
        "{} {} {} {}",
        note.title,
        note.relative_path,
        note.tags.join(" "),
        note.excerpt
    )
    .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::title_case;

    #[test]
    fn formats_library_path_labels() {
        assert_eq!(title_case("project_notes"), "Project notes");
        assert_eq!(title_case("reference-material"), "Reference material");
    }
}
