mod actions;
mod editor;
mod library;
mod markdown;
mod notes;
mod shell;
mod text_input;

use std::{
    path::PathBuf,
    sync::{Arc, Mutex, mpsc::Receiver},
};

use castle_desktop::SessionLauncher;
use castle_runtime::{
    AppSnapshot, CatalogNote, LibraryClient, LibraryFolder, LibrarySession, RecentLibrary,
    RuntimeEvent, SectionSummary,
};
use gpui::{
    AnyElement, Context, Entity, Focusable, FontWeight, IntoElement, PathPromptOptions,
    SharedString, Window, div, prelude::*, px, rgb,
};

use crate::{library_state::LibraryState, route::Route, theme::*};
use actions::FocusSearch;
use library::*;
use text_input::{TextInput, TextInputKind};

pub(crate) fn bind_keys(cx: &mut gpui::App) {
    actions::bind_keys(cx);
    text_input::bind_keys(cx);
}

pub struct CastleApp {
    launcher: SessionLauncher,
    session: Option<LibrarySession>,
    client: Option<LibraryClient>,
    library_state: LibraryState,
    recent_libraries: Vec<RecentLibrary>,
    library_notice: Option<String>,
    library_chooser_visible: bool,
    chooser_open: bool,
    switching_library: bool,
    route: Route,
    view_mode: ViewMode,
    sidebar_collapsed: bool,
    search_input: Entity<TextInput>,
    editor: Option<editor::NoteEditor>,
    allow_close: bool,
}

impl CastleApp {
    pub fn new(
        launcher: SessionLauncher,
        recent_libraries: anyhow::Result<Vec<RecentLibrary>>,
        runtime: Result<(LibrarySession, Receiver<RuntimeEvent>), SharedString>,
        cx: &mut Context<Self>,
    ) -> Self {
        let (session, events, library_error) = match runtime {
            Ok((session, events)) => (Some(session), Some(events), None),
            Err(reason) => (None, None, Some(reason.to_string())),
        };
        let active_epoch = session.as_ref().map(LibrarySession::epoch);
        let (recent_libraries, library_notice) = match recent_libraries {
            Ok(libraries) => (libraries, None),
            Err(reason) => (Vec::new(), Some(format!("{reason:#}"))),
        };
        if let Some(events) = events {
            Self::subscribe_to_runtime(events, cx);
        }
        let client = session.as_ref().map(LibrarySession::client);
        let search_input =
            cx.new(|cx| TextInput::new(cx, TextInputKind::Search, "Filter collections"));
        cx.observe(&search_input, |_, _, cx| cx.notify()).detach();

        Self {
            launcher,
            session,
            client,
            library_state: LibraryState::new(active_epoch, library_error),
            recent_libraries,
            library_notice,
            library_chooser_visible: false,
            chooser_open: false,
            switching_library: false,
            route: Route::Library {
                section: None,
                directory: Vec::new(),
            },
            view_mode: ViewMode::Grid,
            sidebar_collapsed: false,
            search_input,
            editor: None,
            allow_close: false,
        }
    }

    fn apply_runtime_event(&mut self, event: RuntimeEvent, cx: &mut Context<Self>) {
        let opened_library = match &event {
            RuntimeEvent::LibraryReady { snapshot, .. } => Some(snapshot.library_root().to_owned()),
            _ => None,
        };
        if self.library_state.apply(event) {
            if let Some(library_root) = opened_library {
                self.remember_library(library_root, cx);
            }
            cx.notify();
        }
    }

