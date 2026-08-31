import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  getShortcutCategoryStyle,
  getShortcutPixels,
  getShortcutSeed,
  groupShortcuts,
  moveShortcutPixelsIntoEmptyCells,
} from "../apps/desktop/src/lib/shortcutPixels.ts";

const githubShortcut = {
  category: "Work",
  description: "Browse repositories",
  href: "https://github.com/",
  label: "GitHub",
};

test("groups shortcuts in source order and retains stable variant indexes", () => {
  const groups = groupShortcuts([
    githubShortcut,
    { ...githubShortcut, category: "Media", label: "YouTube" },
    { ...githubShortcut, label: "Calendar" },
  ]);

  assert.deepEqual(
    groups.map((group) => ({
      category: group.category,
      items: group.items.map(({ shortcut, variantIndex }) => [
        shortcut.label,
        variantIndex,
      ]),
    })),
    [
      {
        category: "Work",
        items: [
          ["GitHub", 0],
          ["Calendar", 2],
        ],
      },
      {
        category: "Media",
        items: [["YouTube", 1]],
      },
    ],
  );
});

test("generates deterministic pixel art and moves it without changing density", () => {
  const first = getShortcutPixels(githubShortcut, 0, 0);
  const second = getShortcutPixels(githubShortcut, 0, 0);
  const seed = getShortcutSeed(githubShortcut);
  const moved = moveShortcutPixelsIntoEmptyCells(first, seed);
  const filledCount = (pixels) =>
    pixels.filter((pixel) => pixel !== "transparent").length;

  assert.equal(first.length, 100);
  assert.deepEqual(first, second);
  assert.notDeepEqual(moved.pixels, first);
  assert.equal(filledCount(moved.pixels), filledCount(first));
  assert.notEqual(moved.seed, seed);
  assert.deepEqual(getShortcutCategoryStyle("Work", 0), {
    "--tile-hue-a": "201",
    "--tile-hue-b": "214",
    "--tile-hue-c": "188",
  });
  assert.equal(
    createHash("sha256").update(JSON.stringify(first)).digest("hex"),
    "72fbcbd5c13c6ea4c5bb76be49d71fe0c8a3a7d4c01f835401fcb0cf84aa11ee",
  );
});

test("leaves a full pixel grid intact when no move is possible", () => {
  const fullGrid = Array.from({ length: 100 }, () => "#000");
  const moved = moveShortcutPixelsIntoEmptyCells(fullGrid, 42);

  assert.strictEqual(moved.pixels, fullGrid);
  assert.notEqual(moved.seed, 42);
});
