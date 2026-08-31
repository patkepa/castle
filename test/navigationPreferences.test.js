import assert from "node:assert/strict";
import test from "node:test";
import {
  getVisibleNavigationTabs,
  navigationTabs,
  parseHiddenNavigationTabs,
} from "../apps/desktop/src/lib/navigationPreferences.ts";
import { defaultCastleUserPreferences } from "../apps/desktop/src/platform/user_preferences.ts";

test("shows all available navigation tabs in a new library by default", () => {
  assert.deepEqual(defaultCastleUserPreferences.hiddenNavigationTabs, []);
});

test("hides selected sidebar tabs while preserving the others", () => {
  const visibleTabs = getVisibleNavigationTabs(
    new Set(["calendar"]),
  );

  assert.deepEqual(
    visibleTabs.map((tab) => tab.id),
    ["tasks", "canvas", "stash"],
  );
  assert.equal(navigationTabs.length, 4);
  assert.equal(navigationTabs.some((tab) => tab.id === "sheets"), false);
  assert.equal(navigationTabs.some((tab) => tab.id === "projects"), false);
});

test("loads only recognized hidden tab ids from storage", () => {
  assert.deepEqual(
    [...parseHiddenNavigationTabs('["calendar","unknown","calendar"]')],
    ["calendar"],
  );
  assert.deepEqual([...parseHiddenNavigationTabs("not-json")], []);
  assert.deepEqual([...parseHiddenNavigationTabs('{"calendar":true}')], []);
});