    fn remember_library(&self, library_root: PathBuf, cx: &mut Context<Self>) {
        let launcher = self.launcher.clone();
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let recents = background
                .spawn(async move { launcher.remember_library(&library_root) })
                .await;
            let _ = this.update(&mut *cx, |this, cx| {
                match recents {
                    Ok(recents) => {
                        this.recent_libraries = recents;
                        this.library_notice = None;
                    }
                    Err(reason) => this.library_notice = Some(format!("{reason:#}")),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn show_library_chooser(&mut self, cx: &mut Context<Self>) {
        if self.switching_library {
            return;
        }
        self.library_chooser_visible = true;
        cx.notify();
    }

    fn hide_library_chooser(&mut self, cx: &mut Context<Self>) {
        self.library_chooser_visible = false;
        cx.notify();
    }

    fn subscribe_to_runtime(events: Receiver<RuntimeEvent>, cx: &mut Context<Self>) {
        let events = Arc::new(Mutex::new(events));
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            loop {
                let events = Arc::clone(&events);
                let received = background
                    .spawn(async move {
                        events
                            .lock()
                            .expect("Castle runtime event receiver lock was poisoned")
                            .recv()
                    })
                    .await;
                let Ok(event) = received else {
                    break;
                };
                if this
                    .update(&mut *cx, |this, cx| this.apply_runtime_event(event, cx))
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
    }

    fn choose_library(&mut self, cx: &mut Context<Self>) {
        if self.chooser_open || self.switching_library {
            return;
        }
        self.chooser_open = true;
        let selection = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Open Library".into()),
        });
        cx.spawn(async move |this, cx| {
            let selected = selection.await;
            let _ = this.update(&mut *cx, |this, cx| {
                this.chooser_open = false;
                match selected {
                    Ok(Ok(Some(paths))) => {
                        if let Some(path) = paths.into_iter().next() {
                            this.begin_library_switch(path, cx);
                        }
                    }
                    Ok(Ok(None)) => cx.notify(),
                    Ok(Err(reason)) => {
                        this.library_notice = Some(format!(
                            "Castle could not open the library picker: {reason:#}"
                        ));
                        cx.notify();
                    }
                    Err(reason) => {
                        this.library_notice = Some(format!(
                            "Castle's library picker closed before replying: {reason}"
                        ));
                        cx.notify();
                    }
                }
            });
        })
        .detach();
        cx.notify();
    }

    fn begin_library_switch(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        if self.has_dirty_editor(cx) {
            if let Some(editor) = self.editor.as_mut() {
                editor.confirm_discard = true;
                editor.message =
                    Some("Discard or save this draft before switching libraries.".into());
            }
            cx.notify();
            return;
        }
        self.editor = None;
        self.switching_library = true;
        self.library_chooser_visible = false;
        self.library_notice = None;
        self.library_state.begin_switch(&path.to_string_lossy());
        self.route = Route::Library {
            section: None,
            directory: Vec::new(),
        };
        self.search_input.update(cx, |input, cx| input.clear(cx));

        let previous_session = self.session.take();
        self.client = None;
        let launcher = self.launcher.clone();
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let runtime = background
                .spawn(async move {
                    if let Some(session) = previous_session {
                        session.shutdown();
                    }
                    launcher.launch(Some(&path))
                })
                .await;
            let _ = this.update(&mut *cx, |this, cx| {
                this.finish_library_switch(runtime, cx);
            });
        })
        .detach();
        cx.notify();
    }

    fn finish_library_switch(
        &mut self,
        runtime: anyhow::Result<(LibrarySession, Receiver<RuntimeEvent>)>,
        cx: &mut Context<Self>,
    ) {
        self.switching_library = false;
        match runtime {
            Ok((session, events)) => {
                self.library_state.activate(session.epoch());
                self.client = Some(session.client());
                self.session = Some(session);
                Self::subscribe_to_runtime(events, cx);
            }
            Err(reason) => self.library_state.fail_switch(format!("{reason:#}")),
        }
        cx.notify();
    }

    fn navigate(&mut self, route: Route, cx: &mut Context<Self>) {
        if self.has_dirty_editor(cx) {
            if let Some(editor) = self.editor.as_mut() {
                editor.confirm_discard = true;
                editor.message = Some("Save or discard this draft before leaving the note.".into());
            }
            cx.notify();
            return;
        }
        self.editor = None;
        self.route = route;
        self.search_input.update(cx, |input, cx| input.clear(cx));
        cx.notify();
    }

    fn focus_search(&mut self, _: &FocusSearch, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.search_input.focus_handle(cx));
    }

    fn render_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let width = if self.sidebar_collapsed { 60.0 } else { 260.0 };
        let mut sidebar = div()
            .w(px(width))
            .h_full()
            .flex_none()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(rgb(NAV))
            .border_r_1()
            .border_color(rgb(LINE));

        sidebar = sidebar.child(
            div()
                .id("castle-brand")
                .h(px(48.0))
                .w_full()
                .flex_none()
                .flex()
                .items_center()
                .px_4()
                .gap_3()
                .cursor_pointer()
                .hover(|style| style.bg(rgb(RAISED)))
                .on_click(cx.listener(|this, _, _, cx| {
                    this.sidebar_collapsed = !this.sidebar_collapsed;
                    cx.notify();
                }))
                .child(
                    div()
                        .size_7()
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded_sm()
                        .bg(rgb(ACCENT))
                        .text_sm()
                        .font_weight(FontWeight::BOLD)
                        .text_color(rgb(TEXT))
                        .child("TC"),
                )
                .when(!self.sidebar_collapsed, |brand| {
                    brand.child(
                        div()
                            .text_base()
                            .font_weight(FontWeight::BOLD)
                            .text_color(rgb(TEXT))
                            .child("The Castle"),
                    )
                }),
        );

        let mut navigation = div()
            .id("castle-navigation")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .py_2();

        navigation = navigation.child(self.sidebar_group_label("The Castle"));
        navigation = navigation
            .child(self.sidebar_item("home", "⌂", "Home", Route::Placeholder("Home"), cx))
            .child(self.sidebar_item(
                "library",
                "◇",
                "Library",
                Route::Library {
                    section: None,
                    directory: Vec::new(),
                },
                cx,
            ))
            .child(self.sidebar_item("people", "⌘", "People", Route::Placeholder("People"), cx));

        navigation = navigation.child(self.sidebar_group_label("Workspace"));
        for (id, glyph, label) in [
            ("tasks", "✓", "Tasks"),
            ("calendar", "□", "Calendar"),
            ("canvas", "⊞", "Canvas"),
            ("stash", "↓", "Stash"),
        ] {
            navigation = navigation.child(self.sidebar_item(
                id,
                glyph,
                label,
                Route::Placeholder(label),
                cx,
            ));
        }

