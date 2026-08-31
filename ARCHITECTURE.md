# Castle architecture

Castle is organized around one content engine and two application targets.

```text
Markdown library
       |
       v
castle-core (compile, validate, normalize, project)
       |
       +-- immutable snapshot --> apps/web (Astro, static/read-only)
       |
       +-- live service --------> desktop (Electron, local read/write)
```

## Application boundaries

`apps/web` is a publication target. It may read only the versioned snapshot
produced by `castle-web-build`. It must not import Electron, access the desktop
preload bridge, or receive a content-mutation implementation. Its deployed
artifact must not require Rust or Node.js.

The desktop application owns filesystem access, source mutations, file
watching, local indexes, native integrations, and the Electron main/preload
boundary. Its renderer should obtain those operations through `CastlePlatform`
instead of reading `window.castleDesktop` directly.

Rust remains the canonical implementation of Castle Markdown semantics. Astro
renders the normalized snapshot and must not independently compile the source
library.

Generated transport and domain DTOs live in `packages/contracts`. Rust exports
the JSON schema into that package, the TypeScript generator builds its runtime
validator, and both application targets import `@castle/contracts` instead of
reaching into another application's source tree.

Runtime-neutral Markdown source, link, asset, and deployment-route helpers live
in `packages/content`. Both renderers own their presentation components, but
they resolve Castle content paths through `@castle/content` so static and
desktop navigation cannot drift.

## Web build

The root `generate:content:web` script runs `castle-web-build` with
`apps/web/public` as its output. Astro uses the ignored generated subdirectories
alongside its tracked deployment metadata as `publicDir` and reads its catalog
during prerendering. Each Castle note gets a real static
`/note/.../index.html` route.

The snapshot is a build dependency, not a runtime service:

```text
Rust in CI -> JSON/assets snapshot -> Astro build -> static deployment
```

Snapshot production can later move to a separate CI job without changing the
Astro application, provided it supplies the same content contract.

## Migration plan

`apps/desktop` owns the React renderer, Electron main/preload processes, and its
Vite and Forge configuration. Root scripts orchestrate both apps and the Rust
workspace without acting as another application target.

The next extractions should be made only when their first consumers are ready:

1. Remove direct desktop-bridge access from shared UI code.
2. Add an explicit public snapshot profile with field and asset allowlists
   before publishing non-synthetic libraries.

Architecture checks enforce that `apps/web` cannot reach into the desktop
renderer or Electron process code.
