# Castle

A local-first Markdown knowledge system with two application targets:

- `apps/web`: a read-only Astro site generated from an immutable Castle snapshot.
- the Electron desktop application: the full local authoring, indexing, and file-management experience.

Both targets use the Rust content engine as the canonical parser and validator.
The deployed Astro site is static HTML, CSS, JavaScript, and assets; Rust is only
needed while producing its build input. Generated application DTOs and their
runtime validators are shared through `@castle/contracts`.

[Explore the live demo](https://patkepa.github.io/castle/)

## Getting started

Castle requires Node.js, npm, and Rust 1.90 or newer.

```sh
npm install
npm run dev
```

`npm run dev` generates a web snapshot and starts Astro. Use
`npm run dev:desktop` for Electron or `npm run dev:viewer` for the legacy React
viewer while the monorepo migration is in progress.

Production builds follow the same two-stage pipeline:

```sh
npm run generate:content:web
npm run build --workspace @castle/web
```

The first command writes ignored build input under `apps/web/.castle/public`.
Astro consumes that snapshot and writes the deployable site to
`apps/web/dist`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for package boundaries and the migration
plan.

## License

Castle is available under the MIT License. See `LICENSE`.
