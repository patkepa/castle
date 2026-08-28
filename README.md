# Castle

A local-first React, Electron, and Rust application for Markdown knowledge
bases. It provides generated navigation, search,
Markdown rendering, table of contents, previous/next links, and interactive
relationship graph while using the reusable Kantzen UI workspace system.

Markdown files in the configured library are the only source of truth. Castle also builds
generated JSON and an owner-only local Turso database as disposable indexes.
Neither generated representation accepts knowledge writes, and both can always
be deleted and rebuilt from Markdown.

[Explore the live demo](https://patkepa.github.io/castle/)

## Getting started

Castle requires Node.js, npm, and Rust 1.90 or newer.

```sh
npm install
npm run dev
```

A fresh checkout opens the synthetic, publish-safe library in
`examples/library/`. To use another library, copy `CONFIGURATION.md` to
`CONFIGURATION.local.md` and edit the local copy. 

## License

Castle is available under the MIT License. See `LICENSE`.
