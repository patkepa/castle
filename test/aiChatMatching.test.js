import assert from "node:assert/strict";
import test from "node:test";
import {
  findMatchingCommands,
  findMatchingNotes,
  formatNoteLocation,
  getCommandQuery,
  getMentionQuery,
} from "../apps/desktop/src/components/ai-chat/aiChatMatching.ts";

const notes = [
  note("health", "Health goals", "personal/health/goals.md", "Personal"),
  note("plan", "Morgan Plan", "wiki/planning/morgan_plan.md", "Wiki"),
  note("person", "Alex Morgan", "alex_morgan.md", "People"),
];

test("opens mention and command menus only for a trailing trigger", () => {
  assert.equal(getMentionQuery("Ask @hea"), "hea");
  assert.equal(getMentionQuery("Ask @health goals"), null);
  assert.equal(getCommandQuery("/sea"), "sea");
  assert.equal(getCommandQuery("/search health"), null);
});

test("fuzzy note picker favors a title match and omits attached notes", () => {
  assert.deepEqual(
    findMatchingNotes(notes, "morgan", []).map((note) => note.id),
    ["plan", "person"],
  );
  assert.deepEqual(
    findMatchingNotes(notes, "health", [notes[0]]),
    [],
  );
});

test("exposes local commands and compact note locations", () => {
  assert.deepEqual(
    findMatchingCommands("sum").map((command) => command.id),
    ["summarize"],
  );
  assert.equal(formatNoteLocation(notes[0]), "Personal / health");
  assert.equal(formatNoteLocation(notes[2]), "People");
});

function note(id, title, relativePath, sectionLabel) {
  return { id, title, relativePath, sectionLabel, section: sectionLabel.toLowerCase() };
}
