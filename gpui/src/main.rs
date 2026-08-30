mod ui;

use std::{env, path::PathBuf};

use castle_gpui::{DemoLibrary, parse_library_override};
use gpui::{
    App, AppContext, Application, Bounds, SharedString, TitlebarOptions, WindowBounds,
    WindowOptions, px, size,
};
use ui::CastleApp;

fn main() {
    let repository_root = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let library_override = parse_library_override(env::args().skip(1))
        .map_err(|error| SharedString::from(error.to_string()));
    let library = library_override.and_then(|override_path| {
        DemoLibrary::load(&repository_root, override_path.as_deref())
            .map_err(|error| SharedString::from(format!("{error:#}")))
    });

    Application::new().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(1240.0), px(800.0)), cx);
        let window = cx
            .open_window(
                WindowOptions {
                    titlebar: Some(TitlebarOptions {
                        title: Some("The Castle".into()),
                        ..Default::default()
                    }),
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    ..Default::default()
                },
                |_, cx| cx.new(|_| CastleApp::new(library)),
            )
            .expect("failed to open Castle's GPUI window");
        let view = window
            .update(cx, |_, _, cx| cx.entity())
            .expect("failed to access Castle's root view");
        cx.observe_keystrokes(move |event, _, cx| {
            view.update(cx, |view, cx| view.handle_keystroke(&event.keystroke, cx))
        })
        .detach();
        cx.activate(true);
    });
}
