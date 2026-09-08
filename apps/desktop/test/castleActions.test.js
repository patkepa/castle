import assert from "node:assert/strict";
import test from "node:test";
import {
  rankCastleActions,
  readRecentCastleActionIds,
  recordRecentCastleAction,
} from "../src/features/castle_actions/castleActionModels.ts";
import {
  createJournalSourceInput,
  createPersonSourceInput,
  createQuickTaskFields,
} from "../src/lib/castleActionCreation.ts";

const actions = [
  {
    id: "capture-stash",
    label: "Capture to Stash",
    description: "Save a thought.",
    icon: "inbox",
    keywords: ["quick capture", "inbox"],
    execute: () => {},
  },
  {
    id: "create-task",
    label: "Create task",
    description: "Add work.",
    icon: "tick-circle",
    keywords: ["todo"],
    execute: () => {},
  },
];

test("ranks Castle Actions by labels and keywords", () => {
  assert.deepEqual(
    rankCastleActions("create", actions).map((action) => action.id),
    ["create-task"],
  );
  assert.deepEqual(
    rankCastleActions("quick inbox", actions).map((action) => action.id),
    ["capture-stash"],
  );
});

test("stores recently used actions in most-recent order", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let recent = recordRecentCastleAction("create-task", [], storage);
  recent = recordRecentCastleAction("capture-stash", recent, storage);
  recent = recordRecentCastleAction("create-task", recent, storage);

  assert.deepEqual(recent, ["create-task", "capture-stash"]);
  assert.deepEqual(readRecentCastleActionIds(storage), recent);
});

test("builds minimal validated task, person, and journal inputs", () => {
  assert.deepEqual(createQuickTaskFields("  Call Alex  "), {
    title: "Call Alex",
    description: "",
    status: "todo",
    targetDate: "",
    targetTime: "",
    estimateMinutes: 0,
    projectId: "",
    peopleIds: [],
    tags: [],
  });

  const person = createPersonSourceInput(
    "Jan Kowalski",
    new Set(["person_jan_kowalski"]),
  );
  assert.equal(person.noteId, "person_jan_kowalski_2");
  assert.equal(person.sourceFile, "people/jan_kowalski_2.md");
  assert.match(person.markdown, /type: person/u);
  assert.match(person.markdown, /name: "Jan Kowalski"/u);

  assert.deepEqual(createJournalSourceInput("2026-08-20"), {
    noteId: "journal/2026/2026-08-20",
    sourceFile: "journal/2026/2026-08-20.md",
    markdown: "# 2026-08-20\n\n",
  });
});
