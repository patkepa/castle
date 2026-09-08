# Castle for iOS: read-only implementation plan

Status: Proposed
Target: first TestFlight-quality, read-only release
Proposed app location: `apps/ios`
Proposed native bridge location: `native/castle_mobile`
Minimum deployment target: iOS 17

## 1. Outcome

Build a native SwiftUI application that can authenticate with GitHub, let a user
add one or more repositories containing Castle libraries, download an immutable
revision of each repository, compile it locally with Castle's canonical Rust
engine, and provide a polished offline-capable reading experience.

The first release is intentionally read-only. It must not request GitHub write
permissions, mutate the downloaded repository, create commits, or expose UI that
suggests changes will be synced. The architecture must nevertheless retain the
source file, branch, and commit identities needed to add editing later.

## 2. Product definition

### 2.1 Primary user journey

1. The user launches Castle for iOS and chooses **Connect GitHub**.
2. The user authorizes the Castle GitHub App for selected repositories.
3. Castle lists repositories available to that installation.
4. The user adds a repository. Version 1 uses its default branch.
5. Castle downloads the branch at a specific commit SHA, locates its Castle
   configuration/library, and compiles it locally.
6. The user can browse and search notes, open internal links, view local images,
   and inspect read-only task, project, calendar, and people information.
7. The compiled snapshot remains available without a network connection.
8. Pull-to-refresh checks for a newer commit and atomically replaces the local
   snapshot only after the new revision compiles successfully.

### 2.2 Version 1 scope

- GitHub App authentication for public and private repositories.
- Repository selection and support for multiple saved Castle libraries.
- Default-branch sync at an immutable commit SHA.
- Local compilation through `castle-core`.
- Offline access to the last valid snapshot.
- Home, Browse, Search, Note, Tasks, Projects, Calendar/Agenda, People, and
  Settings surfaces.
- GitHub-flavored Markdown display including headings, lists, task lists,
  tables, code blocks, links, and images.
- Castle relative-link and asset resolution.
- Pull-to-refresh, visible sync status, and recoverable error states.
- Dynamic Type, VoiceOver, light/dark appearance, and iPhone/iPad layouts.

### 2.3 Explicit non-goals

- Editing, creating, deleting, moving, or committing files.
- GitHub `Contents: write` permission.
- Pull requests, issues, branch creation, or conflict resolution.
- Continuous/background-guaranteed synchronization.
- A general-purpose Git client or a local `.git` checkout.
- Semantic/embedding search in `castle-index`.
- AI chat or MCP tools.
- Canvas editing, ODS sheet editing, relationship-map visualization, and media
  authoring.
- Perfect desktop layout parity. The mobile app preserves Castle's information
  and semantics but uses native mobile navigation and presentation.

## 3. Architecture decisions

### 3.1 On-device compilation is the canonical path

Generated Castle snapshots are currently ignored build output. The app must not
assume that `apps/web/public/generated` or `apps/desktop/public/generated` is
committed to each connected repository.

Instead, the app downloads a GitHub repository archive, extracts the configured
library into its private application container, and invokes `castle-core` on
that local copy. This provides:

- consistent behavior with desktop and web builds;
- private-repository support without publishing artifacts;
- an offline snapshot;
- early validation of the Rust/iOS integration needed by future editing;
- no second Markdown/frontmatter compiler written in Swift.

### 3.2 GitHub is the source transport, not the runtime database

The application reads GitHub only while discovering repositories or syncing.
Views read immutable generated resources from local storage. Navigation must not
make GitHub API calls.

### 3.3 Sync is revision-based and atomic

Every local generation is identified by:

- GitHub repository numeric ID;
- repository owner/name;
- branch name;
- source commit SHA;
- Castle content-contract version;
- local generated-at timestamp.

A failed download, extraction, compilation, or contract decode never damages the
currently active generation. New content is built under a staging directory and
published by atomically replacing a small `current.json` pointer.

### 3.4 Rust writes files; Swift reads contracts

Do not transfer an entire library as one large FFI return value. Add a narrow
Rust mobile entry point that accepts repository/library/output paths, runs the
compiler, writes an immutable mobile snapshot, and returns a small typed result.
Swift then lazily reads catalog, domain, note, search, and asset files.

### 3.5 Read-only permissions are real, not cosmetic

The GitHub App requests only:

- Repository metadata: read (required for discovery).
- Repository contents: read.

No write permission is requested in version 1. Enabling editing later is a
deliberate GitHub App permission migration that existing installations will
need to approve.

## 4. System overview

