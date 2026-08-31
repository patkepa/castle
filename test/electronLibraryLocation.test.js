import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isLibraryContentPath,
  libraryCacheKey,
  readDesktopSettings,
  rememberDesktopLibrary,
  repositoryRootForLibrary,
  resolveDesktopDataRoot,
  resolveSelectedLibraryRoot,
  writeDesktopSettings,
} from "../apps/desktop/electron/library_location.ts";

test("accepts either a Castle repository or its library directory", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "castle-library-"));
  const libraryRoot = path.join(temporaryRoot, "library");

  try {
    mkdirSync(path.join(libraryRoot, "notes"), { recursive: true });
    const canonicalLibraryRoot = realpathSync(libraryRoot);
    assert.equal(resolveSelectedLibraryRoot(temporaryRoot), canonicalLibraryRoot);
    assert.equal(resolveSelectedLibraryRoot(libraryRoot), canonicalLibraryRoot);
    assert.equal(resolveSelectedLibraryRoot(path.join(temporaryRoot, "missing")), null);
    assert.equal(
      repositoryRootForLibrary(canonicalLibraryRoot),
      path.dirname(canonicalLibraryRoot),
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("persists versioned desktop settings atomically", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "castle-settings-"));
  const libraryRoot = path.join(temporaryRoot, "library");
  const settingsPath = path.join(temporaryRoot, "settings", "castle.json");

  try {
    mkdirSync(path.join(libraryRoot, "wiki"), { recursive: true });
    const settings = rememberDesktopLibrary(
      {
        schemaVersion: 2,
        activeLibraryRoot: null,
        recentLibraryRoots: [],
      },
      libraryRoot,
    );
    writeDesktopSettings(settingsPath, settings);

    assert.deepEqual(readDesktopSettings(settingsPath), {
      schemaVersion: 2,
      activeLibraryRoot: realpathSync(libraryRoot),
      recentLibraryRoots: [realpathSync(libraryRoot)],
    });
    assert.doesNotThrow(() => JSON.parse(readFileSync(settingsPath, "utf8")));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("migrates the original single-library setting and keeps unavailable recents", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "castle-migration-"));
  const libraryRoot = path.join(temporaryRoot, "library");
  const missingRoot = path.join(temporaryRoot, "missing-library");
  const legacySettingsPath = path.join(temporaryRoot, "legacy.json");
  const recentSettingsPath = path.join(temporaryRoot, "recent.json");

  try {
    mkdirSync(path.join(libraryRoot, "notes"), { recursive: true });
    writeFileSync(
      legacySettingsPath,
      JSON.stringify({ schemaVersion: 1, libraryRoot }),
    );
    assert.deepEqual(readDesktopSettings(legacySettingsPath), {
      schemaVersion: 2,
      activeLibraryRoot: realpathSync(libraryRoot),
      recentLibraryRoots: [realpathSync(libraryRoot)],
    });

    writeFileSync(
      recentSettingsPath,
      JSON.stringify({
        schemaVersion: 2,
        activeLibraryRoot: missingRoot,
        recentLibraryRoots: [missingRoot, libraryRoot],
      }),
    );
    assert.deepEqual(readDesktopSettings(recentSettingsPath), {
      schemaVersion: 2,
      activeLibraryRoot: null,
      recentLibraryRoots: [missingRoot, realpathSync(libraryRoot)],
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("remembers multiple libraries in most-recent order and scopes their caches", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "castle-recents-"));
  const firstLibrary = path.join(temporaryRoot, "first", "library");
  const secondLibrary = path.join(temporaryRoot, "second", "library");

  try {
    mkdirSync(path.join(firstLibrary, "wiki"), { recursive: true });
    mkdirSync(path.join(secondLibrary, "tasks"), { recursive: true });
    const initialSettings = {
      schemaVersion: 2,
      activeLibraryRoot: null,
      recentLibraryRoots: [],
    };
    const withFirst = rememberDesktopLibrary(initialSettings, firstLibrary);
    const withSecond = rememberDesktopLibrary(withFirst, secondLibrary);
    const reopenedFirst = rememberDesktopLibrary(withSecond, firstLibrary);

    assert.deepEqual(reopenedFirst.recentLibraryRoots, [
      realpathSync(firstLibrary),
      realpathSync(secondLibrary),
    ]);
    assert.equal(reopenedFirst.activeLibraryRoot, realpathSync(firstLibrary));
    assert.notEqual(
      libraryCacheKey(firstLibrary),
      libraryCacheKey(secondLibrary),
    );
    assert.equal(libraryCacheKey(firstLibrary).length, 24);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("filters hidden and out-of-library watcher paths", () => {
  const libraryRoot = path.resolve("/vault/library");
  assert.equal(
    isLibraryContentPath(libraryRoot, path.join(libraryRoot, "notes", "one.md")),
    true,
  );
  assert.equal(
    isLibraryContentPath(libraryRoot, path.join(libraryRoot, ".obsidian", "app.json")),
    false,
  );
  assert.equal(
    isLibraryContentPath(libraryRoot, path.resolve("/vault/private.md")),
    false,
  );
});

test("uses an absolute test data root without changing the normal default", () => {
  assert.equal(
    resolveDesktopDataRoot("/users/example/application-data"),
    path.join("/users/example/application-data", "castle_data"),
  );
  assert.equal(
    resolveDesktopDataRoot(
      "/users/example/application-data",
      "/private/tmp/castle-test",
    ),
    "/private/tmp/castle-test",
  );
  assert.equal(
    resolveDesktopDataRoot("/users/example/application-data", "relative/path"),
    path.join("/users/example/application-data", "castle_data"),
  );
});
