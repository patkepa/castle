# Castle architecture

Castle is organized around one content engine and its local-first desktop
application.

```text
Markdown library
       |
       v
castle-core (compile, validate, normalize, project)
       |
       +-- immutable snapshot --> desktop renderer (Electron, local read/write)
```

## Application boundaries

The desktop application owns filesystem access, source mutations, file
watching, local indexes, native integrations, and the Electron main/preload
boundary. Its renderer should obtain those operations through `CastlePlatform`
instead of reading `window.castleDesktop` directly. Only the renderer composition
root and the runtime adapter may access the raw preload bridge; architecture
checks enforce that feature code uses the platform's scoped desktop services.

Rust remains the canonical implementation of Castle Markdown semantics. The
desktop renderer consumes its normalized snapshot and must not independently
compile the source library.

Generated transport and domain DTOs live in `packages/contracts`. Rust exports
the JSON schema into that package, the TypeScript generator builds its runtime
validator, and the desktop application imports `@castle/contracts` instead of
reaching into another application's source tree.

Runtime-neutral Markdown source, link, asset, and route helpers live in
`packages/content`. The desktop renderer resolves Castle content paths through
`@castle/content`.

## Repository automation

Cross-workspace automation lives in the `xtask` crate and is exposed through
`cargo xtask`. Each application and shared package continues to own its
low-level npm commands. This keeps local development, generation, validation,
and release workflows on the same typed command surface.

## Snapshot builds

The xtask snapshot commands pass an explicit profile to `castle-snapshot`.
`cargo xtask generate content desktop` writes the full desktop-viewer snapshot
to `apps/desktop/public`.

The snapshot is a build dependency, not a runtime service. The desktop renderer
and the general-purpose CLI select the explicit `Desktop` profile.

## Workspace ownership

`apps/desktop` owns the React renderer, Electron main/preload processes, and its
Vite and Forge configuration, tests, and application-specific scripts. Shared
packages own their generators and tests. Record schemas live beside
`castle-core`, which is their only consumer.

The repository root contains workspace manifests, documentation, shared
configuration, and scripts that coordinate more than one workspace. It does
not act as another application target or own application dependencies.

Architecture checks enforce the desktop renderer's platform and feature
boundaries.
