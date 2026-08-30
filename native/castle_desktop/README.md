# Castle native desktop

The production structure, runtime boundaries, phased feature plan, and Electron
cutover gates are documented in
[`docs/gpui-desktop-architecture.md`](../../docs/gpui-desktop-architecture.md).

This crate is the native Rust implementation for replacing Castle's Electron
shell and React renderer with [GPUI](https://gpui.rs/). It participates in the
native workspace but is excluded from default workspace members so ordinary
content-engine checks do not need to compile GPUI.

The current implementation proves that a GPUI window can:

- open Castle's real configuration and Markdown library on the background
  `castle-runtime` session actor;
- consume an immutable, indexed `AppSnapshot` without cloning a second UI
  domain model;
- refresh that snapshot after debounced external filesystem changes while
  rejecting events from retired session epochs;
- reproduce Castle's dark Kantzen workspace shell, collapsible navigation,
  breadcrumb chrome, recent notes, and Library toolbar;
- browse the collection index, nested folders, and notes in native list or grid
  modes, with lightweight keyboard filtering after clicking the filter field;
- open notes in a Castle-styled reading surface without a browser, Vite, React,
  Electron, or IPC;
- accept a different library with `--library /absolute/path/to/library` or
  switch at runtime through the native directory chooser in the sidebar.

Run it from the repository root:

```sh
npm run dev:gpui
# or
cargo run --manifest-path native/Cargo.toml -p castle-desktop -- --library /path/to/library
```

Validate the experiment with `npm run check:gpui`.

On macOS, GPUI compiles its own Metal shaders. If Xcode reports that the Metal
toolchain is missing, install Apple's optional component once with:

```sh
xcodebuild -downloadComponent MetalToolchain
```

The current component download is roughly 688 MB. GPUI's first clean build also
compiles a substantially larger dependency graph than Castle's existing core
crates; incremental builds are much faster.

The `cargo run` binary is intentionally still unbundled. Automated macOS UI
control that targets applications by bundle identity will become available with
the packaging milestone; runtime tests and a process-launch smoke cover this
development phase.

## Current boundary

This is an architecture foundation, not a replacement desktop release. Note
bodies are shown as source Markdown. Editing, rich Markdown, full search and
command palette behavior, canvases, sheets, calendar/tasks/projects, AI chat,
persistence, menus, shortcuts, accessibility QA, packaging, and parity tests
remain unported. Filesystem watching and native library switching are live;
the recent-library registry and launch-time chooser state remain unported.
Non-Library sidebar destinations are intentional roadmap placeholders.

## Early assessment

The architecture is viable: GPUI now calls the existing Rust content engine
through an in-process, serial session instead of Electron's
renderer/preload/main-process IPC chain. The costly part remains UI parity. The
next gate is the complete Library vertical slice: rich Markdown reading, source
editing, save validation, keyboard navigation, and live external-change
refresh.