```text
ASWebAuthenticationSession
          |
          v
Castle auth broker ---- GitHub OAuth/GitHub App
          |                     |
          | user token          | repositories + zip archive
          v                     v
      iOS Keychain       GitHubRepositoryClient
                                |
                                v
                     LibrarySyncCoordinator actor
                     download -> inspect -> extract
                                |
                                v
                       castle_mobile (UniFFI)
                                |
                                v
                           castle-core
                                |
                                v
                  immutable local mobile snapshot
                                |
                                v
             SnapshotStore -> SwiftUI feature views
```

## 5. Proposed source layout

```text
apps/ios/
  project.yml                         # reproducible XcodeGen project
  CastleMobile/
    App/
      CastleMobileApp.swift
      AppView.swift
      AppSession.swift
      AppTab.swift
      RouterPath.swift
      DependencyGraph.swift
    Core/
      Contracts/                      # generated or narrowly maintained Codable DTOs
      GitHub/
        GitHubAPI.swift
        GitHubRepositoryClient.swift
        GitHubModels.swift
      Authentication/
        AuthenticationClient.swift
        GitHubAppAuthenticationClient.swift
        KeychainTokenStore.swift
      Libraries/
        LibraryRecord.swift
        LibraryStore.swift
        LibraryDetector.swift
        LibrarySyncCoordinator.swift
        RepositoryArchiveExtractor.swift
        SnapshotStore.swift
      Markdown/
        CastleMarkdownView.swift
        CastleLinkResolver.swift
        CastleImageProvider.swift
      Search/
        SearchService.swift
      Support/
        LoadState.swift
        AppError.swift
        FileProtection.swift
    Features/
      Onboarding/
      RepositoryPicker/
      Home/
      Browse/
      Notes/
      Search/
      Tasks/
      Projects/
      Calendar/
      People/
      Settings/
    Resources/
      PrivacyInfo.xcprivacy
      Assets.xcassets
  CastleMobileTests/
  CastleMobileUITests/
  Fixtures/

native/castle_mobile/
  Cargo.toml
  src/lib.rs
  uniffi.toml

scripts/
  package-ios-core.sh

packages/content/fixtures/
  path-resolution.json               # shared JS/Swift route-resolution vectors
```

The Xcode project may be checked in instead of generated if that better matches
the team's preference. If XcodeGen is chosen, CI must regenerate the project and
fail when the checked-in project is stale.

## 6. Native core work

### 6.1 Add `castle_mobile`

Create a new workspace crate depending on `castle-core`, `castle-contracts`,
`serde`, and UniFFI. Keep iOS-specific networking, authentication, archive
handling, persistence metadata, and UI out of Rust.

Initial exported API:

```text
compile_mobile_snapshot(request: MobileCompileRequest) -> MobileCompileResult
content_contract_version() -> UInt32
core_version() -> String
```

`MobileCompileRequest` contains UTF-8 paths for:

- extracted repository root;
- resolved library root;
- output/staging root;
- owner configuration values already resolved from portable configuration;
- source commit timestamp used as deterministic fallback metadata.

`MobileCompileResult` contains only:

- content contract version;
- generated timestamp;
- note/section/task/project/event counts;
- diagnostic summaries;
- relative paths of snapshot entry points.

Panics must never cross FFI. Convert every failure into a structured error with
a stable error code and a user-safe message; keep detailed diagnostics available
for an opt-in diagnostics export.

### 6.2 Prove iOS portability before UI implementation

Add and build at least these Rust targets:

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
cargo build --manifest-path native/Cargo.toml \
  -p castle-mobile --target aarch64-apple-ios-sim
cargo build --manifest-path native/Cargo.toml \
  -p castle-mobile --target aarch64-apple-ios
