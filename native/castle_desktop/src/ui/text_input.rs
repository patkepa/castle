use std::{collections::HashMap, ops::Range};

use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, Element, ElementId, ElementInputHandler,
    Entity, EntityInputHandler, FocusHandle, Focusable, GlobalElementId, KeyBinding, LayoutId,
    MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, PaintQuad, Pixels, Point,
    ScrollStrategy, ShapedLine, SharedString, Style, TextRun, UTF16Selection, UnderlineStyle,
    UniformListScrollHandle, Window, actions, div, fill, point, prelude::*, px, relative, rgb,
    rgba, size, uniform_list,
};
use unicode_segmentation::UnicodeSegmentation;

use crate::theme::{ACCENT, ACTIVE, LINE, MUTED, PANEL, TEXT};

const EDITOR_LINE_HEIGHT: f32 = 22.0;
const HISTORY_LIMIT: usize = 128;

actions!(
    castle_text_input,
    [
        Backspace,
        Delete,
        Left,
        Right,
        Up,
        Down,
        PageUp,
        PageDown,
        SelectLeft,
        SelectRight,
        SelectUp,
        SelectDown,
        SelectAll,
        Home,
        End,
        Newline,
        Paste,
        Cut,
        Copy,
        Undo,
        Redo,
    ]
);

pub(crate) fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("backspace", Backspace, Some("CastleTextInput")),
        KeyBinding::new("delete", Delete, Some("CastleTextInput")),
        KeyBinding::new("left", Left, Some("CastleTextInput")),
        KeyBinding::new("right", Right, Some("CastleTextInput")),
        KeyBinding::new("up", Up, Some("CastleTextInput")),
        KeyBinding::new("down", Down, Some("CastleTextInput")),
        KeyBinding::new("pageup", PageUp, Some("CastleTextInput")),
        KeyBinding::new("pagedown", PageDown, Some("CastleTextInput")),
        KeyBinding::new("shift-left", SelectLeft, Some("CastleTextInput")),
        KeyBinding::new("shift-right", SelectRight, Some("CastleTextInput")),
        KeyBinding::new("shift-up", SelectUp, Some("CastleTextInput")),
        KeyBinding::new("shift-down", SelectDown, Some("CastleTextInput")),
        KeyBinding::new("cmd-a", SelectAll, Some("CastleTextInput")),
        KeyBinding::new("cmd-v", Paste, Some("CastleTextInput")),
        KeyBinding::new("cmd-c", Copy, Some("CastleTextInput")),
        KeyBinding::new("cmd-x", Cut, Some("CastleTextInput")),
        KeyBinding::new("cmd-z", Undo, Some("CastleTextInput")),
        KeyBinding::new("shift-cmd-z", Redo, Some("CastleTextInput")),
        KeyBinding::new("home", Home, Some("CastleTextInput")),
        KeyBinding::new("end", End, Some("CastleTextInput")),
        KeyBinding::new("enter", Newline, Some("CastleTextInput")),
    ]);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TextInputKind {
    Search,
    Find,
    TaskSearch,
    NewTask,
    Editor,
}

struct EditRecord {
    start: usize,
    removed: String,
    inserted: String,
    selection_before: Range<usize>,
    selection_before_reversed: bool,
    selection_after: Range<usize>,
    selection_after_reversed: bool,
}

struct CachedLine {
    layout: ShapedLine,
    bounds: Bounds<Pixels>,
    byte_range: Range<usize>,
}

pub(crate) struct TextInput {
    focus_handle: FocusHandle,
    content: String,
    placeholder: SharedString,
    selected_range: Range<usize>,
    selection_reversed: bool,
    marked_range: Option<Range<usize>>,
    kind: TextInputKind,
    line_starts: Vec<usize>,
    line_layouts: HashMap<usize, CachedLine>,
    scroll_handle: UniformListScrollHandle,
    is_selecting: bool,
    undo_stack: Vec<EditRecord>,
    redo_stack: Vec<EditRecord>,
    find_query: String,
    find_matches: Vec<Range<usize>>,
    active_match: Option<usize>,
}

