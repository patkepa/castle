use std::{env, path::PathBuf};

use castle_gpui::{DemoLibrary, parse_library_override};
use gpui::{
    App, Application, Bounds, Context, FontWeight, IntoElement, Render, SharedString,
    TitlebarOptions, Window, WindowBounds, WindowOptions, div, prelude::*, px, rgb, size,
};

const INK: u32 = 0x18211c;
const MUTED: u32 = 0x69746d;
const CANVAS: u32 = 0xf4f5ef;
const PAPER: u32 = 0xfcfcf8;
const SIDEBAR: u32 = 0xe8ebe3;
const LINE: u32 = 0xd7dbd2;
const ACCENT: u32 = 0x315d46;
const ACCENT_SOFT: u32 = 0xdbe8de;

struct CastlePrototype {
    library: Result<DemoLibrary, SharedString>,
    selected_section: Option<String>,
    selected_note: Option<usize>,
}

impl CastlePrototype {
    fn new(library: Result<DemoLibrary, SharedString>) -> Self {
        let selected_note = library
            .as_ref()
            .ok()
            .and_then(|library| (!library.notes.is_empty()).then_some(0));
        Self {
            library,
            selected_section: None,
            selected_note,
        }
    }

    fn select_section(&mut self, section: Option<String>, cx: &mut Context<Self>) {
        self.selected_section = section;
        self.selected_note = self.library.as_ref().ok().and_then(|library| {
            library
                .notes_in_section(self.selected_section.as_deref())
                .first()
                .copied()
        });
        cx.notify();
    }

    fn render_navigation(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let mut navigation = div()
            .w(px(210.0))
            .h_full()
            .flex_none()
            .flex()
            .flex_col()
            .p_4()
            .gap_1()
            .bg(rgb(SIDEBAR))
            .border_r_1()
            .border_color(rgb(LINE));

        let Ok(library) = &self.library else {
            return navigation.child("Castle");
        };

        navigation = navigation
            .child(
                div()
                    .mb_5()
                    .child(
                        div()
                            .text_xl()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(rgb(INK))
                            .child("Castle"),
                    )
                    .child(
                        div()
                            .mt_1()
                            .text_xs()
                            .text_color(rgb(MUTED))
                            .child(library.name.clone()),
                    ),
            )
            .child(self.navigation_item("All notes", library.notes.len(), None, cx));

        for section in &library.sections {
            navigation = navigation.child(self.navigation_item(
                &section.label,
                section.count,
                Some(section.id.clone()),
                cx,
            ));
        }

        navigation.child(
            div()
                .mt_auto()
                .pt_4()
                .border_t_1()
                .border_color(rgb(LINE))
                .text_xs()
                .text_color(rgb(MUTED))
                .child("Native GPUI experiment")
                .child(div().mt_1().child(library.root.display().to_string())),
        )
    }

