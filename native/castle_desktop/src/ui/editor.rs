use castle_runtime::{SaveSourceInput, SourceDocument};
use gpui::{AnyElement, Context, Entity, Focusable, FontWeight, Window, div, prelude::*, px, rgb};

use super::{
    CastleApp,
    actions::{Cancel, SaveNote, ToggleEdit},
    text_input::{TextInput, TextInputKind},
};
use crate::{route::Route, theme::*};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum EditorPhase {
    Loading,
    Ready,
    Saving,
    Conflict,
    Failed,
}

pub(super) struct NoteEditor {
    note_id: String,
    source_file: String,
    revision: String,
    saved_markdown: String,
    buffer: Option<Entity<TextInput>>,
    phase: EditorPhase,
    pub(super) message: Option<String>,
    pub(super) confirm_discard: bool,
}

impl NoteEditor {
    fn loading(note_id: String) -> Self {
        Self {
            note_id,
            source_file: String::new(),
            revision: String::new(),
            saved_markdown: String::new(),
            buffer: None,
            phase: EditorPhase::Loading,
            message: None,
            confirm_discard: false,
        }
    }

    fn dirty(&self, cx: &gpui::App) -> bool {
        self.buffer
            .as_ref()
            .is_some_and(|buffer| buffer.read(cx).text() != self.saved_markdown)
    }
}

impl CastleApp {
    pub(super) fn has_dirty_editor(&self, cx: &gpui::App) -> bool {
        self.editor.as_ref().is_some_and(|editor| editor.dirty(cx))
    }

    pub(crate) fn may_close(&self, cx: &gpui::App) -> bool {
        self.allow_close || !self.has_dirty_editor(cx)
    }

    pub(crate) fn allow_close(&mut self) {
        self.allow_close = true;
    }

