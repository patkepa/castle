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
  modes, with focused native filtering and `cmd-f` search focus;
- read headings, paragraphs, lists, quotes, code, tables, links, local assets,
  outlines, and backlinks in a Castle-styled surface without a web renderer;
- load and edit source Markdown asynchronously, save with revision-conflict
  protection, preserve failed drafts, and guard dirty navigation/window close;
- accept a different library with `--library /absolute/path/to/library` or
  switch at runtime through the recent-library screen and native directory
  chooser in the sidebar;
- persist canonical recent-library paths atomically and surface missing folders
  as unavailable choices without blocking another library from opening.

Run it from the repository root:

```sh
cargo xtask run
# With an explicit library:
cargo xtask run -- --library /path/to/library
```

Build it without launching with `cargo xtask build` (add `--release` for an
optimized binary). Validate the experiment with `cargo xtask check desktop`.

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

This is an architecture foundation, not a replacement desktop release. The
Markdown reader and revision-safe editing path are live spikes, but the source
editor still needs undo/redo, precise pointer selection, accessibility QA, and
large-document performance work before it is production-ready. Full search and
command palette behavior, canvases, sheets, calendar/tasks/projects, AI chat,
menus, packaging, and parity tests remain unported. Filesystem watching, native
library switching, the canonical recent-library registry, and launch-time
recovery are live. Non-Library sidebar destinations remain roadmap placeholders.

## Early assessment

The architecture is viable: GPUI now calls the existing Rust content engine
through an in-process, serial session instead of Electron's
renderer/preload/main-process IPC chain. The costly part remains UI parity. The
next gate is hardening the complete Library vertical slice: production text
editing behavior, keyboard navigation, virtualized large-library rendering, and
fixture-based parity against the Electron reader.
