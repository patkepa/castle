import assert from "node:assert/strict";
import test from "node:test";
import { connectionTargetAtPoint } from "../apps/desktop/src/features/canvas/canvasConnections.ts";

const source = {
  id: "source",
  type: "text",
  x: 0,
  y: 0,
  width: 200,
  height: 120,
  text: "Source",
};

const target = {
  id: "target",
  type: "file",
  x: 300,
  y: 40,
  width: 240,
  height: 160,
  file: "wiki/target.md",
};

test("snaps a dragged connection to the nearest side of its target card", () => {
  assert.deepEqual(
    connectionTargetAtPoint([source, target], source.id, { x: 302, y: 100 }),
    { node: target, side: "left" },
  );
  assert.deepEqual(
    connectionTargetAtPoint([source, target], source.id, { x: 430, y: 42 }),
    { node: target, side: "top" },
  );
  assert.equal(
    connectionTargetAtPoint([source, target], source.id, { x: 280, y: 100 }),
    undefined,
  );
});

test("uses the topmost eligible card and never targets the source or a group", () => {
  const group = {
    id: "group",
    type: "group",
    x: 250,
    y: 0,
    width: 400,
    height: 300,
    label: "Group",
  };
  const topmost = { ...target, id: "topmost", file: "wiki/topmost.md" };

  assert.deepEqual(
    connectionTargetAtPoint(
      [source, group, target, topmost],
      source.id,
      { x: 538, y: 120 },
    ),
    { node: topmost, side: "right" },
  );
  assert.equal(
    connectionTargetAtPoint([source, group], source.id, { x: 100, y: 60 }),
    undefined,
  );
});
