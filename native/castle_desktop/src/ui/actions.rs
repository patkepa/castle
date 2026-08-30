use gpui::{App, KeyBinding, actions};

actions!(
    castle,
    [
        FocusSearch,
        FindNext,
        FindPrevious,
        LibraryUp,
        LibraryDown,
        LibraryLeft,
        LibraryRight,
        OpenSelected,
        ToggleEdit,
        SaveNote,
        Cancel
    ]
);

pub(crate) fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-f", FocusSearch, None),
        KeyBinding::new("cmd-g", FindNext, None),
        KeyBinding::new("shift-cmd-g", FindPrevious, None),
        KeyBinding::new("up", LibraryUp, Some("Castle")),
        KeyBinding::new("down", LibraryDown, Some("Castle")),
        KeyBinding::new("left", LibraryLeft, Some("Castle")),
        KeyBinding::new("right", LibraryRight, Some("Castle")),
        KeyBinding::new("enter", OpenSelected, Some("Castle")),
        KeyBinding::new("cmd-e", ToggleEdit, None),
        KeyBinding::new("cmd-s", SaveNote, None),
        KeyBinding::new("escape", Cancel, None),
    ]);
}
