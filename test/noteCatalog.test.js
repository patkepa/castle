import assert from "node:assert/strict";
import test from "node:test";
import { latestModifiedAt } from "../apps/desktop/src/lib/noteCatalog.ts";

test("finds the latest note timestamp without mutating the catalog", () => {
  const notes = [
    { modifiedAt: "2026-01-01T00:00:00.000Z" },
    { modifiedAt: "2026-07-31T00:00:00.000Z" },
    { modifiedAt: "2026-04-01T00:00:00.000Z" },
  ];
  const originalOrder = [...notes];

  assert.equal(latestModifiedAt(notes), "2026-07-31T00:00:00.000Z");
  assert.deepEqual(notes, originalOrder);
  assert.equal(latestModifiedAt([]), "");
});
