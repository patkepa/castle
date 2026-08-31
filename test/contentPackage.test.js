import assert from "node:assert/strict";
import test from "node:test";
import {
  noteRoutePath,
  resolveMarkdownAsset,
  resolveMarkdownLink,
  withBase,
} from "@castle/content";

const source = {
  id: "source",
  route: "/note/notes/source",
  sourceFile: "notes/guides/source.md",
};
const target = {
  id: "target",
  route: "/note/notes/target",
  sourceFile: "notes/target.md",
};

test("shared content helpers resolve the same note links for web and desktop", () => {
  const notesBySource = new Map([[target.sourceFile, target]]);

  assert.equal(
    resolveMarkdownLink(source, "../target.md#Next Steps", notesBySource),
    "/note/notes/target#next-steps",
  );
  assert.equal(resolveMarkdownLink(source, "https://example.com", notesBySource), "https://example.com");
});

test("shared content helpers resolve portable assets and deployment routes", () => {
  assert.equal(
    resolveMarkdownAsset(source, "../images/castle.png"),
    "/content-assets/notes/images/castle.png",
  );
  assert.equal(noteRoutePath(target), "notes/target");
  assert.equal(withBase(target.route, "/castle/"), "/castle/note/notes/target");
  assert.throws(
    () => noteRoutePath({ id: "invalid", route: "/tasks" }),
    /invalid route/,
  );
});
