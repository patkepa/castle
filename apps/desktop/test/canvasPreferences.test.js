import assert from "node:assert/strict";
import test from "node:test";
import {
  readLastOpenedCanvasPath,
  writeLastOpenedCanvasPath,
} from "../src/features/canvas/canvasPreferences.ts";

test("remembers the last opened managed canvas", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };

  assert.equal(readLastOpenedCanvasPath(storage), "");
  writeLastOpenedCanvasPath("planning/2026.canvas", storage);
  assert.equal(readLastOpenedCanvasPath(storage), "planning/2026.canvas");
});

test("canvas path preferences tolerate unavailable storage", () => {
  const unavailableStorage = {
    getItem() {
      throw new Error("unavailable");
    },
    setItem() {
      throw new Error("unavailable");
    },
  };

  assert.equal(readLastOpenedCanvasPath(unavailableStorage), "");
  assert.doesNotThrow(() =>
    writeLastOpenedCanvasPath("planning/2026.canvas", unavailableStorage),
  );
});
