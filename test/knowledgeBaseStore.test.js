import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeKnowledgeBase,
  normalizeKnowledgeBase,
  reduceKnowledgeBase,
} from "../apps/desktop/src/app/knowledge_base_store.tsx";

test("keeps normalized entity order authoritative across deltas", () => {
  const initial = emptyKnowledgeBase("2026-08-03T10:00:00.000Z");
  initial.tasks = [task("first", "todo"), task("second", "todo")];
  const state = reduceKnowledgeBase(normalizeKnowledgeBase(initial), {
    type: "applyDelta",
    delta: {
      contractVersion: 2,
      generatedAt: "2026-08-03T11:00:00.000Z",
      sections: [],
      folders: [],
      notes: { upserted: [], removedIds: [] },
      tasks: {
        upserted: [task("first", "done"), task("third", "todo")],
        removedIds: ["second"],
        orderedIds: ["third", "first"],
      },
      projects: { upserted: [], removedIds: [] },
      calendarEvents: { upserted: [], removedIds: [] },
      shortcutCollections: [],
      mutableResourcePaths: [],
    },
  });

  assert.deepEqual(
    materializeKnowledgeBase(state).tasks.map(({ id, status }) => ({ id, status })),
    [
      { id: "third", status: "todo" },
      { id: "first", status: "done" },
    ],
  );
});

test("ignores snapshots older than the authoritative renderer state", () => {
  const current = emptyKnowledgeBase("2026-08-03T11:00:00.000Z");
  current.tasks = [task("current", "todo")];
  const stale = emptyKnowledgeBase("2026-08-03T10:00:00.000Z");
  stale.tasks = [task("stale", "todo")];

  const state = reduceKnowledgeBase(normalizeKnowledgeBase(current), {
    type: "replaceSnapshot",
    snapshot: stale,
  });

  assert.deepEqual(materializeKnowledgeBase(state).tasks.map(({ id }) => id), [
    "current",
  ]);
});

function task(id, status) {
  return {
    id,
    noteId: id,
    route: `/note/tasks/${id}`,
    title: id,
    description: id,
    status,
    targetDate: "",
    targetTime: "",
    estimateMinutes: 0,
    createdAt: "",
    completedAt: status === "done" ? "2026-08-03" : "",
    sortOrder: 1000,
    modifiedAt: "2026-08-03T00:00:00.000Z",
    tags: [],
    people: [],
    project: null,
    subtasks: [],
  };
}

function emptyKnowledgeBase(generatedAt) {
  return {
    contractVersion: 2,
    generatedAt,
    sections: [],
    folders: [],
    notes: [],
    calendarEvents: [],
    tasks: [],
    projects: [],
    shortcutCollections: [],
  };
}
