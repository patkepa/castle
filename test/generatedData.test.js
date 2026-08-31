import assert from "node:assert/strict";
import test from "node:test";
import {
  announceGeneratedContentChange,
  applyKnowledgeBaseDelta,
  fetchGeneratedJson,
  invalidateGeneratedResource,
  validateNoteContent,
  validateSearchIndex,
} from "../apps/desktop/src/lib/generatedData.ts";

test("validates generated resources before exposing them", async () => {
  await assert.rejects(
    fetchGeneratedJson("/generated/search-index.json", validateSearchIndex, {
      fetchImpl: async () => new Response(JSON.stringify({ entries: [] })),
      label: "Search index",
    }),
    /generatedAt must be a string/,
  );
});

test("deduplicates generated resource requests and supports invalidation", async () => {
  let requestCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({
      id: "note",
      content: "Body",
      headings: [],
      outgoingNoteIds: [],
      backlinkNoteIds: [],
      backlinks: [],
      relatedNoteIds: [],
    }));
  };

  try {
    const path = "/generated/notes/cache-test.json";
    await Promise.all([
      fetchGeneratedJson(path, validateNoteContent),
      fetchGeneratedJson(path, validateNoteContent),
    ]);
    assert.equal(requestCount, 1);
    invalidateGeneratedResource(path);
    await fetchGeneratedJson(path, validateNoteContent);
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("content changes invalidate manifests but retain content-addressed notes", async () => {
  let requestCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path) => {
    requestCount += 1;
    return new Response(JSON.stringify({
      id: String(path),
      content: "Body",
      headings: [],
      outgoingNoteIds: [],
      backlinkNoteIds: [],
      backlinks: [],
      relatedNoteIds: [],
    }));
  };

  try {
    const mutablePath = "/generated/current-note.json";
    const immutablePath = `/generated/notes/${"a".repeat(64)}.json`;
    const immutableDomainPath = `/generated/domains/tasks-${"b".repeat(64)}.json`;
    await fetchGeneratedJson(mutablePath, validateNoteContent);
    await fetchGeneratedJson(immutablePath, validateNoteContent);
    await fetchGeneratedJson(immutableDomainPath, validateNoteContent);
    announceGeneratedContentChange();
    await fetchGeneratedJson(mutablePath, validateNoteContent);
    await fetchGeneratedJson(immutablePath, validateNoteContent);
    await fetchGeneratedJson(immutableDomainPath, validateNoteContent);
    assert.equal(requestCount, 4);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateGeneratedResource("/generated/current-note.json");
    invalidateGeneratedResource(`/generated/notes/${"a".repeat(64)}.json`);
    invalidateGeneratedResource(`/generated/domains/tasks-${"b".repeat(64)}.json`);
  }
});

test("content changes can invalidate only affected mutable resources", async () => {
  let requestCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path) => {
    requestCount += 1;
    return new Response(JSON.stringify({
      id: String(path),
      content: "Body",
      headings: [],
      outgoingNoteIds: [],
      backlinkNoteIds: [],
      backlinks: [],
      relatedNoteIds: [],
    }));
  };

  const first = "/generated/first.json";
  const second = "/generated/second.json";
  try {
    await fetchGeneratedJson(first, validateNoteContent);
    await fetchGeneratedJson(second, validateNoteContent);
    announceGeneratedContentChange([first]);
    await fetchGeneratedJson(first, validateNoteContent);
    await fetchGeneratedJson(second, validateNoteContent);
    assert.equal(requestCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateGeneratedResource(first);
    invalidateGeneratedResource(second);
  }
});

test("applies validated catalog entity deltas without refetching the catalog", () => {
  const current = emptyCatalog();
  current.tasks = [task("first", "todo"), task("second", "todo")];
  const updated = applyKnowledgeBaseDelta(current, {
    contractVersion: 2,
    generatedAt: "2026-08-03T12:00:00.000Z",
    sections: [],
    folders: [],
    notes: { upserted: [], removedIds: [] },
    tasks: {
      upserted: [task("first", "done")],
      removedIds: [],
      orderedIds: ["second", "first"],
    },
    projects: { upserted: [], removedIds: [] },
    calendarEvents: { upserted: [], removedIds: [] },
    shortcutCollections: [],
    mutableResourcePaths: [],
  });

  assert.equal(updated.generatedAt, "2026-08-03T12:00:00.000Z");
  assert.deepEqual(updated.tasks.map(({ id, status }) => ({ id, status })), [
    { id: "second", status: "todo" },
    { id: "first", status: "done" },
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

function emptyCatalog() {
  return {
    contractVersion: 2,
    generatedAt: "2026-08-03T00:00:00.000Z",
    sections: [],
    folders: [],
    notes: [],
    calendarEvents: [],
    tasks: [],
    projects: [],
    shortcutCollections: [],
  };
}
