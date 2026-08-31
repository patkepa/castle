import assert from "node:assert/strict";
import test from "node:test";
import { getDirectoryContents, getPinnedFolder } from "../apps/desktop/src/lib/libraryPaths.ts";

const sections = [{ id: "wiki", label: "Wiki" }];
const notes = [
  { section: "wiki", relativePath: "travel/italy/guide.md" },
];

test("resolves a pinned folder label from its Library route", () => {
  assert.deepEqual(
    getPinnedFolder("/browse/wiki/travel", sections, notes),
    {
      label: "Wiki / Travel",
      route: "/browse/wiki/travel",
    },
  );
});

test("omits pinned folders that no longer exist", () => {
  assert.equal(
    getPinnedFolder("/browse/wiki/archive", sections, notes),
    null,
  );
});

test("keeps an empty indexed folder visible and pinnable", () => {
  const folders = [{
    sectionId: "wiki",
    directory: ["archive"],
    entryCount: 0,
    noteCount: 0,
  }];
  assert.deepEqual(getDirectoryContents([], [], folders).folders, [{
    name: "archive",
    notes: [],
    entryCount: 0,
  }]);
  assert.deepEqual(
    getPinnedFolder("/browse/wiki/archive", sections, notes, folders),
    {
      label: "Wiki / Archive",
      route: "/browse/wiki/archive",
    },
  );
});
