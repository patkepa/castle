import assert from "node:assert/strict";
import test from "node:test";
import {
  movePinnedNoteBy,
  parsePinnedNoteIds,
  parseSidebarNoteView,
  reorderPinnedNoteIds,
} from "../src/lib/sidebarNotePreferences.ts";

test("loads only recognized sidebar note views", () => {
  assert.equal(parseSidebarNoteView("pinned"), "pinned");
  assert.equal(parseSidebarNoteView("recent"), "recent");
  assert.equal(parseSidebarNoteView("future-view"), "recent");
  assert.equal(parseSidebarNoteView(null), "recent");
});

test("loads unique valid pinned note ids", () => {
  assert.deepEqual(
    parsePinnedNoteIds('["note_a","note_b","note_a",4,"note_c"]'),
    ["note_a", "note_b", "note_c"],
  );
  assert.deepEqual(parsePinnedNoteIds("not-json"), []);
  assert.deepEqual(parsePinnedNoteIds('{"note_a":true}'), []);
});

test("reorders pinned notes by drag target", () => {
  assert.deepEqual(
    reorderPinnedNoteIds(["a", "b", "c"], "a", "b"),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    reorderPinnedNoteIds(["a", "b", "c"], "c", "a"),
    ["c", "a", "b"],
  );
});

test("moves pinned notes one position for keyboard reordering", () => {
  assert.deepEqual(movePinnedNoteBy(["a", "b", "c"], "b", -1), [
    "b",
    "a",
    "c",
  ]);
  assert.deepEqual(movePinnedNoteBy(["a", "b", "c"], "b", 1), [
    "a",
    "c",
    "b",
  ]);
  assert.deepEqual(movePinnedNoteBy(["a", "b", "c"], "a", -1), [
    "a",
    "b",
    "c",
  ]);
});
