import assert from "node:assert/strict";
import test from "node:test";
import {
  builtInDocumentDefinitionList,
  builtInDocumentDefinitions,
  isBuiltInDocumentRoute,
} from "../apps/desktop/src/lib/builtInDocumentManifest.ts";

test("gives built-in documents stable note routes and library override paths", () => {
  assert.deepEqual(
    builtInDocumentDefinitionList.map((document) => ({
      id: document.id,
      override: document.overrideSourceFile,
      route: document.route,
    })),
    [
      {
        id: "notes/castle_help",
        override: "notes/castle_help.md",
        route: "/note/notes/castle_help",
      },
    ],
  );
  assert.equal(builtInDocumentDefinitions.markdown_help.pinned, false);
});

test("recognizes only registered built-in note routes", () => {
  assert.equal(isBuiltInDocumentRoute("/note/notes/castle_help"), true);
  assert.equal(isBuiltInDocumentRoute("/note/wiki/example"), false);
});