impl TextInput {
    pub(crate) fn new(
        cx: &mut Context<Self>,
        kind: TextInputKind,
        placeholder: impl Into<SharedString>,
    ) -> Self {
        Self {
            focus_handle: cx.focus_handle().tab_stop(true),
            content: String::new(),
            placeholder: placeholder.into(),
            selected_range: 0..0,
            selection_reversed: false,
            marked_range: None,
            kind,
            line_starts: vec![0],
            line_layouts: HashMap::new(),
            scroll_handle: UniformListScrollHandle::new(),
            is_selecting: false,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            find_query: String::new(),
            find_matches: Vec::new(),
            active_match: None,
        }
    }

    pub(crate) fn text(&self) -> &str {
        &self.content
    }

    pub(crate) fn set_text(&mut self, content: impl Into<String>, cx: &mut Context<Self>) {
        self.content = content.into();
        let cursor = if self.kind == TextInputKind::Editor {
            0
        } else {
            self.content.len()
        };
        self.selected_range = cursor..cursor;
        self.selection_reversed = false;
        self.marked_range = None;
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.rebuild_lines();
        self.refresh_find_matches();
        self.scroll_to_cursor();
        cx.notify();
    }

    pub(crate) fn clear(&mut self, cx: &mut Context<Self>) {
        self.set_text(String::new(), cx);
    }

    pub(crate) fn set_find_query(&mut self, query: impl Into<String>, cx: &mut Context<Self>) {
        self.find_query = query.into();
        self.refresh_find_matches();
        if let Some(first) = self.find_matches.first().cloned() {
            self.active_match = Some(0);
            self.selected_range = first;
            self.selection_reversed = false;
            self.scroll_to_cursor();
        }
        cx.notify();
    }

    pub(crate) fn find_summary(&self) -> String {
        match (self.active_match, self.find_matches.len()) {
            (_, 0) if self.find_query.is_empty() => "Find in note".into(),
            (_, 0) => "No matches".into(),
            (Some(active), count) => format!("{} of {count}", active + 1),
            (None, count) => format!("{count} matches"),
        }
    }

