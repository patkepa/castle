import assert from "node:assert/strict";
import test from "node:test";
import { getRelationshipEdgeStyle } from "../src/features/relationships/relationshipGraphPresentation.ts";

const idleEdgeState = {
  focused: false,
  searched: false,
  faded: false,
  scale: 1,
};

test("renders direct relationships between people as dotted connections", () => {
  const style = getRelationshipEdgeStyle(
    { type: "person-relation", color: "#38bdf8" },
    idleEdgeState,
  );

  assert.deepEqual(style.dash, [4, 5]);
  assert.equal(style.stroke, "rgba(178, 188, 201, 0.42)");
});

test("keeps person relationships grey when emphasized", () => {
  const edge = { type: "person-relation", color: "#38bdf8" };

  assert.equal(
    getRelationshipEdgeStyle(edge, {
      ...idleEdgeState,
      focused: true,
    }).stroke,
    "rgba(178, 188, 201, 0.82)",
  );
  assert.equal(
    getRelationshipEdgeStyle(edge, {
      ...idleEdgeState,
      searched: true,
    }).stroke,
    "rgba(178, 188, 201, 0.62)",
  );
});

test("keeps hierarchy connections solid", () => {
  const style = getRelationshipEdgeStyle(
    { type: "person" },
    idleEdgeState,
  );

  assert.equal(style.dash, undefined);
});
