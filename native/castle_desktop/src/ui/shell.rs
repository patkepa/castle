use gpui::{Context, Render, Window, div, prelude::*, rgb};

use super::CastleApp;
use crate::theme::{CANVAS, TEXT};

impl Render for CastleApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .key_context("Castle")
            .track_focus(&self.shell_focus)
            .on_action(cx.listener(Self::focus_search))
            .on_action(cx.listener(Self::find_next_action))
            .on_action(cx.listener(Self::find_previous_action))
            .on_action(cx.listener(Self::library_up))
            .on_action(cx.listener(Self::library_down))
            .on_action(cx.listener(Self::library_left))
            .on_action(cx.listener(Self::library_right))
            .on_action(cx.listener(Self::open_selected))
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
