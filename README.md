# Castle

A local-first Electron application for Markdown knowledge bases. The Rust
content engine is the canonical parser and validator; `apps/desktop` owns the
React renderer, native integration, indexing, and file management. Generated
application DTOs and runtime validators are shared through `@castle/contracts`;
runtime-neutral Markdown and route semantics are shared through `@castle/content`.

Application code, tests, configuration, and application-specific scripts are
colocated under `apps/desktop`. Shared packages own their tests and generators,
while the repository root only orchestrates the workspaces.

## Getting started

Castle requires Node.js, npm, and Rust 1.90 or newer.

```sh
npm install
cargo xtask dev viewer
```

`cargo xtask dev` and `cargo xtask dev viewer` generate the desktop snapshot
and start the browser preview of the desktop renderer. Use `cargo xtask dev
desktop` for Electron.

Production viewer builds use the same two-stage pipeline:

```sh
cargo xtask generate content desktop
cargo xtask build viewer
```

The first command writes an ignored snapshot under `apps/desktop/public`; the
second builds the desktop renderer.

Run `cargo xtask --help` to see all repository tasks. Application-specific npm
commands remain in their owning workspace. Use `cargo xtask clean` to remove
generated application output, caches, and the Rust target directory.

See [ARCHITECTURE.md](ARCHITECTURE.md) for package boundaries and the migration
plan.

## License

Castle is available under the MIT License. See `LICENSE`.
