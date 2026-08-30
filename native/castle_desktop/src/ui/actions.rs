use gpui::{App, KeyBinding, actions};

actions!(castle, [FocusSearch, ToggleEdit, SaveNote, Cancel]);

pub(crate) fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-f", FocusSearch, None),
        KeyBinding::new("cmd-e", ToggleEdit, None),
        KeyBinding::new("cmd-s", SaveNote, None),
        KeyBinding::new("escape", Cancel, None),
    ]);
}
