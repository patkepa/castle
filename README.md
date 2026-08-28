# Castle

A local-first React, Electron, and Rust application for Markdown knowledge
bases. It provides generated navigation, search,
Markdown rendering, table of contents, previous/next links, and interactive
relationship graph while using the reusable Kantzen UI workspace system.

Markdown files in the configured library are the only source of truth. Castle also builds
generated JSON and an owner-only local Turso database as disposable indexes.
Neither generated representation accepts knowledge writes, and both can always
be deleted and rebuilt from Markdown.

[Explore the live demo](https://patkepa.github.io/castle/) built from the
synthetic library in `examples/library/`. Every push to `main` rebuilds and
publishes the demo through GitHub Actions.

## Getting started

Castle requires Node.js, npm, and Rust 1.90 or newer.

```sh
npm install
npm run dev
```

A fresh checkout opens the synthetic, publish-safe library in
`examples/library/`. To use another library, copy `CONFIGURATION.md` to
`CONFIGURATION.local.md` and edit the local copy. The local override is ignored
by Git and can contain machine-specific paths or a private owner identity.
Command-line `--library` and `--repository` flags override the configured paths
when supplied.

`CONFIGURATION.md` controls the desktop application name and bundle ID, default
library and repository paths, and the optional owner note, label, and avatar
used by relationship views. See that file for the complete field reference.
Do not store credentials in configuration; `.env` is reserved for local API
keys and is ignored separately.

Generated web data, copied library assets, build output, dependency trees, and
native targets are deliberately ignored. Create public releases from tracked
files, not by copying a populated working directory.

## Distribution targets

Castle has one shared React application with two distribution targets. The web
target is a static, read-only application deployed behind Cloudflare Access.
The Electron target edits source Markdown and provides interactive record
operations without adding write capabilities to the web deployment.

The explicit web commands are `npm run dev:web`, `npm run build:web`, and
`npm run deploy:web`. The existing `dev`, `build`, and `deploy` commands remain
compatible aliases.

Cloudflare's default build image supplies Node but not Rust, while Castle's
content and contract generators are Rust programs. Set the Cloudflare build
command to `npm run build:cloudflare`; it installs the minimal Rust toolchain
when it is absent, then runs the normal production build. The web build
compiles only the small `castle-web-build` generator, rather than Castle's
desktop-only index, embedding, and MCP dependencies. The first build can still
take longer while Cargo compiles that generator and its content-engine
dependencies.

The desktop shell uses `npm run dev:desktop`, `npm run package:desktop`, and
`npm run make:desktop`. Packaged builds use a
sandboxed renderer, a context-isolated preload, a private `castle://` asset
protocol, sender-validated IPC, and strict Electron fuse configuration. The
desktop app remembers a selected library and starts the packaged Rust content
service as a sidecar. First launch stays in Castle and offers an Open Folder
flow; previously opened libraries remain available from that screen and from
the Library section in View settings. Selecting another library restarts the
desktop shell against that folder, with generated caches isolated per canonical
library path. The service owns the private local snapshot, detects
external Markdown changes, and notifies Electron when the renderer should
reload. Desktop note pages can switch
from reading view into raw-source or edit-and-preview modes from the top bar.
Desktop interface preferences—including pins, sidebar choices, and list or
board views—are stored per library in `.castle/settings.toml`. Castle creates
this readable TOML file from existing browser preferences on first desktop
launch, then updates it atomically. It is safe to adjust while Castle is
closed.
Saves preserve the original Markdown, validate the complete proposed library,
detect external changes, and replace the source file atomically. Creates use
validated transactions with rollback. Deletes move source files into Castle's
ignored `.castle/trash/` directory and expose Undo in the task UI. The web build
keeps the same reading UI but has no filesystem or mutation bridge.

## Canvas files

The Canvas tab creates and edits `.canvas` files under `library/canvas/` using
the open JSON Canvas 1.0 shape used by Obsidian. Nested folders are listed in
the Canvas file rail. Castle preserves compatible extension fields while
supporting Markdown text cards, vault file cards, images, PDF documents, web
links, groups, directed and labeled connections, preset colors, ordering, drag
and resize, multi-select, undo and redo, and pan/zoom navigation. In the desktop
app, the image/PDF tool and file drag-and-drop copy supported media into
`library/assets/canvas/` and reference it with a portable `assets/...` path.
Desktop canvases autosave atomically; the web target can open, edit, and
download a local `.canvas` file without gaining filesystem access.

## Built-in Markdown documents

Castle can ship Markdown documents with the application while still allowing a
desktop library to replace them. Definitions live in
`src/lib/builtInDocumentManifest.ts`, and bundled source lives under
`src/builtins/`. When the matching override file is absent, Castle renders the
bundled source as a virtual note. Opening Edit uses the ordinary note workspace;
the first edit creates the configured file in `library/`, after which that file
is the source Castle renders everywhere.

The Markdown help page, available from View settings, uses
`notes/castle_help.md` as its override. It uses the shared `MarkdownRenderer`
component, so the same link, heading, asset, table, task-list, and code
rendering is available to notes and non-note surfaces.

## Shortcut collections

Castle's home screen reads shortcut collections from Markdown files under
`library/shortcuts/`. This keeps personal and organization-specific links in
the library instead of the Castle source tree. Each file defines one collection:

```yaml
---
shortcut_collection: main
label: Main
sort_order: 10
shortcuts:
  - category: Development
    label: Repository
    description: Open the project repository
    href: https://example.com/repository
---
```

`shortcut_collection` is the permanent collection ID and accepts lowercase
letters, digits, hyphens, and underscores. `sort_order` controls tab order.
Every shortcut requires `category`, `label`, `description`, and `href`.
Destinations must be HTTP(S) URLs or absolute Castle routes beginning with `/`,
and a collection cannot contain the same destination twice.

## Native content engine

`castle/native/` is a Rust workspace containing the shared Castle compiler and
the `castle` command-line program. It is the only content backend for both
targets:

- `castle build` validates the library and writes a versioned resource manifest,
  immutable domain slices, content-addressed note resources, search index,
  relationship graph, and copied assets used by Vite and Cloudflare. Routes
  fetch only the domains they need; the monolithic catalog remains a disposable
  compatibility artifact.
- `castle validate` runs the same compiler without writing generated output.
- `castle migrate` plans version-by-version Castle Record schema migrations.
  It is a dry-run unless `--apply` is supplied; apply mode backs up every source,
  writes atomically, validates the complete library, and rolls the transaction
  back if compilation fails.
- `castle daemon` keeps the compiler alive for Electron, serves source reads
  and validated mutations over newline-delimited JSON, incrementally publishes
  immutable note resources and database generations, and watches the selected
  library for changes.
- `castle index` probes Turso capabilities and builds, verifies, or reports the
  status of a local knowledge index.
- `castle mcp` runs the read-only Castle MCP server over stdio.

The Electron main process remains a small security boundary: it validates the
renderer sender and request shape, then forwards the operation to Rust. It does
not parse Markdown or mutate source files itself. Packaged apps include the
release `castle` binary in the app resources directory.

Useful native commands:

```sh
npm run build:native
npm run test:native
npm run validate:library
npm run migrate:records -- --json
# After reviewing the dry-run:
npm run migrate:records -- --apply
```

Rust 1.90 or newer is required to build Castle from source.

## Local knowledge index

The desktop daemon publishes one immutable Turso generation at a time under its
private application cache. A small `current.json` pointer selects the verified
generation. Readers keep their existing generation while a new one builds;
publication verifies integrity, foreign keys, row counts, schema version, and
the source fingerprint before changing the pointer. Castle retains the current
and previous verified databases for recovery.

The index contains compiled note text, deterministic Markdown chunks, links,
normalized record references, and typed task, event, project, person, and
relationship projections. It is a sensitive local cache because it
contains copies of private Markdown. Database files and sidecars are hardened to
owner-only permissions and should not be synced as content or treated as a
backup.

Castle currently uses its deterministic multilingual lexical ranker because
Turso's experimental FTS index failed the integrity and prefix gates in the
pinned engine. Exact vector search and hybrid Reciprocal Rank Fusion are
implemented. Production semantic search runs `intfloat/multilingual-e5-small`
locally through FastEmbed/ONNX Runtime. It supports Polish and English, uses the
model's required asymmetric `query:` and `passage:` inputs, and stores
384-dimensional normalized vectors. Castle pins the model to Hugging Face commit
`0e60b8d9d2166d80387f86e3b48ec9ced55f4d15` and verifies the size and SHA-256 of
every required asset before loading it.

The first desktop or semantic MCP start downloads about 487 MB of public model
assets into Castle's owner-only application cache. Afterwards model loading and
inference work offline. No note, query, vector, or provider token is sent during
local inference; the downloader explicitly uses no Hugging Face token. A
provider-neutral background runtime prepares the model without blocking app
startup, records missing work in a separate rebuildable cache, reuses
content-addressed vectors, applies bounded batches with classified retries and
cancellation, and publishes a later immutable generation only when the source
fingerprint is still current. Search explicitly reports lexical degradation
while the model is preparing or unavailable, without blocking startup or saves.

Useful index commands:

```sh
native/target/release/castle index build \
  --indexes /absolute/private/path/to/castle-indexes
native/target/release/castle index verify \
  --indexes /absolute/private/path/to/castle-indexes
native/target/release/castle index status \
  --indexes /absolute/private/path/to/castle-indexes
```

These commands use `CONFIGURATION.md` by default. Explicit `--library` and
`--repository` arguments remain available for automation.

## MCP and desktop chat

`castle mcp` exposes bounded, read-only search, note, project, task, event,
people, relationship, and SQL-backed knowledge-overview tools over
stdio. It exposes neither arbitrary SQL nor filesystem, shell, write, or delete
capabilities. Note bodies are treated as untrusted content and cannot add tools
or change authorization.

MCP and desktop call the same typed search service. If the selected immutable
generation contains compatible embeddings, MCP loads the pinned local model
from the `models` directory adjacent to the configured `indexes` directory and
performs the same semantic or hybrid query. It falls back to lexical search if
the model or semantic generation is unavailable.

Build an index first, then configure an MCP client with an absolute executable
path and literal argument array. For example:

```json
{
  "mcpServers": {
    "castle": {
      "command": "/absolute/path/to/castle",
      "args": [
        "mcp",
        "--library",
        "/absolute/path/to/library",
        "--indexes",
        "/absolute/private/path/to/castle-indexes"
      ]
    }
  }
}
```

Do not place shell substitutions, provider tokens, or reusable Turso credentials
in this configuration. An absent or incompatible index produces a clear startup
error; rebuild it with `castle index build`.

The desktop chat uses the same bounded search and note-read service. When a
signed-in `codex` executable is available, Castle can use the existing Codex
account through an ephemeral, read-only subprocess. Before each request, a
native confirmation dialog previews the message and proposed scope: the number
of explicitly attached notes, whether library search is enabled, and the maximum
source and context bounds. Cancelling happens before retrieval and prevents the
provider process from receiving the question or context. Castle never receives
or stores a reusable provider token. If Codex is unavailable, the provider falls
back to the on-device retrieval summarizer, which streams cited excerpts and
labels itself as retrieval rather than model interpretation.

Conversations remain in renderer memory. A separate bounded, process-local audit
records request IDs, timings, provider/model, retrieval tool names and counts,
source/result counts, output size, outcome, and whether transmission was actually
approved. It never stores prompts, responses, citations, titles, paths, note IDs,
or note bodies.

Desktop content search also compares the database and browser rankers in private
shadow mode. Only aggregate agreement, overlap, displacement, and failure
counters are retained in renderer memory. The retained Intelligence utility
combines those counters with typed SQL-backed note, link, chunk, task, event,
project, person, and relationship summaries. These are disposable-index diagnostics;
Markdown remains the sole durable knowledge source. The same Intelligence view
reports local-model readiness, semantic-generation availability, dimensions,
embedding backlog, cache hits, generated vectors, retries, and aggregate failure
class without retaining query or note content.

## Castle Records

App-facing entities use a shared file contract called Castle Records: one
person, project, task, or calendar event per
Markdown file. YAML frontmatter contains fields Castle queries and Markdown
contains narrative context.

Every record requires a type, schema version, and permanent human-readable ID:

```md
---
type: project
schema_version: 1
id: project_castle
status: active
---

# Castle

A local-first interface for a file-based knowledge base.
```

IDs use `snake_case` with a type prefix and remain unchanged when a file moves.
Record references use quoted Obsidian links. Castle resolves those links to
stable IDs while generating its catalog.

Record schemas live under `castle/schemas/`. Validate the entire library with:

```sh
npm run validate:library
```

Validation rejects unknown record types and properties, duplicate or malformed
IDs, broken links, invalid dates and times, missing project roots, and invalid
type-specific fields. The regular generate and build commands run the same
validation before writing output.

Frontmatter conventions:

- Omit unknown optional properties rather than keeping empty values.
- Quote dates, times, decimal money amounts, and Obsidian links.
- Use `snake_case` for keys, IDs, and enum values.
- Keep prose and context in the Markdown body.
- Do not duplicate structured properties as tags.
- Do not store large nested record arrays in frontmatter.

## Run

```sh
npm install
npm run dev
```

While the dev server is running, adding, editing, moving, or deleting any
non-hidden content under `library/` regenerates the viewer data and reloads the
page automatically. This includes Markdown notes, project content, and media in
`library/assets/`; hidden vault metadata such as `.obsidian/` is ignored.

The Rust-backed `generate` script reads the supported content directories under
the repository's `library/` root, including notes, people, projects, tasks,
events, shortcuts, and media. It writes generated JSON data and copies
referenced content assets into `public/`; generated files are ignored by Git.
Source notes remain untouched.

## Stash

`library/stash/` is the quick-capture folder for short text, links, and other
lightweight Markdown. Every item has its own Markdown file and does not need
frontmatter or a heading; when no title is present, Castle falls back to the
file name. The Stash folder groups items by creation day, shows them newest-first,
and previews up to 600 characters of each captured body; selecting an item
opens its complete note. Creation dates come from Git history, with filesystem
creation time as a fallback, so timestamp metadata does not live in the note.
An item containing only a YouTube URL renders a lazy privacy-enhanced video
preview alongside links to YouTube and the complete note. Castle Desktop also
shows a quick-capture panel at the top of Stash. Submitting it creates the
corresponding Markdown file and publishes the new item into the open app. The
static web build remains read-only; items added through Obsidian or the file
system appear after content regeneration.

## Playlist view

Any library folder whose direct notes contain playable video URLs gets a
Playlist option beside List and Grid. Supported sources are YouTube, direct
links ending in `.mp4`, `.webm`, `.ogg`, `.ogv`, `.mov`, `.m4v`, or `.m3u8`,
and provider-supplied player URLs using an `/embed/` path or a `player.*` host.
Playlist view opens the selected or most recently watched video in a focused
player with the remaining videos in an ordered queue. Entering Playlist mode
does not start playback; choosing a thumbnail or queue item does. Playback
position, completion state, the active video, and the auto-play-next preference
are saved locally. The current video is also encoded in the folder URL so
refresh and browser history restore the expected view.

The queue supports previous/next controls, arrow-key focus navigation,
auto-advance for controllable media, progress and duration metadata, and stable
filtering that never replaces the playing video. The Note action opens the
video's Markdown in a side panel without unmounting the player.
Folders containing only videos default to Grid, where playable thumbnails are
arranged responsively with links to their source notes. `library/playlists/` is
the conventional home for curated video collections, but both presentations are
content-driven and work in every supported library folder. YouTube uses its
privacy-enhanced embed, direct files use native browser playback, and generic
provider embeds run in a restricted iframe.

## Person avatars

Person notes can declare an avatar in YAML frontmatter. Files in
`library/assets/` use their public `/assets/` path:

```md
---
type: person
schema_version: 1
id: person_alex_morgan
name: Alex Morgan
avatar: /assets/avatars/alex_morgan.png
---
```

The generated note catalog and relationship graph both expose the normalized
avatar URL, so the same person metadata can be reused across viewer surfaces.
People notes use the same `avatar` property; relative paths to media
stored beside a note are also supported.

## People metadata

Every person note lives directly in `library/people/`. Relationship structure
is metadata rather than a directory hierarchy:

```md
---
type: person
schema_version: 1
id: person_alex_morgan
name: Alex Morgan
location: "London, United Kingdom"
coordinates:
  latitude: 51.5074
  longitude: -0.1278
  resolved_from: "London, United Kingdom"
alignment:
  - coworker
relation: positive
known_from:
  - "businesses/Example Labs"
company: "Example Labs"
department: "Engineering"
relation_to:
  - person: "[[people/jamie_chen|Jamie Chen]]"
    relation: positive
    relationship: coworker
---
```

Every person requires either a singular `location` or a plural `locations`
list. For one location, use a city, region, or full address that Google Maps
can search, and use `unknown` when the location is not known. Castle renders
known locations as links that open Google Maps; `unknown` stays visible without
creating a misleading map link.

For a person with more than one home, replace the singular `location` and
`coordinates` fields with `locations`. Give each entry a descriptive `label`,
its searchable `address`, and mark exactly one as `primary: true`:

```yaml
locations:
  - label: "Primary home"
    address: "London, United Kingdom"
    primary: true
    coordinates:
      latitude: 51.5074
      longitude: -0.1278
      resolved_from: "London, United Kingdom"
  - label: "Family home"
    address: "Edinburgh, United Kingdom"
    coordinates:
      latitude: 55.9533
      longitude: -3.1883
      resolved_from: "Edinburgh, United Kingdom"
```

All locations appear on the Relationships map. A person with multiple homes
gets a next-location control in each marker popup so the map can move between
them. Existing singular `location` records remain supported.

The Relationships map reads generated `coordinates` from each person note.
`resolved_from` records the exact `location` used for that lookup, so changing
the address automatically marks the coordinates as stale. People with the same
coordinates share one map marker; city-only locations are shown as an area.

Castle synchronizes stale or missing coordinates before `generate` and `dev`.
`build` and `validate:library` are read-only: they report stale coordinates and
ask you to sync them explicitly. Enable the Google Geocoding API with billing,
copy `.env.example` to `.env`, and set `GOOGLE_MAPS_API_KEY`. The key stays in
the ignored local `.env` file and is sent in a request header, not written to
the library or generated app. Geocoding sends the complete configured address
to Google's Geocoding API; use `location: unknown` or supply coordinates
yourself when that disclosure is not acceptable. Only new or changed locations
make an API call.
Run the sync directly after editing an address:

```sh
npm run sync:person-locations
```

To check coordinate freshness without changing Markdown, run
`npm run check:person-locations`.

Treat `coordinates` as generated metadata: edit `location` or a location
entry's `address`, then let the sync replace the matching coordinate block. A
known location with stale coordinates stops generation with a clear setup
message when no API key is available. Setting a singular location to `unknown`
removes its coordinate block on the next sync.

`alignment` is a list and may combine roles such as `friend` and `coworker`.
`relation` describes the knowledge-base owner's overall sentiment and supports
`positive`, `neutral`, `flirty`, `mixed`, and `negative`. `known_from` is also a
list; use slash-separated paths to create graph branches. For example,
`businesses/Example Labs` renders as Owner → Businesses → Example Labs →
person. Use `unknown` when the origin is not known.

People are current by default, so they do not carry an `active` status. Use the
optional `status: former` only when that distinction is meaningful.

`department` is optional and accepts either one department or a list. When a
person's `company` matches the company segment in `known_from`, Castle nests
the person under that department in the tree. For example, the metadata above
renders as Owner → Businesses → Example Labs → Engineering → person.
Department nodes can be shown or hidden independently in Graph view and are
hidden there by default.

`relation_to` records explicit connections between two people. Each item has a
person note link, a sentiment `relation` (`positive`, `neutral`, `flirty`,
`mixed`, or `negative`), and an optional relationship role. Supported roles
are `partner`, `spouse`, `sibling`, `parent`, `child`, `family`, `friend`,
`close_friend`, `acquaintance`, `coworker`, `manager`, `direct_report`,
`classmate`, `housemate`, and `ex_partner`. `friendly` is accepted as an alias
for `positive`. Castle renders these relationships as colored person-to-person
edges; ordinary note mentions remain optional dotted links. The graph can be
grouped by `Known from` or by `Relation` without changing the person files.

## Projects

Each project directory has one root record at
`library/projects/<project>/<project>.md`. Other Markdown files in the same
directory are supporting notes and do not need record frontmatter.

```md
---
type: project
schema_version: 1
id: project_castle
status: active
started: "2026-07-31"
people:
  - "[[people/jamie_chen|Jamie Chen]]"
---

# Castle

Project overview and outcomes.
```

Supported statuses are `idea`, `planned`, `active`, `paused`, `completed`, and
`archived`. Tasks and calendar events can declare one project using a quoted
link. The Projects workspace combines the project note with its people, tasks,
and events in a reusable list-and-inspector layout.

## Calendar events

The calendar reads one event per Markdown file from `library/events/<year>/`. Event
metadata belongs in YAML frontmatter; the first level-one heading is the event
title and the remaining Markdown is its description.

```md
---
type: calendar_event
schema_version: 1
id: event_2026_07_31_project_workshop
date: "2026-07-31"
start: "12:00"
end: "14:00"
kind: work
people:
  - "[[people/jamie_chen|Jamie Chen]]"
project: "[[projects/example_product/example_product|Example Product]]"
---

# Project workshop

Review the next product milestone with Jamie.
```

`end`, `end_date`, and `people` are optional. Use `end_date` with `end` for an
event that spans multiple calendar days. For a simple overnight event,
`end_date` may be omitted: an `end` earlier than `start` means the following
day. Equal start and end times require a later `end_date`. Supported `kind`
values are `work` and `social`. Dates use `YYYY-MM-DD`, and times use 24-hour
`HH:MM`. Each `people`
entry is a quoted Obsidian link to a note under `people/`. Resolved
people are linked from the calendar event, and their five latest events appear
at the bottom of the person note.

To repeat an event each week, add `recurrence: weekly`. Optionally use
`repeat_until: "YYYY-MM-DD"` to stop after the final weekly occurrence. The
event remains one source Markdown file and Castle expands its occurrences in
calendar views.

`project` and `timezone` are optional. Project-linked events appear in the
corresponding project inspector.

## Tasks

The Tasks tab reads structured Markdown files from `library/tasks/`. Each file remains
a normal Obsidian-compatible note while its frontmatter supplies the fields
needed by the dedicated task dashboard.

```md
---
type: task
schema_version: 1
id: task_prepare_project_proposal
status: in_progress
due_date: "2026-07-31"
due_time: "17:30"
estimate_minutes: 90
sort_order: 2000
created: "2026-07-28"
people:
  - "[[people/jamie_chen|Jamie Chen]]"
project: "[[projects/example_product/example_product|Example Product]]"
---

# Prepare project proposal

Finish the proposal with [[people/jamie_chen|Jamie]].

## Subtasks

- [x] Confirm proposal scope
- [x] Draft pricing options
- [ ] Review delivery timeline
- [ ] Send final proposal
```

`status` must be `todo`, `in_progress`, `blocked`, or `done`. `due_date`, `due_time`,
`estimate_minutes`, `sort_order`, `created`, and `people` are optional; `due_time` requires
`due_date`. A completed task may also declare `completed_at` as an ISO date or
date-time. Standard Markdown checkbox items become subtasks and their
completion is summarized in the dashboard.

`sort_order` is a non-negative number maintained by Castle when tasks are
reordered on the Kanban board. It is intentionally stored in frontmatter so
the chosen order survives regeneration and remains portable with the Markdown
vault.

People listed in `people` are shown explicitly in the task inspector. Links to
person notes anywhere in the task body or its subtasks are also inferred
as task people, so an ordinary Obsidian mention is enough to connect them.

The Tasks workspace has separate Personal and Projects scopes. A task without a
`project` link is personal; a task with one appears in the Projects scope and
in that project's inspector.

## Kantzen UI dependency

Castle consumes the published Kantzen UI package. The package owns the theme,
primitives, shell, navigation, interaction helpers, graph, and command-palette
styling. Castle uses its versioned npm release rather than a local source copy.

Kantzen UI intentionally keeps `@blueprintjs/icons` as its icon provider. It
does not depend on Blueprint Core.

## Deploy

Knowledge bases may contain sensitive data. Before deploying one, protect its
production hostname with Cloudflare Access and verify in a signed-out browser
window that the hostname redirects to the Access login page.

```sh
CASTLE_PRODUCTION_URL=https://notes.example.com npm run deploy
```

The deployment check makes an unauthenticated request to the production URL and
requires a Cloudflare Access login redirect. The output is a static
single-page application served by Cloudflare Workers Static Assets.
`workers.dev` and preview URLs are disabled, and crawler-blocking metadata and
headers provide defense in depth; they do not replace authentication.

## License

Castle is available under the MIT License. See `LICENSE`.