```

The spike must specifically verify:

- `jsonschema`, ICU collation, image decoding, `tempfile`, and `walkdir` build;
- an example library compiles in the iOS Simulator;
- note resources and local image assets can be read from the app container;
- no dependency pulls in desktop-only `castle-index`, `notify`, CLI, or daemon
  behavior;
- the binary is accepted by an Xcode archive without unsupported symbols.

### 6.3 Remove implicit desktop assumptions

The current compiler attempts to execute `git` when deriving stash creation
dates. There is no Git executable inside the iOS app sandbox. Add an explicit
history policy to `CompileOptions`:

```text
RepositoryHistoryPolicy::GitCommand       # existing desktop/CLI behavior
RepositoryHistoryPolicy::Provided(map)    # future GitHub metadata path
RepositoryHistoryPolicy::Unavailable      # mobile v1
```

Mobile uses `Unavailable`; it must not attempt `std::process::Command`.

Likewise, remote compilation must ignore `CONFIGURATION.local.md`. Add an
explicit configuration-loading policy rather than relying on whether that file
happened to be present in an archive.

For notes without `updated`, `modified`, or applicable `date` frontmatter, use
the source commit timestamp as the deterministic mobile fallback instead of the
archive extraction time. Document that this is not per-file Git history. Exact
per-file Git dates can be introduced later through the `Provided(map)` policy.

### 6.4 Add a mobile snapshot profile

Add `SnapshotProfile::MobileReadOnly`. It should emit:

- `generated/bootstrap.json` for fast initial Home rendering;
- `generated/catalog.json` as the complete publication pointer;
- `generated/manifest.json` and content-addressed domain resources;
- `generated/notes/<sha256>.json`;
- `generated/search-index.json`;
- `assets/**` and `content-assets/**` referenced by the library;
- `generated/mobile-profile.json` containing the profile and contract version.

It should not emit or process:

- mutable source documents;
- sheets or canvases;
- desktop service state/deltas;
- semantic indexes or models;
- trash or `.castle` settings;
- generated web routes.

Preserve the current publication rule: write content-addressed resources first
and the catalog/manifest pointer last.

### 6.5 Package an XCFramework

Use UniFFI to generate Swift bindings and package device and simulator static
libraries as `CastleMobileCore.xcframework`. Add one repository command such as:

```sh
cargo xtask build ios-core
```

That command must:

1. build both Apple targets in release mode;
2. generate Swift bindings and module maps;
3. create the XCFramework;
4. place it under an ignored build directory;
5. make the app target consume it through a local Swift package or framework
   reference;
6. support an offline rebuild once dependencies have been fetched.

CI should build the core rather than committing compiled binaries.

## 7. GitHub integration

### 7.1 Authentication design

Production recommendation: a Castle GitHub App plus a minimal auth broker.

Use `ASWebAuthenticationSession` for the authorization UI. The broker owns the
GitHub client secret and performs authorization-code exchange and refresh. Do
not embed a GitHub App private key in the app, and do not put GitHub access or
refresh tokens in callback URLs.

Broker flow:

1. App requests a short-lived authorization session.
2. Broker creates `state` and PKCE values and returns the GitHub authorize URL.
3. GitHub redirects to the broker callback.
4. Broker validates state and exchanges the code.
5. Broker redirects to the app universal link with a one-time opaque ticket.
6. App redeems the ticket over TLS and stores returned tokens in Keychain.
7. Token refresh also goes through the broker because it requires confidential
   GitHub App credentials.

Broker requirements:

- session/ticket TTL no longer than ten minutes;
- one-time ticket redemption;
- no repository contents or note text enters broker logs;
- secrets held only in the deployment secret store;
- rate limiting and state/PKCE validation;
- a privacy policy and account-disconnect behavior before external TestFlight.

To unblock local development, provide a `DEBUG`-only credential adapter that
accepts a fine-grained developer token through a local runtime setting. Never
compile that input UI into Release and never read tokens from checked-in files.

### 7.2 Token storage

- Store access and refresh tokens only in Keychain.
- Use an accessibility class equivalent to `whenUnlockedThisDeviceOnly`.
- Keep account/repository display metadata in normal local persistence; never
  duplicate tokens there.
- Redact `Authorization`, OAuth codes, archive redirect URLs, and tokens from
  logs and diagnostics.
- On disconnect, revoke when supported, remove tokens, cancel sync, and delete
  cached private libraries after user confirmation.

### 7.3 Repository discovery

Using the GitHub App user access token:

1. List app installations accessible to the user.
2. List repositories accessible for each installation, with pagination.
3. Merge by numeric repository ID and show owner/name, visibility, default
   branch, pushed date, and avatar.
4. Do not probe every repository individually while scrolling.
5. When the user selects a repository, inspect and validate it as part of the
   first sync.

The picker supports search and clearly distinguishes already-added libraries.
Version 1 selects the default branch but persists the branch as a first-class
field so branch selection can be added without migrating snapshot identities.

### 7.4 Castle repository detection

Inside the downloaded archive, check in order:

1. `/CONFIGURATION.md`;
2. `/castle/CONFIGURATION.md`;
3. `/library/` fallback when no configuration exists.

For remote repositories, `library.path` and `library.repository_path` must be
relative, normalized, and contained within the archive root. Reject absolute
paths, `..` traversal, symlinks escaping the root, and configuration paths that
cannot be represented inside the downloaded snapshot.

If no valid library is found, keep the repository unadded and show a diagnostic
that explains the expected `CONFIGURATION.md` or `library/` layout.

### 7.5 Archive download

Use GitHub's zip archive endpoint at an immutable commit SHA, not a moving branch
name. The sequence is:

1. Resolve the branch head SHA and commit timestamp.
2. If SHA equals the active local SHA, finish as `upToDate`.
3. Request `zipball/{sha}` and follow GitHub's temporary redirect.
4. Stream the response to a temporary file; do not buffer it in memory.
5. Open the archive with a pinned ZIPFoundation version.
6. Inspect entries before extraction, determine the archive wrapper and Castle
   path, and extract only the portable configuration and required library tree.
7. Compile in staging and atomically publish on success.

Never forward the GitHub authorization header to an unrelated redirect host.
The archive redirect URL is temporary and must not be persisted or logged.

Archive safety limits should be centralized and covered by tests. Proposed v1
defaults:

- 512 MB maximum compressed download;
- 1 GB maximum extracted data;
- 100,000 maximum entries;
- 100 MB maximum individual extracted file;
- no absolute entry paths;
- no path traversal;
- no escaping symlinks or hard links;
- cancellation when the app backgrounds and no protected execution time remains.

Show a preflight warning for unusually large GitHub repositories based on the
repository's reported size. Limits should fail safely without deleting the last
valid generation.

## 8. Local storage and persistence

### 8.1 File layout

```text
Application Support/Castle/
  Accounts/
    account-metadata.json            # never tokens
  Libraries/
    <repository-id>/
      library.json                   # repository/branch configuration
      current.json                   # atomic active-generation pointer
      Generations/
        <commit-sha>/
          repository/                # selected extracted source subtree
          snapshot/
            generated/
            assets/
            content-assets/
      Staging/
        <uuid>/
  Diagnostics/
```

Mark repository and snapshot storage as excluded from iCloud/device backup.
Apply iOS data protection to private content. Keep the active generation and one
previous generation; remove older generations only after a successful publish.

### 8.2 Persisted library model

`LibraryRecord` should contain:

- stable local UUID;
- GitHub account ID and installation ID;
- repository numeric ID, owner, name, visibility, and avatar URL;
- selected branch;
- portable configuration path and resolved library-relative path;
- active commit SHA and commit timestamp;
- current snapshot contract version;
- last successful sync date;
- last observed remote SHA;
- user-facing display name;
- last non-sensitive sync error summary.

Use SwiftData only for small app metadata if desired. Repository sources,
snapshots, note bodies, and search indexes remain ordinary files. The app must be
able to rebuild metadata by scanning `library.json` files if the model store is
lost.

### 8.3 Snapshot reader

`SnapshotStore` is an actor responsible for:

- resolving the current generation once;
- decoding and checking content contract versions;
- loading bootstrap/catalog/domain resources;
- lazily loading note content by its content-addressed `contentPath`;
- caching a bounded number of decoded notes and images;
- invalidating all resource caches when the active generation changes;
- preventing path escape when resolving resource paths.

Views never construct file URLs from raw Markdown strings directly.

## 9. SwiftUI application architecture

### 9.1 State ownership

Use iOS 17 Observation:

- `@State` owns the root `@Observable AppSession`.
- `AppSession` owns authentication state, selected library ID, and high-level
  launch state on `@MainActor`.
- Shared stateless/actor services are installed with typed `@Environment`.
- Feature state remains local unless it must survive navigation.
- Network, extraction, compilation, and file reads execute in actors/services,
  not inside view bodies.
- Views use `.task`/`.task(id:)` with explicit idle, loading, loaded, empty,
  stale, and failed states; cancellation is not presented as an error.

Recommended shared dependencies:

```text
AuthenticationClient
GitHubRepositoryClient
LibraryStore
LibrarySyncCoordinator
SnapshotStoreFactory
SearchServiceFactory
DiagnosticsRecorder
```

All have protocols or lightweight interfaces so previews and tests use local
fixtures without GitHub or Rust.

### 9.2 Navigation

Use four tabs, each with its own `NavigationStack` and route history:

- Home
- Browse
- Search
- Settings

Use a `Hashable` route enum containing identifiers rather than view instances:

```text
note(libraryID, noteID)
folder(libraryID, sectionID, directory)
tasks(libraryID, filter)
task(libraryID, taskID)
projects(libraryID)
project(libraryID, projectID)
agenda(libraryID, date)
people(libraryID)
```

When the selected library changes, reset all tab paths. Use enum-driven sheets
for the library switcher, repository picker, sync diagnostics, image preview,
and account management.

### 9.3 Root states

The root presents exactly one of:

- onboarding/not authenticated;
- authenticated with no libraries;
- first library import in progress;
- ready with cached snapshot;
- cached snapshot plus non-blocking sync warning;
- fatal local-state error with repair/reset actions.

Authentication expiry should not hide a cached library. Keep it readable and
show a reconnect banner; only syncing and adding repositories become unavailable.

## 10. Feature specification

### 10.1 Onboarding and repository picker

- Explain that the first release is read-only and stores an offline copy.
- Show exact GitHub permissions before authorization.
- List repositories from all accessible app installations with pagination.
- Search by owner/name.
- Add one repository at a time, showing Downloading, Inspecting, Compiling, and
  Preparing Library stages.
- Provide actionable invalid-library and unsupported-contract diagnostics.

### 10.2 Home

- Library name, repository owner/name, branch, and sync status.
- Pinned notes.
- Recently modified notes, with the documented commit-time fallback limitation.
- Summary cards for open tasks, active projects, and upcoming events.
- Shortcuts from the Castle snapshot.
- Pull-to-refresh and a library-switcher toolbar action.

### 10.3 Browse

- Sections ordered by the Castle catalog.
- Hierarchical folder browsing using `LibraryFolder` and note paths.
- List rows show title, excerpt, metadata, and optional local thumbnail/avatar.
- Stable note IDs drive navigation and list identity.
- Native list/grid adaptation: list on compact width; optional grid on iPad.

### 10.4 Note detail

- Title, section, tags/status where available, reading time, and modified date.
- GitHub-flavored Markdown body with selectable text.
- Local Castle images with aspect-aware sizing and tap-to-preview.
- Internal Markdown links navigate to Castle notes.
- Same-note anchors scroll when supported by the chosen renderer.
- External HTTPS links use the system browser presentation.
- Table content scrolls horizontally instead of shrinking below readability.
- Code blocks use monospaced text, horizontal scrolling, and Copy.
- Read-only task-list checkboxes have disabled/accessibility semantics.
- Backlinks and related notes appear after the body.
- Person sidebars are represented as native grouped sections, not a narrow
  desktop sidebar.

Use MarkdownUI for the first renderer because it covers GFM tables, task lists,
code blocks, links, and images. Hide it behind `CastleMarkdownView` so it can be
replaced without changing feature screens. Pin the chosen package version after
a renderer parity spike.

Implement Castle links through a virtual content base URL and `OpenURLAction`;
implement images through a dedicated provider that resolves only inside the
active snapshot. Never attach GitHub credentials to arbitrary image requests.

### 10.5 Search

- Load `search-index.json` only when search is first used.
- Normalize and rank locally using the same title/alias/tag/path/content
  priority as desktop.
- Debounce input and cancel stale searches.
- Return note title, match reason, and a short highlighted snippet.
- Include matching folders and app destinations after note-search parity is
  established.
- Cap initial results and keep ranking off the main actor.

Move the desktop ranking rules into shared language-independent fixture vectors
so Swift and TypeScript implementations cannot silently diverge.

### 10.6 Read-only domain views

- Tasks: group by status; filters are local presentation state; controls are
  visibly non-interactive.
- Projects: group by status and show linked tasks, events, and people.
- Calendar: ship an agenda/list view first; month/week grids are follow-up work.
- People: browse person notes and render available sidebar facts/contacts.
- Contacts, email, telephone, maps, and website actions require explicit user
  taps and valid schemes.

## 11. Sync state machine

```text
idle
  -> checkingRemote
      -> upToDate -> idle
      -> downloading
          -> inspecting
              -> extracting
                  -> compiling
                      -> validating
                          -> publishing -> idle
```

Any state may transition to `failed(previousSnapshotAvailable: Bool)`.

Rules:

- One sync per library at a time, serialized by `LibrarySyncCoordinator`.
- A second refresh request coalesces with the active task.
- Switching libraries does not corrupt or reuse another library's actor/cache.
- First import blocks that library's UI; later refreshes leave the old snapshot
  readable.
- Network cancellation removes staging data but leaves active data untouched.
- Compilation diagnostics are stored locally with content redaction and surfaced
  through a user-readable summary.
- Foreground activation may check staleness, but manual refresh is authoritative
  for version 1.
- Background Tasks are deferred until foreground sync is reliable; iOS does not
  guarantee exact background execution time.

## 12. Error model

Define stable error categories and map low-level errors once:

- `authenticationRequired`
- `authorizationDenied`
- `repositoryUnavailable`
- `rateLimited(retryAfter)`
- `networkUnavailable`
- `archiveTooLarge`
- `archiveUnsafe`
- `castleConfigurationMissing`
- `castleConfigurationInvalid`
- `libraryOutsideRepository`
- `castleCompilationFailed`
- `unsupportedContentContract`
- `localStorageFull`
- `snapshotCorrupt`
- `cancelled`
- `unknown(referenceID)`

Every error defines whether retry, reconnect, remove-library, or continue-offline
is appropriate. Do not show raw Rust backtraces or GitHub response bodies in the
primary UI.

## 13. Security and privacy checklist

- Read-only GitHub App permissions verified in automated configuration tests.
- GitHub App private key and OAuth client secret never enter the iOS repository
  or binary.
- Tokens only in Keychain; no tokens in `UserDefaults`, SwiftData, crash labels,
  analytics, screenshots, or logs.
- HTTPS only; no arbitrary server URL entry in version 1.
- Redirect allowlist and cross-host authorization-header tests.
- Archive traversal, symlink, hard-link, decompression-bomb, entry-count, file-
  size, and total-size defenses.
- Remote configuration paths confined to the extracted repository.
- Local resource paths confined to the active snapshot.
- Private cache excluded from backups and protected at rest by iOS data
  protection.
- Remote images never receive GitHub headers or cookies.
- No tracking SDK in the initial release.
- Add and verify `PrivacyInfo.xcprivacy`. Audit the Rust binary and Swift
  dependencies for required-reason APIs; Castle reads file metadata inside its
  app container, so declare the applicable file-timestamp reason.
- Generate an Xcode privacy report before TestFlight/App Store submission.
- Logout/disconnect behavior is explicit about cached private content.

## 14. Testing strategy

### 14.1 Rust tests

- `MobileReadOnly` profile emits only the allowlisted resources.
- Catalog/manifest publication happens last.
- Example library produces stable contract fixtures.
- Mobile history policy never launches `git`.
- Remote mode never reads `CONFIGURATION.local.md`.
- Commit timestamp fallback is deterministic.
- iOS target cross-compiles in CI.
- Panics/errors become safe FFI errors.

### 14.2 Swift unit tests

- GitHub pagination, decoding, rate limits, token expiry, and refresh.
- Repository detection for root config, nested config, fallback library, and
  invalid/escaping paths.
- Archive extraction safety and all size limits.
- Atomic generation publish and rollback after each possible failure stage.
- Contract decoding and unsupported-version behavior.
- Route, relative Markdown link, anchor, and asset resolution using shared
  fixtures.
- Search normalization/ranking parity with desktop fixtures.
- Keychain storage through an injectable test store.
- Error-category mapping without leaking response content.

### 14.3 Integration tests

Maintain fixture archives for:

- `examples/library`;
- `examples/technical-docs` through a dedicated portable config fixture;
- a nested configuration/library;
- an invalid Castle record;
- a Unicode path/link library;
- a large-image library;
- an archive traversal attack;
- an older and newer content contract.

Run download -> extract -> Rust compile -> Swift decode -> note load as one test.
Use a custom `URLProtocol` to make GitHub and archive responses deterministic.

### 14.4 SwiftUI previews and UI tests

Every screen gets fixture-backed previews for loaded, loading, empty, offline,
and failed states. UI tests cover:

- sign-in handoff with a fake authentication client;
- add repository and first sync;
- relaunch offline and read cached content;
- switch between two libraries;
- browse folder -> note -> internal note link -> back;
- search and open a result;
- failed refresh while old content remains visible;
- Dynamic Type accessibility sizes;
- VoiceOver labels/traits for sync, links, disabled task items, and images;
- iPhone compact width, iPad split view, portrait, landscape, light, and dark.

### 14.5 Performance budgets

Set budgets after measuring the example and a synthetic large fixture. Initial
targets on a supported physical device:

- cached app launch to usable Home: under 1 second at p50;
- cached note open: under 200 ms at p50;
- search response after debounce: under 150 ms for 10,000 notes;
- scrolling long notes without sustained visible hitching;
- no full archive or complete note corpus buffered simultaneously;
- compilation memory stays below a measured release gate established in the
  portability spike.

Do not treat Simulator measurements as release evidence.

## 15. Phased execution backlog

Each phase ends in a buildable main branch. Ticket identifiers below are stable
labels for issues/PRs; they need not dictate one PR per item.

### Phase 0: decisions and risk spikes

- **IOS-001** Record the architecture decision: on-device compile, archive sync,
  mobile snapshot, and read-only GitHub App.
- **IOS-002** Cross-compile a minimal `castle_mobile` static library for device
  and Simulator.
- **IOS-003** Invoke the core from a throwaway Swift harness and compile
  `examples/library` in Simulator.
- **IOS-004** Render a representative Castle note using MarkdownUI, including a
  table, task list, code, local image, internal link, and long content.
- **IOS-005** Prototype GitHub archive streaming and safe selective extraction.
- **IOS-006** Decide XcodeGen versus checked-in Xcode project and pin tool/package
  versions.

Exit criteria: an iOS Simulator harness downloads or loads a fixture archive,
invokes Rust, and renders one compiled note. Any unsupported Rust dependency has
a documented replacement before Phase 1.

### Phase 1: mobile core and contracts

- **IOS-101** Add `native/castle_mobile` and UniFFI bindings.
- **IOS-102** Add explicit repository-history and configuration-override
  policies to `CompileOptions`.
- **IOS-103** Add deterministic mobile modified-date fallback.
- **IOS-104** Implement `SnapshotProfile::MobileReadOnly`.
- **IOS-105** Add mobile snapshot privacy/allowlist tests.
- **IOS-106** Add XCFramework packaging and `cargo xtask build ios-core`.
- **IOS-107** Add Swift contract generation or the minimal Codable contract set
  plus golden compatibility tests. Generated contracts are the preferred end
  state.
- **IOS-108** Add CI jobs for Rust iOS targets and Swift binding generation.

Exit criteria: a reproducible command builds the XCFramework, and Swift tests
decode a mobile snapshot generated from the real example library.

### Phase 2: app shell and local fixture mode

- **IOS-201** Scaffold `apps/ios`, signing placeholders, app icon placeholders,
  privacy manifest, unit tests, and UI tests.
- **IOS-202** Implement `AppSession`, dependency graph, four-tab shell, per-tab
  routers, and enum-driven sheets.
- **IOS-203** Implement `LibraryRecord`, `LibraryStore`, cache directories, data
  protection, and backup exclusion.
- **IOS-204** Implement `SnapshotStore` and bounded note-resource cache.
- **IOS-205** Add a development fixture library provider so all UI work can run
  without GitHub.
- **IOS-206** Add loaded/loading/empty/failure components and preview fixtures.

Exit criteria: the app launches from a bundled fixture, restores its last
selected library, and navigates between placeholder feature screens entirely
offline.

### Phase 3: authentication and repository discovery

- **IOS-301** Register/configure the read-only GitHub App.
- **IOS-302** Implement the minimal auth broker and deployment configuration.
- **IOS-303** Implement `ASWebAuthenticationSession` authorization and one-time
  ticket redemption.
- **IOS-304** Implement Keychain token storage, refresh, reconnect, disconnect,
  and redacted logging.
- **IOS-305** Implement paginated installation/repository discovery.
- **IOS-306** Build repository picker/search and already-added states.
- **IOS-307** Add DEBUG-only fine-grained-token adapter to unblock development;
  verify it is absent from Release.

Exit criteria: a Release-configured device build signs in, lists only repositories
available to the app, persists login safely, refreshes tokens, and disconnects.

### Phase 4: repository sync pipeline

- **IOS-401** Resolve default-branch head SHA and commit timestamp.
- **IOS-402** Stream immutable-SHA zip archives with progress and cancellation.
- **IOS-403** Inspect archives and detect portable Castle configuration/library.
- **IOS-404** Implement safe selective extraction and resource limits.
- **IOS-405** Invoke `castle_mobile` off the main actor and collect diagnostics.
- **IOS-406** Validate snapshot contracts and atomically publish generations.
- **IOS-407** Implement sync state machine, coalescing, retry, no-op refresh, and
  stale-cache presentation.
- **IOS-408** Implement cleanup, storage-pressure handling, and previous-
  generation retention.
- **IOS-409** Add pull-to-refresh and foreground staleness checks.

Exit criteria: adding a real private repository produces a readable local
snapshot; airplane-mode relaunch works; a deliberately invalid newer commit
does not replace the old snapshot.

### Phase 5: core reading experience

- **IOS-501** Build Home with pinned/recent items, summaries, shortcuts, and sync
  status.
- **IOS-502** Build section/folder Browse and iPad adaptation.
- **IOS-503** Build Note detail metadata and lazy note loading.
- **IOS-504** Implement GFM renderer theme matching Castle's visual language.
- **IOS-505** Implement internal/external link routing and shared resolution
  fixtures.
- **IOS-506** Implement local/remote image policy, caching, placeholders, and
  full-screen preview.
- **IOS-507** Implement backlinks, related notes, and person fact/contact
  sections.
- **IOS-508** Add content accessibility and long-note performance coverage.

Exit criteria: the `examples/library` feature tour is pleasant and complete on
iPhone and iPad, including links, assets, tables, code, and offline use.

### Phase 6: search and domain views

- **IOS-601** Port search normalization/ranking with cross-platform fixtures.
- **IOS-602** Build debounced Search UI with match reasons/snippets.
- **IOS-603** Build read-only Tasks groups and filters.
- **IOS-604** Build Projects list/detail with linked records.
- **IOS-605** Build Calendar agenda with event/project/person links.
- **IOS-606** Build People browser and person-note presentation.

Exit criteria: notes and the primary structured Castle records are discoverable
and navigable without any mutating control.

### Phase 7: hardening and release

- **IOS-701** Complete archive, path, redirect, token, and log security review.
- **IOS-702** Complete VoiceOver, Dynamic Type, contrast, Reduce Motion, and
  keyboard/iPad review.
- **IOS-703** Measure launch, compile, memory, search, image, and scrolling
  performance on physical devices; fix release-budget regressions.
- **IOS-704** Add structured local diagnostics export with note/token redaction.
- **IOS-705** Finalize privacy manifest, generate Xcode privacy report, and
  prepare App Store privacy answers.
- **IOS-706** Add CI for build, unit/UI tests, archive validation, and unsigned
  Simulator artifact.
- **IOS-707** Test token revocation, GitHub App uninstall, deleted repositories,
  renamed default branches, force pushes, storage exhaustion, and rate limits.
- **IOS-708** Prepare TestFlight metadata, support/privacy URLs, and a rollback
  plan.

Exit criteria: all release checks pass on physical iPhone and iPad, private
content survives normal offline use, and removal/disconnect paths are verified.

## 16. Suggested PR sequence

Keep reviewable vertical increments:

1. Rust iOS portability harness.
2. Mobile compile policy and snapshot profile.
3. UniFFI/XCFramework packaging and CI.
4. SwiftUI shell plus fixture-backed SnapshotStore.
5. Browse and one polished Note screen from bundled fixtures.
6. Safe archive extractor and local end-to-end import.
7. GitHub client plus DEBUG credentials.
8. Auth broker and production authentication.
9. Atomic sync with real repositories and offline restore.
10. Search and remaining domain screens.
11. Security/accessibility/performance hardening.
12. TestFlight release candidate.

Avoid a single PR that combines core portability, OAuth, sync, and all UI. Every
PR after step 3 should include previews or tests that do not require a real
GitHub account.

## 17. Delivery estimate and critical path

For one experienced engineer familiar with SwiftUI and Rust, a realistic first
planning range is 30-45 engineering days to a hardened TestFlight build. A
fixture-backed browsing prototype should appear after roughly 10-15 days.
Authentication infrastructure, Rust cross-compilation surprises, Markdown
parity, and archive/security hardening are the largest uncertainty drivers.

The critical path is:

```text
Rust iOS portability
  -> mobile snapshot + bindings
  -> local snapshot reader
  -> safe repository import
  -> GitHub authentication
  -> real-repository sync
  -> UI completion and hardening
```

Begin UI against fixtures while authentication infrastructure is being prepared,
but do not declare the architecture proven until a real repository compiles on
a physical device.

## 18. Future editing seams retained now

The read-only app should preserve these invariants for the editing release:

- `LibraryRecord` stores branch and exact base commit SHA.
- Every note retains stable note ID and `sourceFile`.
- The extracted raw repository generation is kept alongside compiled output.
- Swift views depend on read protocols rather than GitHub response models.
- Sync state is serialized per library.
- Core semantics and validation stay in Rust.
- The GitHub client is isolated behind a protocol that can later add blob/tree/
  commit/ref operations.
- Snapshot publication remains atomic.

The future editing flow can then introduce a writable overlay, drafts, Castle
validation, Git blob/tree/commit creation, and conditional branch-ref update
against the recorded base SHA. None of those responsibilities belong in the
read-only implementation.

## 19. Definition of done

The read-only release is done when all of the following are true:

- A user can authenticate without any secret embedded in the app binary.
- The GitHub App has only metadata-read and contents-read permissions.
- A user can add, remove, and switch among multiple Castle repositories.
- A repository is always read at a recorded immutable commit SHA.
- Root, nested, and fallback Castle library layouts are handled safely.
- The canonical Rust compiler runs on a physical iOS device.
- A failed refresh never removes the last valid local snapshot.
- Cached content is usable after relaunch in airplane mode.
- Notes render GFM, local images, internal links, backlinks, and related notes.
- Browse, local search, Tasks, Projects, Agenda, and People are usable.
- No control mutates local source or remote GitHub state.
- Authentication expiry leaves cached content readable.
- Archive and local path traversal tests pass.
- Tokens and private note content do not appear in diagnostics.
- Accessibility and performance budgets pass on supported devices.
- Privacy manifest/report and TestFlight release checklist are complete.

## 20. External references

- GitHub App user authentication and token behavior:
  <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app>
- GitHub repository archive endpoints and read permission:
  <https://docs.github.com/en/rest/repos/contents>
- GitHub App installations and repository discovery:
  <https://docs.github.com/en/rest/apps/installations>
- Apple web authentication sessions:
  <https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession>
- Apple Background Tasks limitations and strategies:
  <https://developer.apple.com/documentation/backgroundtasks>
- Apple privacy manifests and required-reason APIs:
  <https://developer.apple.com/documentation/bundleresources/privacy-manifest-files>
- UniFFI Swift bindings:
  <https://mozilla.github.io/uniffi-rs/latest/>
- ZIPFoundation:
  <https://github.com/weichsel/ZIPFoundation>
- MarkdownUI:
  <https://github.com/gonzalezreal/swift-markdown-ui>
