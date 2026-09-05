# Castle native content engine

This workspace is the content backend for Castle.

- `castle_core` compiles the Markdown library into typed projections, validates
  Castle Records, resolves Obsidian links, writes content-addressed snapshots,
  and implements transactional source mutations. It also owns the JSON schemas
  used to validate those records.
- `castle_cli` exposes `build`, `validate`, and the persistent Electron
  `daemon`.
- `castle_snapshot` emits application build inputs and requires an explicit
  `desktop` or `public` profile.

The static and desktop targets deliberately use the same compiler. Markdown in
`library/` remains the source of truth; no database or daemon-owned source state
is introduced.

## Commands

Run these from `castle/`:

```sh
cargo run --release --manifest-path native/Cargo.toml -p castle-cli -- build
cargo run --release --manifest-path native/Cargo.toml -p castle-cli -- validate
cargo run --release --manifest-path native/Cargo.toml -p castle-snapshot -- build --profile public --public apps/web/public
cargo test --manifest-path native/Cargo.toml --workspace
```

For repository workflows, use the root-level xtask interface instead:

```sh
cargo xtask build native
cargo xtask validate-library
cargo xtask generate content web
cargo xtask test native
```

The commands read their default library and repository paths from
`CONFIGURATION.md` and publish fetchable artifacts below the selected app's
`public/generated/`. `castle-cli build` writes a full desktop snapshot;
application build scripts should use `castle-snapshot` and name their profile.
Command-line `--library` and `--repository` values override configuration. Pass
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
