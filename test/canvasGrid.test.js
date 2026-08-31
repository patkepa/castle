import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasSnapGridSize,
  snapCanvasValue,
  snapCanvasValueInDirection,
  snappedCanvasDragDelta,
} from "../apps/desktop/src/features/canvas/canvasGrid.ts";

test("snaps canvas geometry to a subtle ten-unit grid", () => {
  assert.equal(canvasSnapGridSize, 10);
  assert.equal(snapCanvasValue(4), 0);
  assert.equal(snapCanvasValue(6), 10);
  assert.equal(snapCanvasValue(14), 10);
  assert.equal(snapCanvasValue(16), 20);
  assert.equal(snapCanvasValue(-4), 0);
  assert.equal(snapCanvasValue(-6), -10);
});

test("never snaps off-grid geometry against the direction of travel", () => {
  assert.equal(snapCanvasValueInDirection(-407, -406), -407);
  assert.equal(snapCanvasValueInDirection(-407, -403), -400);
  assert.equal(snapCanvasValueInDirection(562, 563), 562);
  assert.equal(snapCanvasValueInDirection(562, 559), 560);
});

test("derives a snapped drag delta from one anchor node", () => {
  assert.deepEqual(
    snappedCanvasDragDelta({ x: 3, y: 17 }, { x: 13, y: -4 }),
    { x: 17, y: -7 },
  );
});
