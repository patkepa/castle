use castle_runtime::{AppSnapshot, CatalogNote};
use gpui::{AnyElement, Context, FontWeight, SharedString, div, img, prelude::*, px, rgb};

use super::{
    CastleApp,
    markdown::{self, Block, Inline},
};
use crate::{route::Route, theme::*};

impl CastleApp {
    pub(super) fn render_note(
        &self,
        library: &AppSnapshot,
        note_id: &str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if let Some(editor) = self.render_editor(note_id, cx) {
            return editor;
        }
        let Some(note) = library.note_by_id(note_id) else {
            return div().p_8().child("Note not found").into_any_element();
        };
        let Some(content) = library.note_content(note_id) else {
            return div()
                .p_8()
                .child("Note content is unavailable")
                .into_any_element();
        };

        let mut article = div()
            .id("note-article")
            .min_w_0()
            .max_w(px(780.0))
            .flex_1()
            .px_10()
            .py_12()
            .child(self.note_header(note));
        for (index, block) in markdown::parse(&content.content).into_iter().enumerate() {
            article = article.child(self.render_markdown_block(block, index, library, cx));
        }

        div()
            .id("note-reader")
            .min_h_0()
            .flex_1()
            .overflow_y_scroll()
            .bg(rgb(CANVAS))
            .child(
                div()
                    .max_w(px(1120.0))
                    .mx_auto()
                    .flex()
                    .items_start()
                    .child(article)
                    .child(self.note_outline(library, note_id, cx)),
            )
            .into_any_element()
    }