    pub(crate) fn find_next(&mut self, backwards: bool, cx: &mut Context<Self>) {
        if self.find_matches.is_empty() {
            return;
        }
        let count = self.find_matches.len();
        let next = match (self.active_match, backwards) {
            (Some(active), true) => (active + count - 1) % count,
            (Some(active), false) => (active + 1) % count,
            (None, true) => count - 1,
            (None, false) => 0,
        };
        self.active_match = Some(next);
        self.selected_range = self.find_matches[next].clone();
        self.selection_reversed = false;
        self.scroll_to_cursor();
        cx.notify();
    }

    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        let offset = if self.selected_range.is_empty() {
            self.previous_boundary(self.cursor_offset())
        } else {
            self.selected_range.start
        };
        self.move_to(offset, cx);
    }

    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        let offset = if self.selected_range.is_empty() {
            self.next_boundary(self.cursor_offset())
        } else {
            self.selected_range.end
        };
        self.move_to(offset, cx);
    }

    fn up(&mut self, _: &Up, _: &mut Window, cx: &mut Context<Self>) {
        self.move_vertical(-1, false, cx);
    }

    fn down(&mut self, _: &Down, _: &mut Window, cx: &mut Context<Self>) {
        self.move_vertical(1, false, cx);
    }

    fn page_up(&mut self, _: &PageUp, _: &mut Window, cx: &mut Context<Self>) {
        self.move_vertical(-20, false, cx);
    }

    fn page_down(&mut self, _: &PageDown, _: &mut Window, cx: &mut Context<Self>) {
        self.move_vertical(20, false, cx);
    }

    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.previous_boundary(self.cursor_offset()), cx);
    }

    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.next_boundary(self.cursor_offset()), cx);
    }

    fn select_up(&mut self, _: &SelectUp, _: &mut Window, cx: &mut Context<Self>) {
        self.move_vertical(-1, true, cx);
    }

    fn select_down(&mut self, _: &SelectDown, _: &mut Window, cx: &mut Context<Self>) {
        self.move_vertical(1, true, cx);
    }

    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(0, cx);
        self.select_to(self.content.len(), cx);
    }

    fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        let line = self.line_for_offset(self.cursor_offset());
        self.move_to(self.line_range(line).start, cx);
    }

    fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        let line = self.line_for_offset(self.cursor_offset());
        self.move_to(self.line_range(line).end, cx);
    }

    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.select_to(self.previous_boundary(self.cursor_offset()), cx);
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.select_to(self.next_boundary(self.cursor_offset()), cx);
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn newline(&mut self, _: &Newline, window: &mut Window, cx: &mut Context<Self>) {
        if self.kind == TextInputKind::Editor {
            self.replace_text_in_range(None, "\n", window, cx);
        }
    }

    fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            let text = if self.kind == TextInputKind::Editor {
                text
            } else {
                text.replace(['\r', '\n'], " ")
            };
            self.replace_text_in_range(None, &text, window, cx);
        }
    }

    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.content[self.selected_range.clone()].to_owned(),
            ));
        }
    }

    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        if !self.selected_range.is_empty() {
            self.copy(&Copy, window, cx);
            self.replace_text_in_range(None, "", window, cx);
        }
    }

    fn undo(&mut self, _: &Undo, _: &mut Window, cx: &mut Context<Self>) {
        let Some(edit) = self.undo_stack.pop() else {
            return;
        };
        let inserted_end = edit.start + edit.inserted.len();
        self.content
            .replace_range(edit.start..inserted_end, &edit.removed);
        self.selected_range = edit.selection_before.clone();
        self.selection_reversed = edit.selection_before_reversed;
        self.redo_stack.push(edit);
        self.after_edit(cx);
    }

    fn redo(&mut self, _: &Redo, _: &mut Window, cx: &mut Context<Self>) {
        let Some(edit) = self.redo_stack.pop() else {
            return;
        };
        let removed_end = edit.start + edit.removed.len();
        self.content
            .replace_range(edit.start..removed_end, &edit.inserted);
        self.selected_range = edit.selection_after.clone();
        self.selection_reversed = edit.selection_after_reversed;
        self.undo_stack.push(edit);
        self.after_edit(cx);
    }

    fn mouse_down_line(
        &mut self,
        line: usize,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        window.focus(&self.focus_handle);
        self.is_selecting = true;
        let index = self.index_for_position(line, event.position);
        if event.modifiers.shift {
            self.select_to(index, cx);
        } else {
            self.move_to(index, cx);
        }
    }

    fn mouse_move_line(
        &mut self,
        line: usize,
        event: &MouseMoveEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.is_selecting {
            self.select_to(self.index_for_position(line, event.position), cx);
        }
    }

    fn mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        self.is_selecting = false;
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        let offset = offset.min(self.content.len());
        self.selected_range = offset..offset;
        self.selection_reversed = false;
        self.active_match = None;
        self.scroll_to_cursor();
        cx.notify();
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        let offset = offset.min(self.content.len());
        if self.selection_reversed {
            self.selected_range.start = offset;
        } else {
            self.selected_range.end = offset;
        }
        if self.selected_range.end < self.selected_range.start {
            self.selection_reversed = !self.selection_reversed;
            self.selected_range = self.selected_range.end..self.selected_range.start;
        }
        self.active_match = None;
        self.scroll_to_cursor();
        cx.notify();
    }

    fn move_vertical(&mut self, delta: isize, selecting: bool, cx: &mut Context<Self>) {
        if self.kind != TextInputKind::Editor {
            return;
        }
        let offset = self.cursor_offset();
        let line = self.line_for_offset(offset);
        let range = self.line_range(line);
        let column = self.content[range.start..offset.min(range.end)]
            .chars()
            .count();
        let target_line = line
            .saturating_add_signed(delta)
            .min(self.line_starts.len() - 1);
        let target = self.offset_at_column(target_line, column);
        if selecting {
            self.select_to(target, cx);
        } else {
            self.move_to(target, cx);
        }
    }

    fn cursor_offset(&self) -> usize {
        if self.selection_reversed {
            self.selected_range.start
        } else {
            self.selected_range.end
        }
    }

    fn previous_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .rev()
            .find_map(|(index, _)| (index < offset).then_some(index))
            .unwrap_or(0)
    }

    fn next_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .find_map(|(index, _)| (index > offset).then_some(index))
            .unwrap_or(self.content.len())
    }

    fn line_for_offset(&self, offset: usize) -> usize {
        self.line_starts
            .partition_point(|start| *start <= offset)
            .saturating_sub(1)
    }

    fn line_range(&self, line: usize) -> Range<usize> {
        let start = self.line_starts[line];
        let mut end = self
            .line_starts
            .get(line + 1)
            .copied()
            .unwrap_or(self.content.len());
        if end > start && self.content.as_bytes()[end - 1] == b'\n' {
            end -= 1;
            if end > start && self.content.as_bytes()[end - 1] == b'\r' {
                end -= 1;
            }
        }
        start..end
    }

    fn offset_at_column(&self, line: usize, column: usize) -> usize {
        let range = self.line_range(line);
        self.content[range.clone()]
            .char_indices()
            .nth(column)
            .map_or(range.end, |(offset, _)| range.start + offset)
    }

    fn index_for_position(&self, line: usize, position: Point<Pixels>) -> usize {
        let Some(cached) = self.line_layouts.get(&line) else {
            return self.line_range(line).start;
        };
        cached.byte_range.start
            + cached
                .layout
                .closest_index_for_x(position.x - cached.bounds.left())
    }

    fn rebuild_lines(&mut self) {
        self.line_starts = build_line_starts(&self.content);
        self.line_layouts.clear();
    }

    fn refresh_find_matches(&mut self) {
        self.find_matches.clear();
        self.active_match = None;
        if self.find_query.is_empty() {
            return;
        }
        if self.find_query.is_ascii() {
            let haystack = self.content.to_ascii_lowercase();
            let needle = self.find_query.to_ascii_lowercase();
            self.find_matches.extend(
                haystack
                    .match_indices(&needle)
                    .map(|(start, value)| start..start + value.len()),
            );
        } else {
            self.find_matches.extend(
                self.content
                    .match_indices(&self.find_query)
                    .map(|(start, value)| start..start + value.len()),
            );
        }
    }

    fn scroll_to_cursor(&self) {
        if self.kind == TextInputKind::Editor {
            self.scroll_handle.scroll_to_item(
                self.line_for_offset(self.cursor_offset()),
                ScrollStrategy::Center,
            );
        }
    }

    fn record_edit(&mut self, edit: EditRecord) {
        if self.undo_stack.len() == HISTORY_LIMIT {
            self.undo_stack.remove(0);
        }
        self.undo_stack.push(edit);
        self.redo_stack.clear();
    }

    fn after_edit(&mut self, cx: &mut Context<Self>) {
        self.marked_range = None;
        self.rebuild_lines();
        self.refresh_find_matches();
        self.scroll_to_cursor();
        cx.notify();
    }

    fn offset_from_utf16(&self, offset: usize) -> usize {
        utf8_offset_from_utf16(&self.content, offset)
    }

    fn offset_to_utf16(&self, offset: usize) -> usize {
        utf16_offset_from_utf8(&self.content, offset)
    }

    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.offset_to_utf16(range.start)..self.offset_to_utf16(range.end)
    }

    fn range_from_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.offset_from_utf16(range.start)..self.offset_from_utf16(range.end)
    }
}

