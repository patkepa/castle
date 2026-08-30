mod library_state;
mod route;
mod theme;
mod ui;

use std::{env, path::PathBuf};

use castle_desktop::{SessionLauncher, parse_startup_options};
use gpui::{
    App, AppContext, Application, Bounds, SharedString, TitlebarOptions, WindowBounds,
    WindowOptions, px, size,
};
use ui::CastleApp;

fn main() {
    let repository_root = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let startup = parse_startup_options(env::args().skip(1));
    let cache_root = startup
        .as_ref()
        .ok()
        .and_then(|startup| startup.cache.clone())
        .unwrap_or_else(|| repository_root.join("native/target/castle-desktop-cache"));
    let launcher = SessionLauncher::new(&repository_root, cache_root);
    let runtime = startup
        .and_then(|startup| launcher.launch(startup.library.as_deref()))
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
                |_, cx| cx.new(|cx| CastleApp::new(launcher, runtime, cx)),
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
