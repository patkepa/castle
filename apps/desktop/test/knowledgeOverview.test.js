import assert from "node:assert/strict";
import test from "node:test";
import { parseCastleKnowledgeOverview } from "../src/platform/knowledge_queries.ts";

test("validates typed SQL-backed knowledge overview responses", () => {
  const overview = parseCastleKnowledgeOverview({
    generation: "generation-1",
    sourceFingerprint: "fingerprint-1",
    notes: { total: 10, wordCount: 500, readingMinutes: 3 },
    links: 20,
    chunks: 12,
    embeddedChunks: 0,
    entities: [
      {
        kind: "task",
        total: 2,
        statuses: [{ label: "todo", count: 2 }],
      },
    ],
  });
  assert.equal(overview.entities[0].statuses[0].count, 2);
  assert.throws(
    () =>
      parseCastleKnowledgeOverview({
        ...overview,
        notes: { ...overview.notes, total: -1 },
      }),
    /invalid knowledge-overview response/u,
  );
  assert.throws(
    () =>
      parseCastleKnowledgeOverview({
        ...overview,
        entities: [{ kind: "task", total: 2, statuses: [{ label: "todo" }] }],
      }),
    /invalid knowledge-overview response/u,
  );
});