fn utf8_offset_from_utf16(content: &str, offset: usize) -> usize {
    let mut utf8_offset = 0;
    let mut utf16_count = 0;
    for character in content.chars() {
        if utf16_count >= offset {
            break;
        }
        utf16_count += character.len_utf16();
        utf8_offset += character.len_utf8();
    }
    utf8_offset
}

fn utf16_offset_from_utf8(content: &str, offset: usize) -> usize {
    content[..offset].encode_utf16().count()
}

fn build_line_starts(content: &str) -> Vec<usize> {
    std::iter::once(0)
        .chain(content.match_indices('\n').map(|(index, _)| index + 1))
        .collect()
}

impl EntityInputHandler for TextInput {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        adjusted_range: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.range_from_utf16(&range);
        adjusted_range.replace(self.range_to_utf16(&range));
        Some(self.content[range].to_owned())
    }

    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.range_to_utf16(&self.selected_range),
            reversed: self.selection_reversed,
        })
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked_range
            .as_ref()
            .map(|range| self.range_to_utf16(range))
    }

    fn unmark_text(&mut self, _: &mut Window, _: &mut Context<Self>) {
        self.marked_range = None;
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        new_text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range
            .as_ref()
            .map(|range| self.range_from_utf16(range))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());
        let new_text = if self.kind == TextInputKind::Editor {
            new_text.to_owned()
        } else {
            new_text.replace(['\r', '\n'], " ")
        };
        let selection_before = self.selected_range.clone();
        let selection_before_reversed = self.selection_reversed;
        let removed = self.content[range.clone()].to_owned();
        self.content.replace_range(range.clone(), &new_text);
        let cursor = range.start + new_text.len();
        self.selected_range = cursor..cursor;
        self.selection_reversed = false;
        self.record_edit(EditRecord {
            start: range.start,
            removed,
            inserted: new_text,
            selection_before,
            selection_before_reversed,
            selection_after: self.selected_range.clone(),
            selection_after_reversed: self.selection_reversed,
        });
        self.marked_range = None;
        self.rebuild_lines();
        self.refresh_find_matches();
        self.scroll_to_cursor();
        cx.notify();
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        new_text: &str,
        new_selected_range: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range
            .as_ref()
            .map(|range| self.range_from_utf16(range))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());
        let selection_before = self.selected_range.clone();
        let selection_before_reversed = self.selection_reversed;
        let removed = self.content[range.clone()].to_owned();
        self.content.replace_range(range.clone(), new_text);
        self.marked_range =
            (!new_text.is_empty()).then_some(range.start..range.start + new_text.len());
        self.selected_range = new_selected_range
            .as_ref()
            .map(|selection| {
                utf8_offset_from_utf16(new_text, selection.start)
                    ..utf8_offset_from_utf16(new_text, selection.end)
            })
            .map(|selection| range.start + selection.start..range.start + selection.end)
            .unwrap_or_else(|| {
                let cursor = range.start + new_text.len();
                cursor..cursor
            });
        self.selection_reversed = false;
        self.record_edit(EditRecord {
            start: range.start,
            removed,
            inserted: new_text.to_owned(),
            selection_before,
            selection_before_reversed,
            selection_after: self.selected_range.clone(),
            selection_after_reversed: self.selection_reversed,
        });
        self.rebuild_lines();
        self.refresh_find_matches();
        self.scroll_to_cursor();
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        _: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let range = self.range_from_utf16(&range);
        let line = self.line_for_offset(range.start);
        let cached = self.line_layouts.get(&line)?;
        Some(Bounds::from_corners(
            point(
                cached.bounds.left()
                    + cached
                        .layout
                        .x_for_index(range.start.saturating_sub(cached.byte_range.start)),
                cached.bounds.top(),
            ),
            point(
                cached.bounds.left()
                    + cached.layout.x_for_index(
                        range.end.min(cached.byte_range.end) - cached.byte_range.start,
                    ),
                cached.bounds.bottom(),
            ),
        ))
    }

    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        let cached = self
            .line_layouts
            .values()
            .find(|line| line.bounds.contains(&point))?;
        let index =
            cached.byte_range.start + cached.layout.index_for_x(point.x - cached.bounds.left())?;
        Some(self.offset_to_utf16(index))
    }
}

