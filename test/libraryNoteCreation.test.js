import assert from "node:assert/strict";
import test from "node:test";
import {
  createLibraryNoteSourceInput,
  noteStem,
} from "../apps/desktop/src/features/library/libraryNoteCreation.ts";

test("creates a Markdown note in the selected Library folder", () => {
  assert.deepEqual(
    createLibraryNoteSourceInput(
      "  Project planning  ",
      "notes",
      ["work"],
      new Set(),
    ),
    {
      noteId: "notes/work/project_planning",
      sourceFile: "notes/work/project_planning.md",
      markdown: "# Project planning\n",
    },
  );
});

test("preserves Polish letters and adds a stable collision suffix", () => {
  assert.deepEqual(
    createLibraryNoteSourceInput(
      "Zażółć gęślą jaźń",
      "notes",
      [],
      new Set(["notes/zażółć_gęślą_jaźń.md"]),
    ),
    {
      noteId: "notes/zażółć_gęślą_jaźń_2",
      sourceFile: "notes/zażółć_gęślą_jaźń_2.md",
      markdown: "# Zażółć gęślą jaźń\n",
    },
  );
});

test("rejects note titles without a usable filename", () => {
  assert.equal(noteStem("A note: 2026"), "a_note_2026");
  assert.throws(
    () => createLibraryNoteSourceInput("---", "notes", [], new Set()),
    /at least one letter or number/u,
  );
});
