import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readUserPreferences,
  userPreferencesPath,
  writeUserPreferences,
} from "../apps/desktop/electron/user_preferences.ts";

const preferences = {
  schemaVersion: 1,
  sidebarCollapsed: true,
  autoHideSidebar: true,
  hiddenNavigationTabs: ["calendar"],
  sidebarNoteView: "pinned",
  pinnedNoteIds: ["note_first", "note_second"],
  pinnedFolderRoutes: ["/browse/wiki/travel"],
  libraryViewMode: "grid",
  taskViewMode: "kanban",
  taskGroups: { personal: ["Home", "Work"] },
  taskProjectFolders: [{ id: "folder_work", title: "Work", projectIds: ["project_castle"] }],
  taskProjectOrder: ["project_castle"],
  readingProgress: false,
  tableOfContents: true,
};

test("stores interface preferences as readable TOML inside the library", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "castle-preferences-"));
  const libraryRoot = path.join(temporaryRoot, "library");
  try {
    mkdirSync(libraryRoot);
    writeUserPreferences(libraryRoot, preferences);

    const settingsPath = userPreferencesPath(libraryRoot);
    const source = readFileSync(settingsPath, "utf8");
    assert.match(settingsPath, /library\/.castle\/settings\.toml$/);
    assert.match(source, /pinned_note_ids = \["note_first","note_second"\]/);
    assert.match(source, /auto_hide_sidebar = true/);
    assert.match(source, /pinned_folder_routes = \["\/browse\/wiki\/travel"\]/);
    assert.match(source, /\[task_groups\]/);
    assert.match(source, /task_project_folders = \[{"id":"folder_work"/);
    assert.match(source, /task_project_order = \["project_castle"\]/);
    assert.deepEqual(readUserPreferences(libraryRoot), preferences);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("ignores malformed preference files instead of failing Castle startup", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "castle-preferences-"));
  const libraryRoot = path.join(temporaryRoot, "library");
  try {
    mkdirSync(path.join(libraryRoot, ".castle"), { recursive: true });
    writeFileSync(userPreferencesPath(libraryRoot), "sidebar_collapsed = maybe\n");
    assert.equal(readUserPreferences(libraryRoot), null);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("loads older preference files without folder pins", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "castle-preferences-"));
  const libraryRoot = path.join(temporaryRoot, "library");
  try {
    mkdirSync(path.join(libraryRoot, ".castle"), { recursive: true });
    writeFileSync(
      userPreferencesPath(libraryRoot),
      [
        "schema_version = 1",
        "sidebar_collapsed = false",
        "hidden_navigation_tabs = []",
        'sidebar_note_view = "recent"',
        "pinned_note_ids = []",
        'library_view_mode = "list"',
        'task_view_mode = "list"',
        "reading_progress = true",
        "table_of_contents = true",
        "",
        "[task_groups]",
      ].join("\n"),
    );

    const stored = readUserPreferences(libraryRoot);
    assert.deepEqual(stored?.pinnedFolderRoutes, []);
    assert.equal(stored?.autoHideSidebar, false);
    assert.deepEqual(stored?.taskProjectFolders, []);
    assert.deepEqual(stored?.taskProjectOrder, []);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