impl Focusable for TextInput {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl gpui::Render for TextInput {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let focused = self.focus_handle.is_focused(window);
        let base = div()
            .id(match self.kind {
                TextInputKind::Search => "library-search-input",
                TextInputKind::Find => "editor-find-input",
                TextInputKind::TaskSearch => "task-search-input",
                TextInputKind::NewTask => "new-task-title-input",
                TextInputKind::Editor => "source-editor-input",
            })
            .key_context("CastleTextInput")
            .track_focus(&self.focus_handle)
            .cursor(CursorStyle::IBeam)
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::up))
            .on_action(cx.listener(Self::down))
            .on_action(cx.listener(Self::page_up))
            .on_action(cx.listener(Self::page_down))
            .on_action(cx.listener(Self::select_left))
            .on_action(cx.listener(Self::select_right))
            .on_action(cx.listener(Self::select_up))
            .on_action(cx.listener(Self::select_down))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::home))
            .on_action(cx.listener(Self::end))
            .on_action(cx.listener(Self::newline))
            .on_action(cx.listener(Self::paste))
            .on_action(cx.listener(Self::cut))
            .on_action(cx.listener(Self::copy))
            .on_action(cx.listener(Self::undo))
            .on_action(cx.listener(Self::redo));

        match self.kind {
            TextInputKind::Search
            | TextInputKind::Find
            | TextInputKind::TaskSearch
            | TextInputKind::NewTask => {
                base.h(px(28.0))
                    .w(px(match self.kind {
                        TextInputKind::Find | TextInputKind::NewTask => 260.0,
                        _ => 220.0,
                    }))
                    .px_3()
                    .border_1()
                    .border_color(rgb(if focused { ACTIVE } else { LINE }))
                    .bg(rgb(PANEL))
                    .text_xs()
                    .text_color(rgb(if self.content.is_empty() { MUTED } else { TEXT }))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, event, window, cx| {
                            this.mouse_down_line(0, event, window, cx)
                        }),
                    )
                    .on_mouse_move(cx.listener(|this, event, window, cx| {
                        this.mouse_move_line(0, event, window, cx)
                    }))
                    .on_mouse_up(MouseButton::Left, cx.listener(Self::mouse_up))
                    .child(TextLineElement {
                        input: cx.entity(),
                        line: 0,
                    })
                    .into_any_element()
            }
            TextInputKind::Editor => {
                let line_count = self.line_starts.len();
                let input = cx.entity();
                base.size_full()
                    .border_1()
                    .border_color(rgb(if focused { ACTIVE } else { LINE }))
                    .bg(rgb(PANEL))
                    .font_family("SFMono-Regular")
                    .text_sm()
                    .line_height(px(EDITOR_LINE_HEIGHT))
                    .text_color(rgb(TEXT))
                    .child(
                        uniform_list(
                            "source-editor-lines",
                            line_count,
                            cx.processor(move |this, range: Range<usize>, _, cx| {
                                this.line_layouts.retain(|line, _| range.contains(line));
                                range
                                    .map(|line| {
                                        div()
                                            .id(SharedString::from(format!("editor-line-{line}")))
                                            .h(px(EDITOR_LINE_HEIGHT))
                                            .w_full()
                                            .px_4()
                                            .on_mouse_down(
                                                MouseButton::Left,
                                                cx.listener(move |this, event, window, cx| {
                                                    this.mouse_down_line(line, event, window, cx)
                                                }),
                                            )
                                            .on_mouse_move(cx.listener(
                                                move |this, event, window, cx| {
                                                    this.mouse_move_line(line, event, window, cx)
                                                },
                                            ))
                                            .on_mouse_up(
                                                MouseButton::Left,
                                                cx.listener(Self::mouse_up),
                                            )
                                            .on_mouse_up_out(
                                                MouseButton::Left,
                                                cx.listener(Self::mouse_up),
                                            )
                                            .child(TextLineElement {
                                                input: input.clone(),
                                                line,
                                            })
                                    })
                                    .collect::<Vec<_>>()
                            }),
                        )
                        .size_full()
                        .track_scroll(self.scroll_handle.clone()),
                    )
                    .into_any_element()
            }
        }
    }
}

