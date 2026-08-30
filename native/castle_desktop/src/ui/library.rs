use castle_runtime::{AppSnapshot, CatalogNote, LibraryFolder};
use gpui::{Context, ScrollStrategy, Window};

use super::{
    CastleApp,
    actions::{LibraryDown, LibraryLeft, LibraryRight, LibraryUp, OpenSelected},
};
use crate::route::Route;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ViewMode {
    List,
    Grid,
}

#[derive(Clone)]
pub(super) enum LibraryEntry {
    Folder(LibraryFolder),
    Note(Box<CatalogNote>),
}

impl CastleApp {
    fn selectable_library_routes(&self, cx: &gpui::App) -> Vec<Route> {
        let Some(library) = self.library_state.snapshot() else {
            return Vec::new();
        };
        let query = self.search_input.read(cx).text().trim().to_lowercase();
        let Route::Library { section, directory } = &self.route else {
            return Vec::new();
        };
        if let Some(section_id) = section {
            let folders = library
                .folders_in_directory(section_id, directory)
                .into_iter()
                .filter(|index| {
                    query.is_empty()
                        || library.folders[*index]
                            .directory
                            .last()
                            .is_some_and(|name| title_case(name).to_lowercase().contains(&query))
                })
                .map(|index| Route::Library {
                    section: Some(section_id.clone()),
                    directory: library.folders[index].directory.clone(),
                });
            let notes = library
                .notes_in_directory(section_id, directory)
                .into_iter()
                .filter(|index| {
                    query.is_empty() || note_search_text(&library.notes[*index]).contains(&query)
                })
                .map(|index| Route::Note(library.notes[index].id.clone()));
            folders.chain(notes).collect()
        } else {
            library
                .sections
                .iter()
                .filter(|section| {
                    query.is_empty()
                        || format!("{} {}", section.label, section.id)
                            .to_lowercase()
                            .contains(&query)
                })
                .map(|section| Route::Library {
                    section: Some(section.id.clone()),
                    directory: Vec::new(),
                })
                .collect()
        }
    }

    fn move_library_selection(&mut self, delta: isize, cx: &mut Context<Self>) {
        let count = self.selectable_library_routes(cx).len();
        if count == 0 {
            self.library_selection = 0;
            return;
        }
        self.library_selection = self
            .library_selection
            .min(count - 1)
            .saturating_add_signed(delta)
            .min(count - 1);
        let columns = if self.view_mode == ViewMode::Grid {
            3
        } else {
            1
        };
        self.library_scroll
            .scroll_to_item(self.library_selection / columns, ScrollStrategy::Center);
        cx.notify();
    }

    pub(super) fn library_up(&mut self, _: &LibraryUp, _: &mut Window, cx: &mut Context<Self>) {
        let step = if self.view_mode == ViewMode::Grid {
            -3
        } else {
            -1
        };
        self.move_library_selection(step, cx);
    }

    pub(super) fn library_down(&mut self, _: &LibraryDown, _: &mut Window, cx: &mut Context<Self>) {
        let step = if self.view_mode == ViewMode::Grid {
            3
        } else {
            1
        };
        self.move_library_selection(step, cx);
    }

    pub(super) fn library_left(&mut self, _: &LibraryLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.move_library_selection(-1, cx);
    }

    pub(super) fn library_right(
        &mut self,
        _: &LibraryRight,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.move_library_selection(1, cx);
    }

    pub(super) fn open_selected(
        &mut self,
        _: &OpenSelected,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(route) = self
            .selectable_library_routes(cx)
            .get(self.library_selection)
            .cloned()
        {
            self.navigate(route, cx);
        }
    }
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
