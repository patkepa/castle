import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesShortcut,
  settingsShortcutIds,
  shortcutCatalog,
  shortcutDisplayText,
} from "../apps/desktop/src/keyboard/shortcut_catalog.ts";

test("matches platform search bindings without swallowing extra modifiers", () => {
  assert.equal(matchesShortcut(keyEvent("k", { metaKey: true }), "search"), true);
  assert.equal(matchesShortcut(keyEvent("K", { ctrlKey: true }), "search"), true);
  assert.equal(
    matchesShortcut(
      keyEvent("k", { ctrlKey: true, shiftKey: true }),
      "search",
    ),
    false,
  );
});

test("keeps task search scoped to the unmodified slash key", () => {
  assert.equal(matchesShortcut(keyEvent("/"), "tasksSearch"), true);
  assert.equal(
    matchesShortcut(keyEvent("/", { metaKey: true }), "tasksSearch"),
    false,
  );
});

test("matches playlist fullscreen on the unmodified F key", () => {
  assert.equal(matchesShortcut(keyEvent("f"), "playlistFullscreen"), true);
  assert.equal(matchesShortcut(keyEvent("F"), "playlistFullscreen"), true);
  assert.equal(
    matchesShortcut(keyEvent("f", { metaKey: true }), "playlistFullscreen"),
    false,
  );
});

test("drives settings labels and display keys from the shortcut catalog", () => {
  assert.deepEqual(
    settingsShortcutIds.map((id) => shortcutCatalog[id].label),
    ["Search", "Sidebar", "Castle AI", "Focus sidebar", "Move focus region"],
  );
  assert.equal(shortcutDisplayText("search"), "⌘K");
  assert.equal(shortcutCatalog.sidebar.ariaKeyShortcuts, "Meta+B Control+B");
});

function keyEvent(key, overrides = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}
