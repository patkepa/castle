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

## Web build

The root `generate:content:web` script runs `castle-web-build` with
`apps/web/.castle/public` as its output. Astro uses that ignored directory as
its `publicDir` and reads its catalog during prerendering. Each Castle note gets
a real static `/note/.../index.html` route.

The snapshot is a build dependency, not a runtime service:

```text
Rust in CI -> JSON/assets snapshot -> Astro build -> static deployment
```

Snapshot production can later move to a separate CI job without changing the
Astro application, provided it supplies the same content contract.

## Migration plan

The current root React renderer and `electron/` directory remain operational
during the migration. The next extractions should be made only when their first
consumers are ready:

1. Move runtime-neutral Markdown rendering and route helpers into shared
   packages.
2. Move Electron and its renderer into `apps/desktop`.
3. Remove direct desktop-bridge access from shared UI code.
4. Add an explicit public snapshot profile with field and asset allowlists
   before publishing non-synthetic libraries.

Architecture checks enforce that `apps/web` cannot reach into the legacy
desktop renderer or Electron process code.
