# Castle GPUI experiment

The proposed production structure, runtime boundaries, phased feature plan, and
Electron cutover gates are documented in
[`docs/gpui-desktop-architecture.md`](../docs/gpui-desktop-architecture.md).

This standalone crate is a native Rust proof of concept for replacing Castle's
Electron shell and React renderer with [GPUI](https://gpui.rs/). It deliberately
does not participate in `native/Cargo.toml`, so Castle's existing production
checks do not need to compile GPUI.

The prototype currently proves that a GPUI window can:

- load Castle's real configuration and Markdown library through `castle-core`;
- reproduce Castle's dark Kantzen workspace shell, collapsible navigation,
  breadcrumb chrome, recent notes, and Library toolbar;
- browse the collection index, nested folders, and notes in native list or grid
  modes, with lightweight keyboard filtering after clicking the filter field;
- open notes in a Castle-styled reading surface without a browser, Vite, React,
  Electron, or IPC;
- accept a different library with `--library /absolute/path/to/library`.

Run it from the repository root:

```sh
npm run dev:gpui
# or
cargo run --manifest-path gpui/Cargo.toml -- --library /path/to/library
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

## Current boundary

This is a feasibility spike, not a replacement desktop release. Note bodies are
shown as source Markdown. Editing, rich Markdown, full search and command
palette behavior, canvases, sheets, calendar/tasks/projects, AI chat,
filesystem watching, persistence, menus, shortcuts, accessibility QA,
packaging, and parity tests remain unported. Non-Library sidebar destinations
are intentional roadmap placeholders.

## Early assessment

The architecture is viable: GPUI can call the existing Rust content engine
directly, removing Electron's renderer/preload/main-process IPC chain for native
screens. The costly part is UI parity. Castle's broad React surface and web
deployment still have value, while GPUI is pre-1.0 and documents frequent
breaking changes. A sensible next gate is a single complete vertical slice:
rich Markdown reading plus source editing, save validation, keyboard navigation,
and live external-change refresh. That slice will expose text-input,
accessibility, component-library, and maintenance costs before committing to a
full rewrite.