    pub(super) fn start_editing(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Route::Note(note_id) = &self.route else {
            return;
        };
        if self
            .editor
            .as_ref()
            .is_some_and(|editor| editor.note_id == *note_id)
        {
            if let Some(buffer) = self
                .editor
                .as_ref()
                .and_then(|editor| editor.buffer.as_ref())
            {
                window.focus(&buffer.focus_handle(cx));
            }
            return;
        }
        let Some(client) = self.client.clone() else {
            self.library_notice = Some("The active library session is unavailable.".into());
            cx.notify();
            return;
        };

        let note_id = note_id.clone();
        let expected_epoch = client.epoch();
        self.editor = Some(NoteEditor::loading(note_id.clone()));
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let requested_note_id = note_id.clone();
            let result = background
                .spawn(async move { client.read_source(requested_note_id) })
                .await;
            let _ = this.update(&mut *cx, |this, cx| {
                if this.library_state.active_epoch() != Some(expected_epoch)
                    || this
                        .editor
                        .as_ref()
                        .is_none_or(|editor| editor.note_id != note_id)
                {
                    return;
                }
                match result {
                    Ok(document) => this.finish_loading_editor(document, cx),
                    Err(reason) => {
                        if let Some(editor) = this.editor.as_mut() {
                            editor.phase = EditorPhase::Failed;
                            editor.message = Some(format!("Could not load source: {reason:#}"));
                        }
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn finish_loading_editor(&mut self, document: SourceDocument, cx: &mut Context<Self>) {
        let buffer = cx.new(|cx| TextInput::new(cx, TextInputKind::Editor, "Markdown source"));
        buffer.update(cx, |buffer, cx| {
            buffer.set_text(document.markdown.clone(), cx)
        });
        cx.observe(&buffer, |_, _, cx| cx.notify()).detach();
        self.editor = Some(NoteEditor {
            note_id: document.note_id,
            source_file: document.source_file,
            revision: document.revision,
            saved_markdown: document.markdown,
            buffer: Some(buffer),
            phase: EditorPhase::Ready,
            message: None,
            confirm_discard: false,
        });
    }

    pub(super) fn save_editor(&mut self, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else {
            return;
        };
        let Some(editor) = self.editor.as_mut() else {
            return;
        };
        if matches!(editor.phase, EditorPhase::Loading | EditorPhase::Saving) {
            return;
        }
        let Some(buffer) = editor.buffer.as_ref() else {
            return;
        };
        let markdown = buffer.read(cx).text().to_owned();
        if let Err(reason) = validate_source(&editor.note_id, &editor.source_file, &markdown) {
            editor.phase = EditorPhase::Failed;
            editor.message = Some(reason);
            cx.notify();
            return;
        }
        let input = SaveSourceInput {
            note_id: editor.note_id.clone(),
            source_file: editor.source_file.clone(),
            markdown: markdown.clone(),
            expected_revision: editor.revision.clone(),
        };
        let note_id = editor.note_id.clone();
        let expected_epoch = client.epoch();
        editor.phase = EditorPhase::Saving;
        editor.message = Some("Saving…".into());
        editor.confirm_discard = false;
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let result = background.spawn(async move { client.save_source(input) }).await;
            let _ = this.update(&mut *cx, |this, cx| {
                if this.library_state.active_epoch() != Some(expected_epoch) { return; }
                let Some(editor) = this.editor.as_mut().filter(|editor| editor.note_id == note_id) else { return };
                match result {
                    Ok(saved) => {
                        editor.revision = saved.revision;
                        editor.saved_markdown = markdown;
                        editor.phase = EditorPhase::Ready;
                        editor.message = Some("Saved. The library view will refresh automatically.".into());
                    }
                    Err(reason) => {
                        let message = format!("{reason:#}");
                        editor.phase = if is_conflict(&message) { EditorPhase::Conflict } else { EditorPhase::Failed };
                        editor.message = Some(if editor.phase == EditorPhase::Conflict {
                            "This note changed on disk. Your draft is preserved; discard it and reopen the source before saving again.".into()
                        } else {
                            format!("Save failed: {message}")
                        });
                    }
                }
                cx.notify();
            });
        }).detach();
        cx.notify();
    }

    pub(super) fn request_close_editor(&mut self, cx: &mut Context<Self>) {
        let dirty = self.has_dirty_editor(cx);
        if dirty {
            if let Some(editor) = self.editor.as_mut() {
                editor.confirm_discard = true;
                editor.message =
                    Some("You have unsaved changes. Save them or choose Discard draft.".into());
            }
        } else {
            self.editor = None;
        }
        cx.notify();
    }

    pub(super) fn discard_editor(&mut self, cx: &mut Context<Self>) {
        self.editor = None;
        cx.notify();
    }

    pub(super) fn render_editor(
        &self,
        note_id: &str,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let editor = self
            .editor
            .as_ref()
            .filter(|editor| editor.note_id == note_id)?;
        let dirty = editor.dirty(cx);
        let phase_label = match editor.phase {
            EditorPhase::Loading => "LOADING SOURCE",
            EditorPhase::Ready if dirty => "UNSAVED CHANGES",
            EditorPhase::Ready => "SOURCE IS SAVED",
            EditorPhase::Saving => "SAVING",
            EditorPhase::Conflict => "SAVE CONFLICT",
            EditorPhase::Failed => "EDITOR ERROR",
        };
        let mut page = div()
            .id("source-editor")
            .min_h_0()
            .flex_1()
            .overflow_y_scroll()
            .bg(rgb(CANVAS))
            .child(
                div()
                    .max_w(px(960.0))
                    .mx_auto()
                    .p_8()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_3()
                            .child(
                                div()
                                    .text_size(px(9.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(rgb(if editor.phase == EditorPhase::Conflict {
                                        0xd28c55
                                    } else {
                                        ACCENT_HOVER
                                    }))
                                    .child(phase_label),
                            )
                            .child(div().flex_1())
                            .child(self.editor_button(
                                "editor-save",
                                "SAVE",
                                dirty
                                    && !matches!(
                                        editor.phase,
                                        EditorPhase::Loading
                                            | EditorPhase::Saving
                                            | EditorPhase::Conflict
                                    ),
                                |this, cx| this.save_editor(cx),
                                cx,
                            ))
                            .child(self.editor_button(
                                "editor-close",
                                "READ",
                                true,
                                |this, cx| this.request_close_editor(cx),
                                cx,
                            )),
                    )
                    .when_some(editor.message.clone(), |page, message| {
                        page.child(
                            div()
                                .mt_3()
                                .p_3()
                                .border_1()
                                .border_color(rgb(if editor.phase == EditorPhase::Conflict {
                                    0x73482c
                                } else {
                                    LINE
                                }))
                                .bg(rgb(PANEL))
                                .text_xs()
                                .text_color(rgb(TEXT_SECONDARY))
                                .child(message),
                        )
                    })
                    .when(editor.confirm_discard, |page| {
                        page.child(
                            div()
                                .mt_3()
                                .flex()
                                .gap_2()
                                .child(self.editor_button(
                                    "discard-draft",
                                    "DISCARD DRAFT",
                                    true,
                                    |this, cx| this.discard_editor(cx),
                                    cx,
                                ))
                                .child(self.editor_button(
                                    "keep-draft",
                                    "KEEP EDITING",
                                    true,
                                    |this, cx| {
                                        if let Some(editor) = this.editor.as_mut() {
                                            editor.confirm_discard = false;
                                            editor.message = None;
                                        }
                                        cx.notify();
                                    },
                                    cx,
                                )),
                        )
                    }),
            );
        if let Some(buffer) = &editor.buffer {
            page = page.child(
                div()
                    .max_w(px(960.0))
                    .mx_auto()
                    .px_8()
                    .pb_12()
                    .child(buffer.clone()),
            );
        }
        Some(page.into_any_element())
    }

    fn editor_button(
        &self,
        id: &'static str,
        label: &'static str,
        enabled: bool,
        handler: impl Fn(&mut Self, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        div()
            .id(id)
            .h(px(28.0))
            .flex()
            .items_center()
            .px_3()
            .border_1()
            .border_color(rgb(LINE))
            .bg(rgb(if enabled { PANEL } else { NAV }))
            .text_size(px(9.0))
            .font_weight(FontWeight::BOLD)
            .text_color(rgb(if enabled { TEXT } else { MUTED }))
            .when(enabled, |button| {
                button
                    .cursor_pointer()
                    .hover(|style| style.bg(rgb(HOVER)))
                    .on_click(cx.listener(move |this, _, _, cx| handler(this, cx)))
            })
            .child(label)
    }

    pub(super) fn toggle_edit(
        &mut self,
        _: &ToggleEdit,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.editor.is_some() {
            self.request_close_editor(cx);
        } else {
            self.start_editing(window, cx);
        }
    }

    pub(super) fn save_note(&mut self, _: &SaveNote, _: &mut Window, cx: &mut Context<Self>) {
        self.save_editor(cx);
    }

    pub(super) fn cancel(&mut self, _: &Cancel, _: &mut Window, cx: &mut Context<Self>) {
        if self.editor.is_some() {
            self.request_close_editor(cx);
        } else {
            self.search_input.update(cx, |input, cx| input.clear(cx));
        }
    }
}

fn validate_source(note_id: &str, source_file: &str, markdown: &str) -> Result<(), String> {
    if note_id.trim().is_empty() {
        return Err("Cannot save a source without a note id.".into());
    }
    if !source_file.ends_with(".md") {
        return Err("Castle only edits Markdown source files.".into());
    }
    if markdown.contains('\0') {
        return Err("The draft contains a NUL character and cannot be saved safely.".into());
    }
    Ok(())
}

fn is_conflict(message: &str) -> bool {
    let message = message.to_lowercase();
    message.contains("revision")
        || message.contains("conflict")
        || message.contains("changed on disk")
}

#[cfg(test)]
mod tests {
    use super::{is_conflict, validate_source};

    #[test]
    fn validates_safe_markdown_sources() {
        assert!(validate_source("note", "library/note.md", "# Fine").is_ok());
        assert!(validate_source("note", "library/note.txt", "# No").is_err());
        assert!(validate_source("note", "library/note.md", "bad\0value").is_err());
        assert!(is_conflict("expected revision abc but found def"));
    }
}
