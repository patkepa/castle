import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isLibraryContent } from "../apps/desktop/vite.config.ts";
import { readCastleConfiguration } from "../scripts/read-configuration.mjs";

const castleRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const libraryRoot = readCastleConfiguration({ castleRoot }).libraryPath;

test("watches content anywhere under the library root", () => {
  assert.equal(isLibraryContent(path.join(libraryRoot, "notes", "new.md")), true);
  assert.equal(
    isLibraryContent(path.join(libraryRoot, "projects", "castle", "idea.md")),
    true,
  );
  assert.equal(
    isLibraryContent(path.join(libraryRoot, "assets", "avatars", "new.png")),
    true,
  );
  assert.equal(
    isLibraryContent(path.join(libraryRoot, "future_section", "content.txt")),
    true,
  );
});

test("ignores hidden vault metadata and files outside the library", () => {
  assert.equal(
    isLibraryContent(path.join(libraryRoot, ".obsidian", "workspace.json")),
    false,
  );
  assert.equal(
    isLibraryContent(path.join(libraryRoot, "notes", ".draft.md")),
    false,
  );
  assert.equal(isLibraryContent(path.join(castleRoot, "README.md")), false);
  assert.equal(isLibraryContent(libraryRoot), false);
});
