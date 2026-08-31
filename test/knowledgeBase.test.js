import assert from "node:assert/strict";
import test from "node:test";
import { validateKnowledgeBase } from "../apps/desktop/src/lib/generatedData.ts";
import { fetchKnowledgeBase } from "../apps/desktop/src/lib/knowledgeBase.ts";

test("loads the generated knowledge-base catalog", async () => {
  const catalog = emptyCatalog();
  const result = await fetchKnowledgeBase(async (url) => {
    assert.equal(url, "/generated/catalog.json");
    return new Response(JSON.stringify(catalog));
  });

  assert.deepEqual(result, catalog);
});

test("rejects malformed nested catalog records", () => {
  const catalog = emptyCatalog();
  catalog.tasks.push({ id: "task_missing_required_fields" });

  assert.throws(
    () => validateKnowledgeBase(catalog),
    /Task 0 noteId must be a string/,
  );
});

test("reports a failed catalog response", async () => {
  await assert.rejects(
    fetchKnowledgeBase(async () => new Response("", { status: 503 })),
    /catalog returned 503/,
  );
});

function emptyCatalog() {
  return {
    contractVersion: 2,
    generatedAt: "2026-07-31T00:00:00.000Z",
    sections: [],
    folders: [],
    notes: [],
    calendarEvents: [],
    tasks: [],
    projects: [],
    shortcutCollections: [],
  };
}