    fn navigation_item(
        &self,
        label: &str,
        count: usize,
        section: Option<String>,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let selected = self.selected_section == section;
        div()
            .id(SharedString::from(format!(
                "section-{}",
                section.clone().unwrap_or_else(|| "all".into())
            )))
            .flex()
            .items_center()
            .justify_between()
            .px_3()
            .py_2()
            .rounded_md()
            .cursor_pointer()
            .text_sm()
            .text_color(rgb(if selected { ACCENT } else { INK }))
            .when(selected, |item| item.bg(rgb(ACCENT_SOFT)))
            .hover(|style| style.bg(rgb(0xdfe3da)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.select_section(section.clone(), cx);
            }))
            .child(label.to_owned())
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(MUTED))
                    .child(count.to_string()),
            )
    }

    fn render_note_list(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let mut rail = div()
            .id("note-list")
            .w(px(310.0))
            .h_full()
            .flex_none()
            .flex()
            .flex_col()
            .bg(rgb(PAPER))
            .border_r_1()
            .border_color(rgb(LINE))
            .overflow_y_scroll();

        let Ok(library) = &self.library else {
            return rail;
        };
        let visible_notes = library.notes_in_section(self.selected_section.as_deref());
        let heading = self
            .selected_section
            .as_deref()
            .and_then(|id| library.sections.iter().find(|section| section.id == id))
            .map(|section| section.label.as_str())
            .unwrap_or("All notes");

        rail = rail.child(
            div()
                .p_4()
                .border_b_1()
                .border_color(rgb(LINE))
                .child(
                    div()
                        .text_lg()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(rgb(INK))
                        .child(heading.to_owned()),
                )
                .child(
                    div()
                        .mt_1()
                        .text_xs()
                        .text_color(rgb(MUTED))
                        .child(format!("{} documents", visible_notes.len())),
                ),
        );

        for note_index in visible_notes {
            let note = &library.notes[note_index];
            let selected = self.selected_note == Some(note_index);
            rail = rail.child(
                div()
                    .id(SharedString::from(format!("note-{}", note.id)))
                    .p_4()
                    .border_b_1()
                    .border_color(rgb(LINE))
                    .cursor_pointer()
                    .when(selected, |item| item.bg(rgb(ACCENT_SOFT)))
                    .hover(|style| style.bg(rgb(0xf0f2eb)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.selected_note = Some(note_index);
                        cx.notify();
                    }))
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(rgb(INK))
                            .child(note.title.clone()),
                    )
                    .child(
                        div()
                            .mt_2()
                            .text_xs()
                            .line_height(px(18.0))
                            .text_color(rgb(MUTED))
                            .child(note.excerpt.clone()),
                    ),
            );
        }
        rail
    }

    fn render_reader(&self) -> impl IntoElement {
        let reader = div()
            .id("reader")
            .h_full()
            .flex_1()
            .bg(rgb(CANVAS))
            .overflow_y_scroll();

        let Ok(library) = &self.library else {
            return reader.child(self.render_error());
        };
        let Some(note) = self
            .selected_note
            .and_then(|index| library.notes.get(index))
        else {
            return reader.child(
                div()
                    .h_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(rgb(MUTED))
                    .child("Choose a note to begin"),
            );
        };

        reader.child(
            div()
                .max_w(px(760.0))
                .mx_auto()
                .px_10()
                .py_12()
                .child(
                    div()
                        .text_xs()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(rgb(ACCENT))
                        .child(note.section.to_uppercase()),
                )
                .child(
                    div()
                        .mt_3()
                        .text_3xl()
                        .font_weight(FontWeight::BOLD)
                        .text_color(rgb(INK))
                        .child(note.title.clone()),
                )
                .child(
                    div()
                        .mt_3()
                        .pb_6()
                        .border_b_1()
                        .border_color(rgb(LINE))
                        .text_sm()
                        .text_color(rgb(MUTED))
                        .child(format!(
                            "{} words  ·  {} min read",
                            note.word_count, note.reading_minutes
                        )),
                )
                .child(
                    div()
                        .mt_7()
                        .text_base()
                        .line_height(px(27.0))
                        .text_color(rgb(INK))
                        .child(note.markdown.clone()),
                )
                .child(
                    div()
                        .mt_10()
                        .p_4()
                        .rounded_md()
                        .bg(rgb(ACCENT_SOFT))
                        .text_xs()
                        .line_height(px(18.0))
                        .text_color(rgb(ACCENT))
                        .child("Prototype boundary: this reader intentionally shows source Markdown. Rich Markdown layout, editing, search, and live daemon updates are the next feasibility slices."),
                ),
        )
    }

    fn render_error(&self) -> impl IntoElement {
        let message = self
            .library
            .as_ref()
            .err()
            .cloned()
            .unwrap_or_else(|| "Unknown startup error".into());
        div()
            .h_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap_3()
            .text_color(rgb(INK))
            .child(
                div()
                    .text_2xl()
                    .font_weight(FontWeight::BOLD)
                    .child("Castle could not open the library"),
            )
            .child(div().text_sm().text_color(rgb(MUTED)).child(message))
    }
}

impl Render for CastlePrototype {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .bg(rgb(CANVAS))
            .font_family("-apple-system")
            .child(self.render_navigation(cx))
            .child(self.render_note_list(cx))
            .child(self.render_reader())
    }
}

fn main() {
    let repository_root = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let library_override = parse_library_override(env::args().skip(1))
        .map_err(|error| SharedString::from(error.to_string()));
    let library = library_override.and_then(|override_path| {
        DemoLibrary::load(&repository_root, override_path.as_deref())
            .map_err(|error| SharedString::from(format!("{error:#}")))
    });

    Application::new().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(1180.0), px(760.0)), cx);
        cx.open_window(
            WindowOptions {
                titlebar: Some(TitlebarOptions {
                    title: Some("Castle — GPUI experiment".into()),
                    ..Default::default()
                }),
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |_, cx| cx.new(|_| CastlePrototype::new(library)),
        )
        .expect("failed to open Castle's GPUI window");
        cx.activate(true);
    });
}