    fn note_header(&self, note: &CatalogNote) -> impl IntoElement {
        div()
            .pb_7()
            .border_b_1()
            .border_color(rgb(LINE))
            .child(
                div()
                    .text_size(px(9.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(rgb(ACCENT_HOVER))
                    .child(note.section_label.to_uppercase()),
            )
            .child(
                div()
                    .mt_3()
                    .text_size(px(48.0))
                    .line_height(px(52.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(rgb(TEXT))
                    .child(note.title.clone()),
            )
            .child(div().mt_4().text_xs().text_color(rgb(MUTED)).child(format!(
                "{} words  ·  {} min read  ·  {}",
                note.word_count, note.reading_minutes, note.relative_path
            )))
    }

    fn render_markdown_block(
        &self,
        block: Block,
        index: usize,
        library: &AppSnapshot,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match block {
            Block::Heading { level, text, id } => div()
                .id(SharedString::from(format!("heading-{id}-{index}")))
                .mt(px(if level == 1 { 38.0 } else { 28.0 }))
                .mb_3()
                .text_size(px(match level {
                    1 => 32.0,
                    2 => 26.0,
                    3 => 21.0,
                    _ => 17.0,
                }))
                .line_height(px(match level {
                    1 => 38.0,
                    2 => 32.0,
                    _ => 26.0,
                }))
                .font_weight(FontWeight::BOLD)
                .text_color(rgb(TEXT))
                .child(text)
                .into_any_element(),
            Block::Paragraph(parts) => self
                .inline_row(parts, library, cx)
                .mt_5()
                .text_base()
                .line_height(px(28.0))
                .into_any_element(),
            Block::Quote(parts) => div()
                .mt_6()
                .pl_5()
                .py_2()
                .border_l_2()
                .border_color(rgb(ACCENT))
                .text_color(rgb(TEXT_SECONDARY))
                .child(self.inline_row(parts, library, cx))
                .into_any_element(),
            Block::BulletList(items) => self.render_markdown_list(items, false, library, cx),
            Block::OrderedList(items) => self.render_markdown_list(items, true, library, cx),
            Block::Code { language, code } => div()
                .mt_6()
                .border_1()
                .border_color(rgb(LINE))
                .bg(rgb(PANEL))
                .when(!language.is_empty(), |block| {
                    block.child(
                        div()
                            .px_4()
                            .py_2()
                            .border_b_1()
                            .border_color(rgb(LINE))
                            .text_size(px(9.0))
                            .text_color(rgb(MUTED))
                            .child(language.to_uppercase()),
                    )
                })
                .child(
                    div()
                        .p_5()
                        .font_family("SFMono-Regular")
                        .text_sm()
                        .line_height(px(22.0))
                        .text_color(rgb(TEXT_SECONDARY))
                        .child(code),
                )
                .into_any_element(),
            Block::Table { headers, rows } => {
                let mut table = div()
                    .mt_6()
                    .border_t_1()
                    .border_l_1()
                    .border_color(rgb(LINE));
                table = table.child(self.table_row(headers, true, library, cx));
                for row in rows {
                    table = table.child(self.table_row(row, false, library, cx));
                }
                table.into_any_element()
            }
            Block::Image { alt, source } => {
                if let Some(path) = library.asset_path(&source) {
                    div()
                        .mt_7()
                        .child(img(path).max_w_full())
                        .when(!alt.is_empty(), |image| {
                            image.child(div().mt_2().text_xs().text_color(rgb(MUTED)).child(alt))
                        })
                        .into_any_element()
                } else {
                    div()
                        .mt_6()
                        .p_4()
                        .border_1()
                        .border_color(rgb(LINE))
                        .text_xs()
                        .text_color(rgb(MUTED))
                        .child(format!("Missing asset: {alt} ({source})"))
                        .into_any_element()
                }
            }
            Block::Rule => div()
                .mt_8()
                .border_t_1()
                .border_color(rgb(LINE))
                .into_any_element(),
        }
    }

    fn render_markdown_list(
        &self,
        items: Vec<Vec<Inline>>,
        ordered: bool,
        library: &AppSnapshot,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mut list = div().mt_5().flex().flex_col().gap_2();
        for (item_index, item) in items.into_iter().enumerate() {
            list = list.child(
                div()
                    .flex()
                    .items_start()
                    .gap_3()
                    .text_base()
                    .line_height(px(26.0))
                    .child(
                        div()
                            .w(px(22.0))
                            .flex_none()
                            .text_color(rgb(ACCENT_HOVER))
                            .child(if ordered {
                                format!("{}.", item_index + 1)
                            } else {
                                "•".into()
                            }),
                    )
                    .child(self.inline_row(item, library, cx)),
            );
        }
        list.into_any_element()
    }

    fn table_row(
        &self,
        cells: Vec<Vec<Inline>>,
        header: bool,
        library: &AppSnapshot,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let mut row = div().flex();
        for cell in cells {
            row = row.child(
                div()
                    .min_w(px(120.0))
                    .flex_1()
                    .p_3()
                    .border_r_1()
                    .border_b_1()
                    .border_color(rgb(LINE))
                    .bg(rgb(if header { PANEL } else { CANVAS }))
                    .when(header, |cell| cell.font_weight(FontWeight::BOLD))
                    .child(self.inline_row(cell, library, cx)),
            );
        }
        row
    }

    fn inline_row(
        &self,
        parts: Vec<Inline>,
        _library: &AppSnapshot,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        let mut row = div()
            .min_w_0()
            .flex()
            .flex_wrap()
            .text_color(rgb(TEXT_SECONDARY));
        for (index, part) in parts.into_iter().enumerate() {
            row = match part {
                Inline::Text(text) => row.child(text),
                Inline::Strong(text) => row.child(
                    div()
                        .font_weight(FontWeight::BOLD)
                        .text_color(rgb(TEXT))
                        .child(text),
                ),
                Inline::Emphasis(text) => row.child(div().italic().child(text)),
                Inline::Code(text) => row.child(
                    div()
                        .mx_1()
                        .px_1()
                        .bg(rgb(PANEL))
                        .font_family("SFMono-Regular")
                        .text_sm()
                        .text_color(rgb(TEXT))
                        .child(text),
                ),
                Inline::InternalLink { label, note_id } => row.child(
                    div()
                        .id(SharedString::from(format!(
                            "internal-link-{index}-{note_id}"
                        )))
                        .cursor_pointer()
                        .text_color(rgb(ACCENT_HOVER))
                        .hover(|style| style.text_color(rgb(TEXT)))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.navigate(Route::Note(note_id.clone()), cx)
                        }))
                        .child(label),
                ),
                Inline::Link { label, target } => row.child(
                    div()
                        .id(SharedString::from(format!(
                            "external-link-{index}-{target}"
                        )))
                        .cursor_pointer()
                        .text_color(rgb(ACCENT_HOVER))
                        .on_click(cx.listener(move |_, _, _, cx| cx.open_url(&target)))
                        .child(label),
                ),
            };
        }
        row
    }

    fn note_outline(
        &self,
        library: &AppSnapshot,
        note_id: &str,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let content = library.note_content(note_id);
        let mut aside = div()
            .w(px(280.0))
            .flex_none()
            .mt_12()
            .mr_8()
            .p_5()
            .border_l_1()
            .border_color(rgb(LINE));

        if let Some(content) = content {
            aside = aside.child(self.outline_label("ON THIS PAGE"));
            for heading in &content.headings {
                aside = aside.child(
                    div()
                        .mt_2()
                        .ml(px((heading.depth.saturating_sub(1) * 10) as f32))
                        .truncate()
                        .text_xs()
                        .text_color(rgb(TEXT_SECONDARY))
                        .child(heading.label.clone()),
                );
            }

            aside = aside.child(div().mt_7().child(self.outline_label("BACKLINKS")));
            if content.backlinks.is_empty() {
                aside = aside.child(
                    div()
                        .mt_2()
                        .text_xs()
                        .text_color(rgb(MUTED))
                        .child("No notes link here yet."),
                );
            }
            for backlink in &content.backlinks {
                if let Some(note) = library.note_by_id(&backlink.source_note_id) {
                    let source_id = note.id.clone();
                    let context = backlink
                        .occurrences
                        .first()
                        .map(|item| item.context.clone())
                        .unwrap_or_default();
                    aside = aside.child(
                        div()
                            .id(SharedString::from(format!("backlink-{}", note.id)))
                            .mt_3()
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.navigate(Route::Note(source_id.clone()), cx)
                            }))
                            .child(
                                div()
                                    .text_xs()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(rgb(ACCENT_HOVER))
                                    .child(note.title.clone()),
                            )
                            .when(!context.is_empty(), |item| {
                                item.child(
                                    div()
                                        .mt_1()
                                        .line_clamp(2)
                                        .text_size(px(10.0))
                                        .text_color(rgb(MUTED))
                                        .child(context),
                                )
                            }),
                    );
                }
            }
        }
        aside
    }

    fn outline_label(&self, label: &'static str) -> impl IntoElement {
        div()
            .text_size(px(9.0))
            .font_weight(FontWeight::BOLD)
            .text_color(rgb(MUTED))
            .child(label)
    }
}