        if !self.sidebar_collapsed
            && let Some(library) = self.library_state.snapshot()
        {
            navigation = navigation.child(self.sidebar_group_label("Recent"));
            for note_index in recent_note_indexes(library) {
                let note = &library.notes[note_index];
                let note_id = note.id.clone();
                navigation = navigation.child(
                    div()
                        .id(SharedString::from(format!("recent-{}", note.id)))
                        .mx_2()
                        .h(px(32.0))
                        .flex()
                        .items_center()
                        .gap_2()
                        .px_3()
                        .border_l_2()
                        .border_color(rgb(if self.route == Route::Note(note.id.clone()) {
                            ACCENT
                        } else {
                            NAV
                        }))
                        .cursor_pointer()
                        .text_xs()
                        .text_color(rgb(TEXT_SECONDARY))
                        .hover(|style| style.bg(rgb(HOVER)).text_color(rgb(TEXT)))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.navigate(Route::Note(note_id.clone()), cx);
                        }))
                        .child(div().text_color(rgb(MUTED)).child("·"))
                        .child(div().truncate().child(note.title.clone())),
                );
            }
        }

        sidebar.child(navigation).child(
            div()
                .id("switch-library")
                .h(px(42.0))
                .flex_none()
                .flex()
                .items_center()
                .px_5()
                .border_t_1()
                .border_color(rgb(LINE_SOFT))
                .text_xs()
                .text_color(rgb(MUTED))
                .cursor_pointer()
                .hover(|style| style.bg(rgb(HOVER)).text_color(rgb(TEXT)))
                .on_click(cx.listener(|this, _, _, cx| this.show_library_chooser(cx)))
                .child(if self.sidebar_collapsed {
                    "⇄".to_owned()
                } else if self.switching_library {
                    "OPENING LIBRARY…".to_owned()
                } else if self.chooser_open {
                    "CHOOSING LIBRARY…".to_owned()
                } else if self.library_chooser_visible {
                    "LIBRARY CHOOSER".to_owned()
                } else {
                    "⇄  SWITCH LIBRARY".to_owned()
                }),
        )
    }

    fn sidebar_group_label(&self, label: &str) -> impl IntoElement {
        div()
            .h(px(28.0))
            .flex()
            .items_end()
            .px_5()
            .pb_1()
            .text_size(px(10.0))
            .font_weight(FontWeight::BOLD)
            .text_color(rgb(MUTED))
            .when(self.sidebar_collapsed, |item| item.opacity(0.0))
            .child(label.to_uppercase())
    }

    fn sidebar_item(
        &self,
        id: &'static str,
        glyph: &'static str,
        label: &'static str,
        destination: Route,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let active = self.route.nav_key() == id;
        div()
            .id(SharedString::from(format!("nav-{id}")))
            .mx_2()
            .h(px(36.0))
            .flex()
            .items_center()
            .gap_3()
            .px_3()
            .border_l_2()
            .border_color(rgb(if active { ACCENT } else { NAV }))
            .bg(rgb(if active { ACTIVE } else { NAV }))
            .cursor_pointer()
            .text_sm()
            .font_weight(if active {
                FontWeight::SEMIBOLD
            } else {
                FontWeight::NORMAL
            })
            .text_color(rgb(if active { TEXT } else { TEXT_SECONDARY }))
            .hover(|style| style.bg(rgb(HOVER)).text_color(rgb(TEXT)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.navigate(destination.clone(), cx);
            }))
            .child(
                div()
                    .w(px(18.0))
                    .flex_none()
                    .text_center()
                    .text_base()
                    .text_color(rgb(if active { ACCENT_HOVER } else { MUTED }))
                    .child(glyph),
            )
            .when(!self.sidebar_collapsed, |item| {
                item.child(div().truncate().child(label))
            })
    }

    fn render_main(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .min_w_0()
            .h_full()
            .flex_1()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(rgb(CANVAS))
            .child(self.render_navbar(cx))
            .when(self.route.is_library(), |main| {
                main.child(self.render_library_toolbar(cx))
            })
            .when(self.route.is_note(), |main| {
                main.child(self.render_note_toolbar(cx))
            })
            .child(self.render_content(cx))
    }

    fn render_navbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .h(px(48.0))
            .w_full()
            .flex_none()
            .flex()
            .items_center()
            .px_4()
            .gap_3()
            .border_b_1()
            .border_color(rgb(LINE))
            .bg(rgb(NAV))
            .child(
                div()
                    .id("toggle-sidebar")
                    .size_7()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_sm()
                    .cursor_pointer()
                    .text_color(rgb(MUTED))
                    .hover(|style| style.bg(rgb(RAISED)).text_color(rgb(TEXT)))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.sidebar_collapsed = !this.sidebar_collapsed;
                        cx.notify();
                    }))
                    .child("☰"),
            )
            .child(self.render_breadcrumb(cx))
            .child(div().flex_1())
            .child(self.chrome_button("⌕", "Search"))
            .child(self.chrome_button("✦", "Castle AI"))
            .child(self.chrome_button("•••", "View settings"))
    }

    fn chrome_button(&self, glyph: &'static str, label: &'static str) -> impl IntoElement {
        div()
            .id(SharedString::from(format!("chrome-{label}")))
            .size_7()
            .flex()
            .items_center()
            .justify_center()
            .rounded_sm()
            .cursor_pointer()
            .text_xs()
            .text_color(rgb(MUTED))
            .hover(|style| style.bg(rgb(RAISED)).text_color(rgb(TEXT)))
            .child(glyph)
    }

    fn render_breadcrumb(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let mut breadcrumb = div()
            .min_w_0()
            .flex()
            .items_center()
            .gap_2()
            .text_sm()
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(rgb(TEXT));

        match &self.route {
            Route::Library { section, directory } => {
                if section.is_some() {
                    breadcrumb = breadcrumb.child(self.breadcrumb_link(
                        "Library",
                        Route::Library {
                            section: None,
                            directory: Vec::new(),
                        },
                        cx,
                    ));
                } else {
                    breadcrumb = breadcrumb.child("Library");
                }
                if let Some(section_id) = section {
                    let section_label = self
                        .library_state
                        .snapshot()
                        .and_then(|library| library.section(section_id))
                        .map(|section| section.label.clone())
                        .unwrap_or_else(|| title_case(section_id));
                    breadcrumb = breadcrumb.child(self.breadcrumb_separator());
                    if directory.is_empty() {
                        breadcrumb = breadcrumb.child(section_label);
                    } else {
                        breadcrumb = breadcrumb.child(self.breadcrumb_link(
                            section_label,
                            Route::Library {
                                section: Some(section_id.clone()),
                                directory: Vec::new(),
                            },
                            cx,
                        ));
                    }
                    for (index, part) in directory.iter().enumerate() {
                        breadcrumb = breadcrumb.child(self.breadcrumb_separator());
                        if index + 1 == directory.len() {
                            breadcrumb = breadcrumb.child(title_case(part));
                        } else {
                            breadcrumb = breadcrumb.child(self.breadcrumb_link(
                                title_case(part),
                                Route::Library {
                                    section: Some(section_id.clone()),
                                    directory: directory[..=index].to_vec(),
                                },
                                cx,
                            ));
                        }
                    }
                }
            }
            Route::Note(note_id) => {
                if let Some(library) = self.library_state.snapshot()
                    && let Some(note) = library.note_by_id(note_id)
                {
                    breadcrumb = breadcrumb
                        .child(self.breadcrumb_link(
                            "Library",
                            Route::Library {
                                section: None,
                                directory: Vec::new(),
                            },
                            cx,
                        ))
                        .child(self.breadcrumb_separator())
                        .child(self.breadcrumb_link(
                            note.section_label.clone(),
                            Route::Library {
                                section: Some(note.section.clone()),
                                directory: note_directory(note),
                            },
                            cx,
                        ))
                        .child(self.breadcrumb_separator())
                        .child(div().truncate().child(note.title.clone()));
                }
            }
            Route::Placeholder(label) => {
                breadcrumb = breadcrumb.child(*label);
            }
        }
        breadcrumb
    }

    fn breadcrumb_link(
        &self,
        label: impl Into<SharedString>,
        route: Route,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        div()
            .id(SharedString::from(format!("breadcrumb-{route:?}")))
            .cursor_pointer()
            .text_color(rgb(MUTED))
            .hover(|style| style.text_color(rgb(TEXT)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.navigate(route.clone(), cx);
            }))
            .child(label.into())
    }

    fn breadcrumb_separator(&self) -> impl IntoElement {
        div().text_color(rgb(LINE)).child("/")
    }

    fn render_library_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let (section, directory) = match &self.route {
            Route::Library { section, directory } => (section.as_deref(), directory.as_slice()),
            _ => (None, &[] as &[String]),
        };
        let title = section
            .and_then(|id| self.library_state.snapshot()?.section(id))
            .map(|section| section.label.clone())
            .unwrap_or_else(|| "All collections".into());
        let eyebrow = if directory.is_empty() {
            "Index"
        } else {
            "Folder"
        };

        div()
            .h(px(44.0))
            .w_full()
            .flex_none()
            .flex()
            .items_center()
            .gap_3()
            .px_3()
            .border_b_1()
            .border_color(rgb(LINE))
            .bg(rgb(NAV))
            .when(section.is_some(), |toolbar| {
                toolbar.child(
                    div()
                        .id("library-back")
                        .size_7()
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .text_color(rgb(MUTED))
                        .hover(|style| style.bg(rgb(RAISED)).text_color(rgb(TEXT)))
                        .on_click(cx.listener(|this, _, _, cx| {
                            let next = match &this.route {
                                Route::Library { section, directory } if !directory.is_empty() => {
                                    Route::Library {
                                        section: section.clone(),
                                        directory: directory[..directory.len() - 1].to_vec(),
                                    }
                                }
                                _ => Route::Library {
                                    section: None,
                                    directory: Vec::new(),
                                },
                            };
                            this.navigate(next, cx);
                        }))
                        .child("←"),
                )
            })
            .child(
                div()
                    .min_w(px(132.0))
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .text_size(px(8.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(rgb(ACCENT_HOVER))
                            .child(eyebrow.to_uppercase()),
                    )
                    .child(
                        div()
                            .mt_0p5()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(rgb(TEXT))
                            .child(title),
                    ),
            )
            .child(div().flex_1())
            .child(self.search_input.clone())
            .child(
                div()
                    .h(px(28.0))
                    .flex()
                    .border_1()
                    .border_color(rgb(LINE))
                    .child(self.view_toggle("list-view", "☷", ViewMode::List, cx))
                    .child(self.view_toggle("grid-view", "⊞", ViewMode::Grid, cx)),
            )
    }

    fn view_toggle(
        &self,
        id: &'static str,
        glyph: &'static str,
        mode: ViewMode,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let selected = self.view_mode == mode;
        div()
            .id(id)
            .w(px(30.0))
            .h_full()
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .bg(rgb(if selected { ACTIVE } else { NAV }))
            .text_color(rgb(if selected { ACCENT_HOVER } else { MUTED }))
            .hover(|style| style.bg(rgb(HOVER)).text_color(rgb(TEXT)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.view_mode = mode;
                cx.notify();
            }))
            .child(glyph)
    }

    fn render_note_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let editing = self.editor.is_some();
        let dirty = self.has_dirty_editor(cx);
        div()
            .h(px(44.0))
            .w_full()
            .flex_none()
            .flex()
            .items_center()
            .gap_2()
            .px_3()
            .border_b_1()
            .border_color(rgb(LINE))
            .bg(rgb(NAV))
            .child(
                div()
                    .id("note-back")
                    .size_7()
                    .flex()
                    .items_center()
                    .justify_center()
                    .cursor_pointer()
                    .text_color(rgb(MUTED))
                    .hover(|style| style.bg(rgb(RAISED)).text_color(rgb(TEXT)))
                    .on_click(cx.listener(|this, _, _, cx| {
                        let destination = match &this.route {
                            Route::Note(note_id) => this
                                .library_state
                                .snapshot()
                                .and_then(|library| library.note_by_id(note_id))
                                .map(|note| Route::Library {
                                    section: Some(note.section.clone()),
                                    directory: note_directory(note),
                                })
                                .unwrap_or(Route::Library {
                                    section: None,
                                    directory: Vec::new(),
                                }),
                            _ => Route::Library {
                                section: None,
                                directory: Vec::new(),
                            },
                        };
                        this.navigate(destination, cx);
                    }))
                    .child("←"),
            )
            .child(
                self.toolbar_pill("READ", !editing)
                    .id("note-read-mode")
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| this.request_close_editor(cx))),
            )
            .child(
                self.toolbar_pill("SOURCE", editing)
                    .id("note-source-mode")
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, window, cx| this.start_editing(window, cx))),
            )
            .child(div().flex_1())
            .when(editing, |toolbar| {
                toolbar.child(
                    div()
                        .id("save-note")
                        .h(px(26.0))
                        .flex()
                        .items_center()
                        .px_3()
                        .border_1()
                        .border_color(rgb(LINE))
                        .cursor_pointer()
                        .text_size(px(9.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(rgb(if dirty { TEXT } else { MUTED }))
                        .hover(|style| style.bg(rgb(HOVER)))
                        .on_click(cx.listener(|this, _, _, cx| this.save_editor(cx)))
                        .child(if dirty { "SAVE" } else { "SAVED" }),
                )
            })
            .child(self.chrome_button("☆", "Pin note"))
            .child(
                div()
                    .id("edit-note")
                    .size_7()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_sm()
                    .cursor_pointer()
                    .text_xs()
                    .text_color(rgb(MUTED))
                    .hover(|style| style.bg(rgb(RAISED)).text_color(rgb(TEXT)))
                    .on_click(cx.listener(|this, _, window, cx| this.start_editing(window, cx)))
                    .child("✎"),
            )
            .child(self.chrome_button("ⓘ", "Note details"))
    }

    fn toolbar_pill(&self, label: &'static str, selected: bool) -> gpui::Div {
        div()
            .h(px(26.0))
            .flex()
            .items_center()
            .px_3()
            .border_b_2()
            .border_color(rgb(if selected { ACCENT } else { NAV }))
            .text_size(px(9.0))
            .font_weight(FontWeight::BOLD)
            .text_color(rgb(if selected { TEXT } else { MUTED }))
            .child(label)
    }

    fn render_library_chooser(&self, message: Option<&str>, cx: &mut Context<Self>) -> AnyElement {
        let has_open_library = self.library_state.snapshot().is_some();
        let message = message.map(str::to_owned).unwrap_or_else(|| {
            "Open a recent Markdown library or choose a folder on this Mac.".into()
        });
        let mut recent_list = div()
            .mt_6()
            .flex()
            .flex_col()
            .border_t_1()
            .border_color(rgb(LINE));
        for (index, library) in self.recent_libraries.iter().enumerate() {
            let path = library.path.clone();
            let available = library.available;
            let mut row = div()
                .id(SharedString::from(format!("recent-library-{index}")))
                .min_h(px(62.0))
                .flex()
                .items_center()
                .gap_4()
                .px_4()
                .border_b_1()
                .border_color(rgb(LINE))
                .text_color(rgb(TEXT))
                .child(
                    div()
                        .size_8()
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .border_1()
                        .border_color(rgb(LINE))
                        .text_color(rgb(if available { ACCENT_HOVER } else { MUTED }))
                        .child("◇"),
                )
                .child(
                    div()
                        .min_w_0()
                        .flex_1()
                        .child(
                            div()
                                .truncate()
                                .text_sm()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(library.name.clone()),
                        )
                        .child(
                            div()
                                .mt_1()
                                .truncate()
                                .text_size(px(10.0))
                                .text_color(rgb(MUTED))
                                .child(library.path.display().to_string()),
                        ),
                )
                .child(
                    div()
                        .text_size(px(9.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(rgb(if available { MUTED } else { DANGER }))
                        .child(if available { "OPEN" } else { "MISSING" }),
                );
            if available {
                row = row
                    .cursor_pointer()
                    .hover(|style| style.bg(rgb(HOVER)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.begin_library_switch(path.clone(), cx);
                    }));
            }
            recent_list = recent_list.child(row);
        }

        let mut actions = div().mt_6().flex().items_center().gap_3().child(
            div()
                .id("browse-library")
                .h(px(36.0))
                .flex()
                .items_center()
                .px_5()
                .bg(rgb(ACCENT))
                .cursor_pointer()
                .text_sm()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(TEXT))
                .hover(|style| style.bg(rgb(ACCENT_HOVER)))
                .on_click(cx.listener(|this, _, _, cx| this.choose_library(cx)))
                .child("Browse for a library"),
        );
        if has_open_library {
            actions = actions.child(
                div()
                    .id("cancel-library-chooser")
                    .h(px(36.0))
                    .flex()
                    .items_center()
                    .px_5()
                    .border_1()
                    .border_color(rgb(LINE))
                    .cursor_pointer()
                    .text_sm()
                    .text_color(rgb(TEXT_SECONDARY))
                    .hover(|style| style.bg(rgb(HOVER)).text_color(rgb(TEXT)))
                    .on_click(cx.listener(|this, _, _, cx| this.hide_library_chooser(cx)))
                    .child("Cancel"),
            );
        }

        div()
            .id("library-chooser-page")
            .h_full()
            .min_w_0()
            .flex_1()
            .overflow_y_scroll()
            .bg(rgb(CANVAS))
            .text_color(rgb(TEXT))
            .child(
                div()
                    .max_w(px(680.0))
                    .mx_auto()
                    .px_10()
                    .py_12()
                    .child(
                        div()
                            .text_size(px(9.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(rgb(ACCENT_HOVER))
                            .child("CASTLE LIBRARIES"),
                    )
                    .child(
                        div()
                            .mt_3()
                            .text_size(px(42.0))
                            .line_height(px(46.0))
                            .font_weight(FontWeight::BOLD)
                            .child(if has_open_library {
                                "Open another library"
                            } else {
                                "Choose your library"
                            }),
                    )
                    .child(
                        div()
                            .mt_3()
                            .text_sm()
                            .line_height(px(22.0))
                            .text_color(rgb(MUTED))
                            .child(message),
                    )
                    .when(!self.recent_libraries.is_empty(), |chooser| {
                        chooser.child(recent_list)
                    })
                    .child(actions),
            )
            .into_any_element()
    }

    fn render_content(&self, cx: &mut Context<Self>) -> AnyElement {
        if self.library_chooser_visible || self.library_state.error().is_some() {
            return self.render_library_chooser(
                self.library_state
                    .error()
                    .or(self.library_notice.as_deref()),
                cx,
            );
        }
        let Some(library) = self.library_state.snapshot() else {
            return div()
                .h_full()
                .flex_1()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap_3()
                .bg(rgb(CANVAS))
                .text_color(rgb(TEXT))
                .child(div().text_2xl().child("Opening the Castle…"))
                .child(
                    div()
                        .text_sm()
                        .text_color(rgb(MUTED))
                        .child(self.library_state.status().to_owned()),
                )
                .into_any_element();
        };
        match &self.route {
            Route::Library { section, directory } => self
                .render_library(library, section.as_deref(), directory, cx)
                .into_any_element(),
            Route::Note(note_id) => self.render_note(library, note_id, cx),
            Route::Placeholder(label) => self.render_placeholder(label).into_any_element(),
        }
    }

    fn render_library(
        &self,
        library: &AppSnapshot,
        section_id: Option<&str>,
        directory: &[String],
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let mut page = div()
            .id("library-page")
            .min_h_0()
            .flex_1()
            .overflow_y_scroll()
            .bg(rgb(CANVAS))
            .p_8()
            .pb_16();
        let query = self.search_input.read(cx).text().trim().to_lowercase();

        if let Some(section_id) = section_id {
            let section = library.section(section_id);
            let current_label = directory
                .last()
                .map(|value| title_case(value))
                .or_else(|| section.map(|section| section.label.clone()))
                .unwrap_or_else(|| title_case(section_id));
            let folders = library
                .folders_in_directory(section_id, directory)
                .into_iter()
                .filter(|index| {
                    query.is_empty()
                        || library.folders[*index]
                            .directory
                            .last()
                            .is_some_and(|name| title_case(name).to_lowercase().contains(&query))
                })
                .collect::<Vec<_>>();
            let notes = library
                .notes_in_directory(section_id, directory)
                .into_iter()
                .filter(|index| {
                    query.is_empty() || note_search_text(&library.notes[*index]).contains(&query)
                })
                .collect::<Vec<_>>();
            page = page.child(self.library_heading(
                &current_label,
                &format!(
                    "{} {} and {} {}",
                    folders.len(),
                    plural(folders.len(), "folder", "folders"),
                    notes.len(),
                    plural(notes.len(), "note", "notes")
                ),
            ));
            if folders.is_empty() && notes.is_empty() {
                page = page.child(self.empty_library());
            } else {
                page = page.child(self.render_entries(library, section_id, &folders, &notes, cx));
            }
        } else {
            let sections = library
                .sections
                .iter()
                .filter(|section| {
                    query.is_empty()
                        || format!("{} {}", section.label, section.id)
                            .to_lowercase()
                            .contains(&query)
                })
                .cloned()
                .collect::<Vec<_>>();
            page = if sections.is_empty() {
                page.child(self.empty_search())
            } else {
                page.child(self.render_sections(&sections, cx))
            };
        }
        page
    }

    fn library_heading(&self, label: &str, summary: &str) -> impl IntoElement {
        div()
            .flex()
            .items_end()
            .justify_between()
            .gap_8()
            .pt_3()
            .pb_7()
            .border_b_1()
            .border_color(rgb(LINE))
            .child(
                div()
                    .child(
                        div()
                            .text_size(px(46.0))
                            .line_height(px(46.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(rgb(TEXT))
                            .child(label.to_owned()),
                    )
                    .child(
                        div()
                            .mt_2()
                            .text_xs()
                            .text_color(rgb(MUTED))
                            .child(summary.to_owned()),
                    ),
            )
    }

    fn render_sections(
        &self,
        sections: &[SectionSummary],
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let mut container = match self.view_mode {
            ViewMode::Grid => div().grid().grid_cols(3),
            ViewMode::List => div().flex().flex_col(),
        }
        .border_t_1()
        .border_l_1()
        .border_color(rgb(LINE));

        for section in sections {
            container = container.child(self.section_tile(section, cx));
        }
        container
    }

    fn section_tile(&self, section: &SectionSummary, cx: &mut Context<Self>) -> impl IntoElement {
        let id = section.id.clone();
        let grid = self.view_mode == ViewMode::Grid;
        div()
            .id(SharedString::from(format!("section-tile-{}", section.id)))
            .min_h(px(if grid { 136.0 } else { 56.0 }))
            .flex()
            .when(grid, |tile| tile.flex_col().items_start().justify_between())
            .when(!grid, |tile| tile.items_center().gap_3())
            .p_4()
            .border_r_1()
            .border_b_1()
            .border_color(rgb(LINE))
            .cursor_pointer()
            .text_color(rgb(TEXT))
            .hover(|style| style.bg(rgb(HOVER)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.navigate(
                    Route::Library {
                        section: Some(id.clone()),
                        directory: Vec::new(),
                    },
                    cx,
                );
            }))
            .child(self.library_icon(section_glyph(&section.icon), false))
            .child(
                div()
                    .min_w_0()
                    .when(grid, |content| content.mt_4().w_full())
                    .child(
                        div()
                            .truncate()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(section.label.clone()),
                    )
                    .child(
                        div()
                            .mt_1()
                            .text_size(px(10.0))
                            .text_color(rgb(MUTED))
                            .child(format!(
                                "{} {}",
                                section.count,
                                plural(section.count, "note", "notes")
                            )),
                    ),
            )
            .child(div().ml_auto().text_color(rgb(MUTED)).child("›"))
    }

    fn render_entries(
        &self,
        library: &AppSnapshot,
        section_id: &str,
        folders: &[usize],
        notes: &[usize],
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let mut container = match self.view_mode {
            ViewMode::Grid => div().grid().grid_cols(3),
            ViewMode::List => div().flex().flex_col(),
        }
        .mt_6()
        .border_t_1()
        .border_l_1()
        .border_color(rgb(LINE));

        for folder_index in folders {
            container =
                container.child(self.folder_tile(section_id, &library.folders[*folder_index], cx));
        }
        for note_index in notes {
            container = container.child(self.note_tile(&library.notes[*note_index], cx));
        }
        container
    }

    fn folder_tile(
        &self,
        section_id: &str,
        folder: &LibraryFolder,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let destination = Route::Library {
            section: Some(section_id.to_owned()),
            directory: folder.directory.clone(),
        };
        let name = folder
            .directory
            .last()
            .map(|name| title_case(name))
            .unwrap_or_else(|| "Folder".into());
        let detail = format!(
            "{} {}{}",
            folder.note_count,
            plural(folder.note_count, "note", "notes"),
            if folder.note_count == 0 && folder.entry_count > 0 {
                format!(" · {} items", folder.entry_count)
            } else {
                String::new()
            }
        );
        self.entry_tile(
            SharedString::from(format!(
                "folder-{}-{}",
                section_id,
                folder.directory.join("-")
            )),
            "◇",
            name,
            detail,
            false,
            move |this, cx| this.navigate(destination.clone(), cx),
            cx,
        )
    }

    fn note_tile(&self, note: &CatalogNote, cx: &mut Context<Self>) -> impl IntoElement {
        let note_id = note.id.clone();
        self.entry_tile(
            SharedString::from(format!("note-tile-{}", note.id)),
            "▧",
            note.title.clone(),
            if note.tags.is_empty() {
                format!("{} words", note.word_count)
            } else {
                note.tags.join(" · ")
            },
            true,
            move |this, cx| this.navigate(Route::Note(note_id.clone()), cx),
            cx,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn entry_tile(
        &self,
        id: SharedString,
        glyph: &'static str,
        title: String,
        detail: String,
        note: bool,
        on_open: impl Fn(&mut Self, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let grid = self.view_mode == ViewMode::Grid;
        div()
            .id(id)
            .min_h(px(if grid { 136.0 } else { 56.0 }))
            .flex()
            .when(grid, |tile| tile.flex_col().items_start())
            .when(!grid, |tile| tile.items_center().gap_3())
            .p_4()
            .border_r_1()
            .border_b_1()
            .border_color(rgb(LINE))
            .cursor_pointer()
            .hover(|style| style.bg(rgb(HOVER)))
            .on_click(cx.listener(move |this, _, _, cx| on_open(this, cx)))
            .child(self.library_icon(glyph, note))
            .child(
                div()
                    .min_w_0()
                    .when(grid, |content| content.mt_4().w_full())
                    .child(
                        div()
                            .truncate()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(rgb(TEXT))
                            .child(title),
                    )
                    .child(
                        div()
                            .mt_2()
                            .truncate()
                            .text_size(px(10.0))
                            .text_color(rgb(MUTED))
                            .child(detail),
                    ),
            )
            .child(
                div()
                    .ml_auto()
                    .when(grid, |arrow| arrow.mt_auto())
                    .text_color(rgb(MUTED))
                    .child("›"),
            )
    }

    fn library_icon(&self, glyph: &'static str, note: bool) -> impl IntoElement {
        div()
            .size_9()
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .border_1()
            .border_color(rgb(if note { LINE } else { 0x28466b }))
            .bg(rgb(if note { RAISED } else { 0x0d1928 }))
            .text_base()
            .text_color(rgb(if note { TEXT_SECONDARY } else { ACCENT_HOVER }))
            .child(glyph)
    }

    fn empty_library(&self) -> impl IntoElement {
        div()
            .mt_6()
            .h(px(280.0))
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap_3()
            .border_1()
            .border_color(rgb(LINE))
            .text_color(rgb(MUTED))
            .child(div().text_2xl().text_color(rgb(ACCENT_HOVER)).child("◇"))
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(rgb(TEXT))
                    .child("This folder is empty"),
            )
            .child(
                div()
                    .text_xs()
                    .child("Markdown files added here will appear automatically."),
            )
    }

    fn empty_search(&self) -> impl IntoElement {
        div()
            .h(px(280.0))
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap_3()
            .border_1()
            .border_color(rgb(LINE))
            .text_color(rgb(MUTED))
            .child(div().text_2xl().text_color(rgb(ACCENT_HOVER)).child("⌕"))
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(rgb(TEXT))
                    .child("No matching items"),
            )
            .child(
                div()
                    .text_xs()
                    .child("Try a different collection or note name."),
            )
    }

    fn render_placeholder(&self, label: &'static str) -> impl IntoElement {
        div()
            .min_h_0()
            .flex_1()
            .flex()
            .items_center()
            .justify_center()
            .bg(rgb(CANVAS))
            .child(
                div()
                    .w(px(420.0))
                    .p_8()
                    .border_1()
                    .border_color(rgb(LINE))
                    .bg(rgb(PANEL))
                    .child(
                        div()
                            .text_size(px(9.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(rgb(ACCENT_HOVER))
                            .child("PORTING ROADMAP"),
                    )
                    .child(
                        div()
                            .mt_3()
                            .text_2xl()
                            .font_weight(FontWeight::BOLD)
                            .text_color(rgb(TEXT))
                            .child(label),
                    )
                    .child(
                        div()
                            .mt_3()
                            .text_sm()
                            .line_height(px(22.0))
                            .text_color(rgb(MUTED))
                            .child("The native workspace shell is in place. This feature has not been migrated yet; Library is the active vertical slice."),
                    ),
            )
    }
}