struct TextLineElement {
    input: Entity<TextInput>,
    line: usize,
}

struct LinePrepaintState {
    line: Option<ShapedLine>,
    byte_range: Range<usize>,
    cursor: Option<PaintQuad>,
    selection: Option<PaintQuad>,
    matches: Vec<PaintQuad>,
}

impl IntoElement for TextLineElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for TextLineElement {
    type RequestLayoutState = ();
    type PrepaintState = LinePrepaintState;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        style.size.height = window.line_height().into();
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let input = self.input.read(cx);
        let byte_range = input.line_range(self.line);
        let content = &input.content[byte_range.clone()];
        let display_text: SharedString = if content.is_empty() && input.content.is_empty() {
            input.placeholder.clone()
        } else {
            content.to_owned().into()
        };
        let style = window.text_style();
        let run = TextRun {
            len: display_text.len(),
            font: style.font(),
            color: if input.content.is_empty() {
                rgb(MUTED).into()
            } else {
                style.color
            },
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let runs = if let Some(marked) = input.marked_range.as_ref()
            && marked.start < byte_range.end
            && marked.end > byte_range.start
        {
            let start = marked
                .start
                .saturating_sub(byte_range.start)
                .min(display_text.len());
            let end = marked
                .end
                .saturating_sub(byte_range.start)
                .min(display_text.len());
            vec![
                TextRun {
                    len: start,
                    ..run.clone()
                },
                TextRun {
                    len: end.saturating_sub(start),
                    underline: Some(UnderlineStyle {
                        color: Some(run.color),
                        thickness: px(1.0),
                        wavy: false,
                    }),
                    ..run.clone()
                },
                TextRun {
                    len: display_text.len().saturating_sub(end),
                    ..run
                },
            ]
            .into_iter()
            .filter(|run| run.len > 0)
            .collect()
        } else {
            vec![run]
        };
        let font_size = style.font_size.to_pixels(window.rem_size());
        let shaped = window
            .text_system()
            .shape_line(display_text, font_size, &runs, None);
        let local_cursor = input
            .cursor_offset()
            .saturating_sub(byte_range.start)
            .min(shaped.text.len());
        let cursor = (input.selected_range.is_empty()
            && input.line_for_offset(input.cursor_offset()) == self.line)
            .then(|| {
                fill(
                    Bounds::new(
                        point(
                            bounds.left() + shaped.x_for_index(local_cursor),
                            bounds.top(),
                        ),
                        size(px(1.5), bounds.size.height),
                    ),
                    rgb(ACCENT),
                )
            });
        let selection = intersect_range(&input.selected_range, &byte_range).map(|selected| {
            fill(
                Bounds::from_corners(
                    point(
                        bounds.left() + shaped.x_for_index(selected.start - byte_range.start),
                        bounds.top(),
                    ),
                    point(
                        bounds.left() + shaped.x_for_index(selected.end - byte_range.start),
                        bounds.bottom(),
                    ),
                ),
                rgba(0x3d7dba55),
            )
        });
        let matches = input
            .find_matches
            .iter()
            .filter_map(|found| intersect_range(found, &byte_range))
            .map(|found| {
                fill(
                    Bounds::from_corners(
                        point(
                            bounds.left() + shaped.x_for_index(found.start - byte_range.start),
                            bounds.top(),
                        ),
                        point(
                            bounds.left() + shaped.x_for_index(found.end - byte_range.start),
                            bounds.bottom(),
                        ),
                    ),
                    rgba(0xd29b3855),
                )
            })
            .collect();
        LinePrepaintState {
            line: Some(shaped),
            byte_range,
            cursor,
            selection,
            matches,
        }
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let input = self.input.read(cx);
        let focus_handle = input.focus_handle.clone();
        let is_cursor_line = input.line_for_offset(input.cursor_offset()) == self.line;
        if is_cursor_line {
            window.handle_input(
                &focus_handle,
                ElementInputHandler::new(bounds, self.input.clone()),
                cx,
            );
        }
        for highlight in prepaint.matches.drain(..) {
            window.paint_quad(highlight);
        }
        if let Some(selection) = prepaint.selection.take() {
            window.paint_quad(selection);
        }
        let line = prepaint.line.take().expect("text line must be shaped");
        line.paint(bounds.origin, window.line_height(), window, cx)
            .expect("Castle text line should paint");
        if focus_handle.is_focused(window)
            && let Some(cursor) = prepaint.cursor.take()
        {
            window.paint_quad(cursor);
        }
        let byte_range = prepaint.byte_range.clone();
        self.input.update(cx, |input, _| {
            input.line_layouts.insert(
                self.line,
                CachedLine {
                    layout: line,
                    bounds,
                    byte_range,
                },
            );
        });
    }
}

fn intersect_range(left: &Range<usize>, right: &Range<usize>) -> Option<Range<usize>> {
    let start = left.start.max(right.start);
    let end = left.end.min(right.end);
    (start < end).then_some(start..end)
}

#[cfg(test)]
mod tests {
    use super::{
        build_line_starts, intersect_range, utf8_offset_from_utf16, utf16_offset_from_utf8,
    };

    #[test]
    fn utf16_ranges_round_trip() {
        assert_eq!(utf16_offset_from_utf8("A😀B", 5), 3);
        assert_eq!(utf8_offset_from_utf16("A😀B", 3), 5);
    }

    #[test]
    fn line_highlights_are_clipped_to_the_visible_line() {
        assert_eq!(intersect_range(&(2..12), &(5..9)), Some(5..9));
        assert_eq!(intersect_range(&(0..3), &(5..9)), None);
    }

    #[test]
    fn indexes_large_documents_without_per_line_view_state() {
        let document = "one line\n".repeat(50_000);
        let starts = build_line_starts(&document);
        assert_eq!(starts.len(), 50_001);
        assert_eq!(starts[50_000], document.len());
    }
}
