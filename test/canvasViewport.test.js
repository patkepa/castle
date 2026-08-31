import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasPinchTransform,
  canvasWheelZoomTransform,
  canvasZoomTransform,
  createCanvasPinchGesture,
  normalizedWheelDelta,
} from "../apps/desktop/src/features/canvas/canvasViewport.ts";

test("pinch zoom keeps the touched canvas point anchored", () => {
  const gesture = createCanvasPinchGesture(
    { x: 20, y: 40, zoom: 1 },
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  );

  assert.deepEqual(
    canvasPinchTransform(
      gesture,
      { x: 50, y: 100 },
      { x: 250, y: 100 },
      0.25,
      2,
    ),
    { x: -110, y: -20, zoom: 2 },
  );
});

test("pinch supports simultaneous two-finger pan", () => {
  const gesture = createCanvasPinchGesture(
    { x: 0, y: 0, zoom: 1 },
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  );

  assert.deepEqual(
    canvasPinchTransform(
      gesture,
      { x: 130, y: 120 },
      { x: 230, y: 120 },
      0.25,
      2,
    ),
    { x: 30, y: 20, zoom: 1 },
  );
});

test("wheel zoom stays anchored beneath the touchpad gesture", () => {
  assert.deepEqual(
    canvasZoomTransform(
      { x: 20, y: 40, zoom: 1 },
      1.5,
      { x: 100, y: 120 },
    ),
    { x: -20, y: 0, zoom: 1.5 },
  );
});

test("touchpad wheel motion zooms instead of translating the canvas", () => {
  const start = { x: 20, y: 40, zoom: 1 };
  const point = { x: 100, y: 120 };
  const next = canvasWheelZoomTransform(start, -100, point, 0.004, 0.25, 2);

  assert.ok(next.zoom > start.zoom);
  assert.equal((point.x - next.x) / next.zoom, (point.x - start.x) / start.zoom);
  assert.equal((point.y - next.y) / next.zoom, (point.y - start.y) / start.zoom);
});

test("wheel deltas normalize line and page units", () => {
  assert.equal(normalizedWheelDelta(2, 0, 600), 2);
  assert.equal(normalizedWheelDelta(2, 1, 600), 32);
  assert.equal(normalizedWheelDelta(2, 2, 600), 1200);
});
