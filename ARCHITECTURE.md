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
produced by `castle-snapshot`. It must not import Electron, access the desktop
preload bridge, or receive a content-mutation implementation. Its deployed
artifact must not require Rust or Node.js.

The desktop application owns filesystem access, source mutations, file
watching, local indexes, native integrations, and the Electron main/preload
boundary. Its renderer should obtain those operations through `CastlePlatform`
instead of reading `window.castleDesktop` directly. Only the renderer composition
root and the runtime adapter may access the raw preload bridge; architecture
checks enforce that feature code uses the platform's scoped desktop services.

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

## Snapshot builds

The root snapshot scripts pass an explicit profile to `castle-snapshot`:
`generate:content:web` writes the public projection to `apps/web/public`, while
`generate:content` writes the full desktop-viewer snapshot to
`apps/desktop/public`. Astro uses the ignored generated subdirectories
alongside its tracked deployment metadata as `publicDir` and reads its catalog
during prerendering. Each Castle note gets a real static
`/note/.../index.html` route.

The snapshot is a build dependency, not a runtime service. The Astro build
selects the explicit `Public` profile; desktop and the general-purpose CLI
select `Desktop`. The public profile projects the catalog and note resources through
dedicated deny-unknown-field contracts, copies only referenced raster images
with allowlisted extensions, and removes richer desktop resources from its
output root. Its machine-readable policy is emitted as
`generated/public-profile.json` for deployment audits.

The resulting deployment pipeline is:

```text
Rust in CI -> JSON/assets snapshot -> Astro build -> static deployment
```

Snapshot production can later move to a separate CI job without changing the
Astro application, provided it supplies the same content contract.

## Workspace ownership

`apps/desktop` owns the React renderer, Electron main/preload processes, and its
Vite and Forge configuration, tests, and application-specific scripts.
`apps/web` owns Astro, its deployment configuration and scripts, and web tests.
Shared packages own their generators and tests. Record schemas live beside
`castle-core`, which is their only consumer.

The repository root contains workspace manifests, documentation, shared
configuration, and scripts that coordinate more than one workspace. It does
not act as another application target or own application dependencies.

Architecture checks enforce that `apps/web` cannot reach into the desktop
renderer or Electron process code.
