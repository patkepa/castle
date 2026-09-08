import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LibraryChooser } from "../src/components/LibraryChooser.tsx";
import { DesktopLibrarySettings } from "../src/components/ViewSettingsMenu.tsx";

const bridge = {
  chooseLibrary: async () => ({ status: "cancelled" }),
  openLibrary: async () => ({ status: "cancelled" }),
  restartApp: async () => {},
};

test("renders the first-run library workflow and remembered folders", () => {
  const markup = renderToStaticMarkup(
    createElement(LibraryChooser, {
      bridge,
      libraries: [
        {
          name: "Personal wiki",
          path: "/Users/example/Documents/wiki/library",
          available: true,
          active: false,
        },
        {
          name: "Archive",
          path: "/Volumes/Archive/library",
          available: false,
          active: false,
        },
      ],
    }),
  );

  assert.match(markup, /Open a library/);
  assert.match(markup, /Recent libraries/);
  assert.match(markup, /Personal wiki/);
  assert.match(markup, /Archive/);
  assert.match(markup, /Open folder…/);
  assert.match(markup, /repository containing <code>library\/<\/code>/);
  assert.equal(markup.match(/class="library-choice"/g)?.length, 2);
});

test("keeps the empty first launch focused on choosing a folder", () => {
  const markup = renderToStaticMarkup(
    createElement(LibraryChooser, { bridge, libraries: [] }),
  );

  assert.doesNotMatch(markup, /Recent libraries/);
  assert.match(markup, /Open folder…/);
});

test("renders the current and alternate libraries in View settings", () => {
  const currentLibrary = {
    name: "Personal wiki",
    path: "/Users/example/Documents/wiki/library",
    available: true,
    active: true,
  };
  const alternateLibrary = {
    name: "Work notes",
    path: "/Users/example/Documents/work/library",
    available: true,
    active: false,
  };
  const markup = renderToStaticMarkup(
    createElement(DesktopLibrarySettings, {
      currentLibrary,
      error: "",
      libraries: [currentLibrary, alternateLibrary],
      working: "",
      onChooseLibrary: () => {},
      onOpenLibrary: () => {},
    }),
  );

  assert.match(markup, /id="view-settings-library">Library/);
  assert.match(markup, /Personal wiki/);
  assert.match(markup, /Current/);
  assert.match(markup, /Work notes/);
  assert.match(markup, /Switch/);
  assert.match(markup, /Open another library…/);
});
