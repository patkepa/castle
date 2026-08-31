import assert from "node:assert/strict";
import test from "node:test";
import {
  taskMoveTargetAt,
  taskSortOrderAt,
} from "../apps/desktop/src/features/tasks/useTaskMutations.ts";

test("calculates stable task order when moving down within a status", () => {
  const tasks = [
    task("first", 1000),
    task("second", 2000),
    task("third", 3000),
  ];

  assert.equal(
    taskSortOrderAt(tasks, "first", "todo", {
      relativeToTaskId: "second",
      edge: "after",
    }),
    2500,
  );
  assert.equal(
    taskSortOrderAt(tasks, "second", "todo", { position: "end" }),
    4000,
  );
});

test("calculates task order across statuses and project scopes", () => {
  const tasks = [
    task("personal_todo", 1000),
    task("personal_done", 1000, { status: "done" }),
    task("project_done", 2000, {
      status: "done",
      project: { id: "project_castle", title: "Castle", route: "/castle" },
    }),
  ];

  assert.equal(
    taskSortOrderAt(tasks, "personal_todo", "done", { position: "end" }),
    2000,
  );
});

test("keeps task ordering isolated to the exact project", () => {
  const castle = { id: "project_castle", title: "Castle", route: "/castle" };
  const voxile = { id: "project_voxile", title: "Voxile", route: "/voxile" };
  const tasks = [
    task("castle_first", 1000, { project: castle }),
    task("castle_second", 2000, { project: castle }),
    task("voxile_late", 9000, { project: voxile }),
  ];

  assert.equal(
    taskSortOrderAt(tasks, "castle_first", "todo", { position: "end" }),
    3000,
  );
});

test("does not reorder a task dropped onto itself", () => {
  const tasks = [task("first", 1000), task("second", 2000)];

  assert.equal(
    taskSortOrderAt(tasks, "first", "todo", {
      relativeToTaskId: "first",
      edge: "after",
    }),
    1000,
  );
});

test("anchors filtered reorders to stable task ids", () => {
  const tasks = [task("first", 1000), task("hidden", 2000), task("last", 3000)];
  const target = taskMoveTargetAt([tasks[0], tasks[2]], "last", 0);

  assert.deepEqual(target, { relativeToTaskId: "first", edge: "before" });
  assert.equal(taskSortOrderAt(tasks, "last", "todo", target), 500);
});

function task(id, sortOrder, overrides = {}) {
  return {
    id,
    noteId: id,
    route: `/note/tasks/${id}`,
    title: id,
    description: "",
    status: "todo",
    targetDate: "",
    targetTime: "",
    estimateMinutes: 0,
    createdAt: "",
    completedAt: "",
    sortOrder,
    modifiedAt: "",
    tags: [],
    people: [],
    project: null,
    subtasks: [],
    ...overrides,
  };
}
