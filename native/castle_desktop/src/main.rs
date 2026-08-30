mod route;
mod theme;
mod ui;

use std::{env, path::PathBuf};

use castle_desktop::parse_startup_options;
use castle_runtime::{LibrarySession, configured_session_options};
use gpui::{
    App, AppContext, Application, Bounds, SharedString, TitlebarOptions, WindowBounds,
    WindowOptions, px, size,
};
use ui::CastleApp;

fn main() {
    let repository_root = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let runtime = parse_startup_options(env::args().skip(1))
        .and_then(|startup| {
            let cache_root = startup
                .cache
                .unwrap_or_else(|| repository_root.join("native/target/castle-desktop-cache"));
            configured_session_options(&repository_root, startup.library.as_deref(), cache_root)
        })
        .map(LibrarySession::spawn)
        .map_err(|error| SharedString::from(format!("{error:#}")));

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
                |_, cx| cx.new(|cx| CastleApp::new(runtime, cx)),
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
