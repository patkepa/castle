# Castle native content engine

This workspace is the content backend for Castle.

- `castle_core` compiles the Markdown library into typed projections, validates
  Castle Records, resolves Obsidian links, writes content-addressed snapshots,
  and implements transactional source mutations.
- `castle_runtime` owns the in-process desktop library session, serializes
  commands, and publishes epoch-scoped snapshots and content events.
- `castle_desktop` is the native GPUI application. It is an explicit workspace
  target rather than a default member because GPUI has a platform build stack.
- `castle_cli` exposes `build`, `validate`, and the persistent Electron
  `daemon`.

The static and desktop targets deliberately use the same compiler. Markdown in
`library/` remains the source of truth; no database or daemon-owned source state
is introduced.

## Commands

Run these from `castle/`:

```sh
cargo run --release --manifest-path native/Cargo.toml -p castle-cli -- build
cargo run --release --manifest-path native/Cargo.toml -p castle-cli -- validate
cargo test --manifest-path native/Cargo.toml --workspace --exclude castle-desktop
cargo test --manifest-path native/Cargo.toml -p castle-runtime -p castle-desktop
```

`build` reads its default library and repository paths from `CONFIGURATION.md`
and publishes fetchable artifacts below `public/generated/`. Command-line
`--library` and `--repository` values override configuration. Pass
`--generated <path>` only when a pretty, monolithic
knowledge-base JSON file is needed for debugging or export. Note resources are
immutable and named by their SHA-256 content hash. Existing unchanged resources
and assets are reused; the catalog is atomically published after its resources.

## Electron daemon protocol

The daemon receives one JSON object per stdin line and emits one JSON object per
stdout line. Requests contain numeric `id`, string `method`, and object
`params`; responses contain the matching `id` and either `result` or `error`.
It emits `ready`, `snapshotChanged`, and `snapshotError` events independently.

Supported methods are `getState`, `readSource`, `saveSource`, `createSource`,
`deleteSource`, `restoreSource`, `refresh`, and `shutdown`. The mutation methods
enforce library path containment, Markdown-only source paths, content revisions,
complete-library validation, atomic replacement, and rollback. Deleted sources
are retained below the ignored `.castle/trash/` directory for recovery.

Stdout is reserved for protocol messages. Operational failures and compiler
diagnostics go to stderr.
