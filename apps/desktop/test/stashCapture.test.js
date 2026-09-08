import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StashComposer } from "../src/components/StashComposer.tsx";
import { createStashSourceInput } from "../src/features/stash/stashCapture.ts";
import { CastlePlatformProvider } from "../src/platform/castle_platform_provider.tsx";
import { webCastlePlatform } from "../src/platform/web_castle_platform.ts";

test("creates a human-readable, collision-safe stash source input", () => {
  const createdAt = new Date(2026, 7, 3, 14, 5, 9, 27);
  const existing = new Set([
    "stash/2026_08_03_14_05_09_027_zażółć_gęślą_jaźń.md",
  ]);

  assert.deepEqual(
    createStashSourceInput("  # Zażółć gęślą jaźń  ", existing, createdAt),
    {
      noteId: "stash/2026_08_03_14_05_09_027_zażółć_gęślą_jaźń_2",
      sourceFile: "stash/2026_08_03_14_05_09_027_zażółć_gęślą_jaźń_2.md",
      markdown: "# Zażółć gęślą jaźń\n",
    },
  );
});

test("bounds generated stash filenames for long captures", () => {
  const input = createStashSourceInput(
    "A very long first line that keeps going well beyond a useful filename length and should be clipped",
    new Set(),
    new Date(2026, 7, 3, 14, 5, 9, 27),
  );

  assert.equal(input.sourceFile.length < 100, true);
  assert.match(input.sourceFile, /^stash\/2026_08_03_14_05_09_027_[a-z0-9_]+\.md$/);
});

test("shows stash capture only when desktop creation is available", () => {
  const desktopPlatform = {
    runtime: "desktop",
    capabilities: {
      editContent: true,
      createContent: true,
      moveContent: true,
      deleteContent: true,
    },
    contentMutations: {
      readSource: async () => {},
      saveSource: async () => {},
      createSource: async () => {},
      moveSource: async () => {},
      deleteSource: async () => {},
      restoreSource: async () => {},
    },
    knowledgeQueries: null,
    aiChat: null,
  };
  const desktopMarkup = renderToStaticMarkup(
    createElement(
      CastlePlatformProvider,
      { platform: desktopPlatform },
      createElement(StashComposer, { notes: [] }),
    ),
  );
  const webMarkup = renderToStaticMarkup(
    createElement(
      CastlePlatformProvider,
      { platform: webCastlePlatform },
      createElement(StashComposer, { notes: [] }),
    ),
  );

  assert.match(desktopMarkup, /Add to stash/);
  assert.match(desktopMarkup, /aria-label="New stash item"/);
  assert.match(desktopMarkup, /Add item/);
  assert.equal(webMarkup, "");
});
