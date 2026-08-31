import assert from "node:assert/strict";
import test from "node:test";
import { requiredDomains } from "../apps/desktop/src/app/useRouteKnowledgeSnapshot.ts";

test("route snapshots request only the domains each workspace consumes", () => {
  assert.deepEqual([...requiredDomains("/", false)], []);
  assert.deepEqual(
    [...requiredDomains("/calendar", false)],
    ["notes", "tasks", "projects", "calendar"],
  );
  assert.deepEqual(
    [...requiredDomains("/tasks", false)],
    ["notes", "tasks", "projects"],
  );
  assert.deepEqual(
    [...requiredDomains("/projects", false)],
    ["notes", "tasks", "projects", "calendar"],
  );
  assert.deepEqual(
    [...requiredDomains("/relationship-graph", false)],
    ["notes", "calendar"],
  );
  assert.deepEqual([...requiredDomains("/canvas", false)], ["notes"]);
  assert.deepEqual(
    [...requiredDomains("/note/notes/home", false)],
    ["notes"],
  );
  assert.deepEqual(
    [...requiredDomains("/note/notes/castle_help", false)],
    [],
  );
  assert.deepEqual(
    [...requiredDomains("/note/wiki/example", false)],
    ["notes"],
  );
  assert.deepEqual([...requiredDomains("/", true)], ["notes"]);
});
