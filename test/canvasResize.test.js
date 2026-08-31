import assert from "node:assert/strict";
import test from "node:test";
import { resizedCanvasNode } from "../apps/desktop/src/features/canvas/canvasResize.ts";

const node = {
  id: "node_test",
  type: "text",
  x: 100,
  y: 200,
  width: 280,
  height: 180,
  text: "Resize me",
};

test("resizes a canvas node from each edge while keeping the opposite edge fixed", () => {
  assert.deepEqual(resizedCanvasNode(node, "right", { x: 43, y: 0 }), {
    x: 100,
    y: 200,
    width: 320,
    height: 180,
  });
  assert.deepEqual(resizedCanvasNode(node, "left", { x: 43, y: 0 }), {
    x: 140,
    y: 200,
    width: 240,
    height: 180,
  });
  assert.deepEqual(resizedCanvasNode(node, "top", { x: 0, y: -43 }), {
    x: 100,
    y: 160,
    width: 280,
    height: 220,
  });
  assert.deepEqual(resizedCanvasNode(node, "bottom", { x: 0, y: -43 }), {
    x: 100,
    y: 200,
    width: 280,
    height: 140,
  });
});

test("resizes both axes from corners and enforces the minimum card size", () => {
  assert.deepEqual(resizedCanvasNode(node, "top-left", { x: -23, y: -18 }), {
    x: 80,
    y: 180,
    width: 300,
    height: 200,
  });
  assert.deepEqual(resizedCanvasNode(node, "bottom-right", { x: -500, y: -500 }), {
    x: 100,
    y: 200,
    width: 140,
    height: 80,
  });
});

test("preserves aspect ratio when shift-resizing from a corner", () => {
  const resized = resizedCanvasNode(
    node,
    "top-left",
    { x: -10, y: -80 },
    true,
  );
  assert.equal(resized.width / resized.height, node.width / node.height);
  assert.equal(resized.x + resized.width, node.x + node.width);
  assert.equal(resized.y + resized.height, node.y + node.height);
});
