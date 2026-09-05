# Castle

A local-first Markdown knowledge system with two application targets:

- `apps/web`: a read-only Astro site generated from an immutable Castle snapshot.
- `apps/desktop`: the Electron application for full local authoring, indexing,
  and file management.

Both targets use the Rust content engine as the canonical parser and validator.
The deployed Astro site is static HTML, CSS, JavaScript, and assets; Rust is only
needed while producing its build input. Generated application DTOs and their
runtime validators are shared through `@castle/contracts`; runtime-neutral
Markdown and route semantics are shared through `@castle/content`.

Application code, tests, configuration, and application-specific scripts are
colocated under `apps/desktop` and `apps/web`. Shared packages own their tests
and generators, while the repository root only orchestrates the workspaces.

[Explore the live demo](https://patkepa.github.io/castle/)

## Getting started

Castle requires Node.js, npm, and Rust 1.90 or newer.

```sh
npm install
cargo xtask dev
```

`cargo xtask dev` generates a web snapshot and starts Astro. Use
`cargo xtask dev desktop` for Electron or `cargo xtask dev viewer` for a browser
preview of the desktop renderer.

Production builds follow the same two-stage pipeline:

```sh
cargo xtask generate content web
cargo xtask build web
```

The first command writes an ignored, deny-by-default public snapshot under
`apps/web/public`. Its catalog omits desktop-only metadata and it includes only
referenced raster image assets with approved extensions. Astro consumes that
snapshot and writes the deployable site to `apps/web/dist`.

Run `cargo xtask --help` to see all repository tasks. The root npm scripts are
compatibility aliases (apart from the Cargo-bootstrapping Cloudflare build);
application-specific npm commands remain in their owning workspace.

See [ARCHITECTURE.md](ARCHITECTURE.md) for package boundaries and the migration
plan.

## License

Castle is available under the MIT License. See `LICENSE`.
