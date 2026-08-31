import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAssetPath,
  resolveNoteLink,
} from "../apps/desktop/src/components/NoteMarkdown.tsx";

const note = {
  sourceFile: "notes/folder/source.md",
};

test("resolves relative note and asset paths consistently", () => {
  const target = { route: "/note/wiki/target" };
  const lookup = new Map([["notes/target.md", target]]);

  assert.equal(
    resolveNoteLink(note, "../target.md#Details", lookup),
    "/note/wiki/target#details",
  );
  assert.equal(
    resolveAssetPath(note, "../image.png"),
    "/content-assets/notes/image.png",
  );
  assert.equal(resolveAssetPath(note, "/assets/avatar.png"), "/assets/avatar.png");
  assert.equal(resolveAssetPath(note, "assets/avatar.png"), "/assets/avatar.png");
});
