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
  modes, with virtualized rows, keyboard selection, focused native filtering,
  and `cmd-f` search focus;
- read headings, paragraphs, lists, quotes, code, tables, links, local assets,
  outlines, and backlinks in a Castle-styled surface without a web renderer;
- load and edit source Markdown asynchronously, save with revision-conflict
  protection, compact undo/redo, Unicode and IME input, pointer selection,
  find/line navigation, preserved failed drafts, and dirty navigation/window
  close guards;
- browse, filter, search, create, advance, block, complete, delete/restore, and
  update task checklists through the serialized runtime mutation path;
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
Build the ad-hoc-signed macOS application bundle with:

```sh
cargo xtask package desktop
# Also create native/target/castle-package/Castle-macOS.zip:
cargo xtask package desktop --make
```

Pass `--identity "Developer ID Application: …"` to sign with a distribution
identity. The default `-` identity is appropriate for local smoke testing.

On macOS, GPUI compiles its own Metal shaders. If Xcode reports that the Metal
toolchain is missing, install Apple's optional component once with:

```sh
xcodebuild -downloadComponent MetalToolchain
```

The current component download is roughly 688 MB. GPUI's first clean build also
compiles a substantially larger dependency graph than Castle's existing core
crates; incremental builds are much faster.

## Current boundary

This is an architecture foundation, not a replacement desktop release. The
Markdown reader, revision-safe source editor, virtualized Library browser,
packaged macOS application, and first writable Tasks workspace are live. The
remaining editor release gate is a full accessibility and latency audit on
representative hardware. Full search and command palette behavior, canvases,
sheets, calendar/projects, AI chat, native menus, notarization, and parity tests
remain unported. Per the current migration decision, Markdown reader parity
fixtures are deferred rather than included in this slice. Filesystem watching,
native library switching, the canonical recent-library registry, and
launch-time recovery are live. Other sidebar destinations remain roadmap
placeholders.

## Early assessment

The architecture is viable: GPUI now calls the existing Rust content engine
through an in-process, serial session instead of Electron's
renderer/preload/main-process IPC chain. The costly part remains UI parity. The
next gate is completing the Tasks inspector/editing surface and validating the
packaged application with accessibility tooling, followed by native search and
the command palette. Electron reader fixtures stay deferred until that work is
explicitly resumed.
