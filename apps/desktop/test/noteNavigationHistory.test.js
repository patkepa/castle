import assert from "node:assert/strict";
import test from "node:test";
import {
  addNoteJump,
  getPreviousNoteJumps,
} from "../src/lib/noteNavigationHistory.ts";

test("records note jumps without duplicating the current note", () => {
  const history = ["/note/one"];

  assert.equal(addNoteJump(history, "/note/one"), history);
  assert.deepEqual(addNoteJump(history, "/note/two"), [
    "/note/one",
    "/note/two",
  ]);
});

test("returns recent unique destinations with their jump indices", () => {
  const history = [
    "/note/one",
    "/note/two",
    "/note/one",
    "/note/three",
  ];

  assert.deepEqual(getPreviousNoteJumps(history), [
    { historyIndex: 2, route: "/note/one" },
    { historyIndex: 1, route: "/note/two" },
  ]);
});

test("caps the number of destinations shown in the popover", () => {
  const history = Array.from({ length: 12 }, (_, index) => `/note/${index}`);

  assert.equal(getPreviousNoteJumps(history, 4).length, 4);
});
