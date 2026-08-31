import assert from "node:assert/strict";
import test from "node:test";
import { createFolderRoute } from "../apps/desktop/src/lib/libraryPaths.ts";

test("routes the Stash library folder", () => {
  assert.equal(createFolderRoute("stash"), "/browse/stash");
});
