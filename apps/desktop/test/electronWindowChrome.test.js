import assert from "node:assert/strict";
import test from "node:test";
import { createCastleWindowChrome } from "../electron/window_chrome.ts";

test("places macOS traffic lights in Castle's thin title strip", () => {
  assert.deepEqual(createCastleWindowChrome("darwin"), {
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 10 },
  });
});

test("styles Windows and Linux window controls to match Castle chrome", () => {
  const expected = {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#060606",
      symbolColor: "#b8b8b8",
      height: 32,
    },
  };

  assert.deepEqual(createCastleWindowChrome("win32"), expected);
  assert.deepEqual(createCastleWindowChrome("linux"), expected);
});
