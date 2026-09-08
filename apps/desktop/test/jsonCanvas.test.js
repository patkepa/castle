import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasFileName,
  normalizeCanvasUrl,
  parseJsonCanvas,
  serializeJsonCanvas,
} from "../src/features/canvas/jsonCanvas.ts";

test("parses and serializes every JSON Canvas 1.0 node type", () => {
  const source = JSON.stringify({
    extension: { castle: true },
    nodes: [
      { id: "text", type: "text", x: 0, y: 0, width: 200, height: 120, text: "# Idea" },
      { id: "file", type: "file", x: 300, y: 0, width: 240, height: 160, file: "wiki/idea.md", subpath: "#Plan" },
      { id: "link", type: "link", x: 0, y: 220, width: 240, height: 120, url: "https://jsoncanvas.org", color: "5" },
      { id: "group", type: "group", x: -20, y: -40, width: 600, height: 440, label: "Research", backgroundStyle: "cover" },
    ],
    edges: [
      { id: "edge", fromNode: "text", fromSide: "right", fromEnd: "none", toNode: "file", toSide: "left", toEnd: "arrow", label: "becomes", color: "#745cff" },
    ],
  });

  const canvas = parseJsonCanvas(source);
  assert.equal(canvas.nodes.length, 4);
  assert.equal(canvas.edges[0].label, "becomes");
  assert.deepEqual(canvas.extension, { castle: true });
  assert.deepEqual(parseJsonCanvas(serializeJsonCanvas(canvas)), canvas);
});

test("fills optional arrays and rejects dangling edges", () => {
  assert.deepEqual(parseJsonCanvas("{}"), { nodes: [], edges: [] });
  assert.throws(
    () => parseJsonCanvas('{"nodes":[],"edges":[{"id":"e","fromNode":"a","toNode":"b"}]}'),
    /missing node/,
  );
});

test("normalizes names for managed canvas files", () => {
  assert.equal(canvasFileName("  Summer Plan 2026 "), "summer_plan_2026.canvas");
  assert.equal(canvasFileName("Łódź ideas"), "odz_ideas.canvas");
  assert.equal(canvasFileName("***"), "untitled_canvas.canvas");
});

test("normalizes safe web links and rejects unsupported protocols", () => {
  assert.equal(normalizeCanvasUrl("example.com/path"), "https://example.com/path");
  assert.equal(normalizeCanvasUrl("http://example.com"), "http://example.com/");
  assert.equal(normalizeCanvasUrl("javascript:alert(1)"), "");
  assert.equal(normalizeCanvasUrl("not a web address"), "");
});
