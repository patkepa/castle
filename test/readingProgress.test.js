import assert from "node:assert/strict";
import test from "node:test";
import { calculateReadingProgress } from "../apps/desktop/src/lib/readingProgress.ts";

test("hides reading progress when the note does not overflow", () => {
  assert.equal(
    calculateReadingProgress({
      clientHeight: 800,
      scrollHeight: 800,
      scrollTop: 0,
    }),
    null,
  );
});

test("calculates and clamps progress for an overflowing note", () => {
  const dimensions = { clientHeight: 800, scrollHeight: 1_800 };

  assert.equal(calculateReadingProgress({ ...dimensions, scrollTop: 250 }), 0.25);
  assert.equal(calculateReadingProgress({ ...dimensions, scrollTop: -20 }), 0);
  assert.equal(calculateReadingProgress({ ...dimensions, scrollTop: 1_200 }), 1);
});
