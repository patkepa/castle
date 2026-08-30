use gpui::{Context, Render, Window, div, prelude::*, rgb};

use super::CastleApp;
use crate::theme::{CANVAS, TEXT};

impl Render for CastleApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .key_context("Castle")
            .on_action(cx.listener(Self::focus_search))
            .on_action(cx.listener(Self::toggle_edit))
            .on_action(cx.listener(Self::save_note))
            .on_action(cx.listener(Self::cancel))
            .size_full()
            .flex()
            .overflow_hidden()
            .bg(rgb(CANVAS))
            .font_family("-apple-system")
            .text_color(rgb(TEXT))
            .child(self.render_sidebar(cx))
            .child(self.render_main(cx))
    }
}
