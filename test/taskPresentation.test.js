import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultTaskId,
  filterTasks,
  filterTasksByGroup,
  groupTasks,
  groupTasksByStatus,
  taskFinalDeadline,
  taskGroupName,
  taskPublicTags,
  taskTagsWithFinalDeadline,
  taskTagsWithGroup,
  taskTagsWithPublicTags,
  tasksForScope,
  tasksForWorkspace,
} from "../apps/desktop/src/features/tasks/taskPresentation.ts";

const now = new Date("2026-08-01T12:00:00+02:00");

test("separates personal and project tasks without duplicating records", () => {
  const tasks = [
    task("personal", { title: "Personal" }),
    task("project", {
      title: "Project",
      project: { id: "project_castle", title: "Castle", route: "/castle" },
    }),
  ];

  assert.deepEqual(tasksForScope(tasks, "personal").map(({ id }) => id), [
    "personal",
  ]);
  assert.deepEqual(tasksForScope(tasks, "projects").map(({ id }) => id), [
    "project",
  ]);
});

test("groups visible tasks by time horizon and keeps completed work separate", () => {
  const tasks = [
    task("overdue", { targetDate: "2026-07-31" }),
    task("today", { targetDate: "2026-08-01" }),
    task("tomorrow", { targetDate: "2026-08-02" }),
    task("upcoming", { targetDate: "2026-08-09" }),
    task("no_date"),
    task("done", { status: "done", targetDate: "2026-08-01" }),
  ];

  assert.deepEqual(groupTasks(tasks, now).map(({ id }) => id), [
    "overdue",
    "today",
    "tomorrow",
    "upcoming",
    "no_date",
    "completed",
  ]);
});

test("groups Kanban tasks into every status column", () => {
  const groups = groupTasksByStatus([
    task("todo"),
    task("blocked", { status: "blocked" }),
  ]);

  assert.deepEqual(groups.map(({ status }) => status), [
    "todo",
    "in_progress",
    "blocked",
    "done",
  ]);
  assert.deepEqual(
    groups.map(({ tasks }) => tasks.map(({ id }) => id)),
    [["todo"], [], ["blocked"], []],
  );
});

test("scopes tasks to an exact project tab", () => {
  const tasks = [
    task("personal"),
    task("castle", {
      project: { id: "project_castle", title: "Castle", route: "/castle" },
    }),
    task("atlas", {
      project: { id: "project_atlas", title: "Atlas", route: "/atlas" },
    }),
  ];

  assert.deepEqual(tasksForWorkspace(tasks, "personal").map(({ id }) => id), [
    "personal",
  ]);
  assert.deepEqual(tasksForWorkspace(tasks, "project_castle").map(({ id }) => id), [
    "castle",
  ]);
});

test("uses reserved tags for planner groups and final deadlines", () => {
  const tags = taskTagsWithFinalDeadline(
    taskTagsWithGroup(["important"], "Launch"),
    "2026-08-12",
  );
  const groupedTask = task("launch", { tags });

  assert.equal(taskGroupName(groupedTask), "Launch");
  assert.equal(taskFinalDeadline(groupedTask), "2026-08-12");
  assert.deepEqual(taskPublicTags(groupedTask), ["important"]);
  assert.deepEqual(
    taskPublicTags({ tags: taskTagsWithPublicTags(tags, ["client"]) }),
    ["client"],
  );
  assert.deepEqual(
    filterTasksByGroup([groupedTask, task("inbox")], "custom:Launch", now)
      .map(({ id }) => id),
    ["launch"],
  );
});

test("searches connected people and projects and prefers contextual active work", () => {
  const personTask = task("person", {
    people: [
      {
        noteId: "person_casey_morgan",
        name: "Casey Morgan",
        route: "/note/people/casey_morgan",
        avatarUrl: "",
      },
    ],
  });
  const projectTask = task("project", {
    project: { id: "project_castle", title: "Castle", route: "/castle" },
  });
  const tasks = [projectTask, personTask];

  assert.equal(defaultTaskId(tasks), "person");
  assert.deepEqual(
    filterTasks(tasks, "all", "casey").map(({ id }) => id),
    ["person"],
  );
  assert.deepEqual(
    filterTasks(tasks, "all", "castle").map(({ id }) => id),
    ["project"],
  );
});

function task(id, overrides = {}) {
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
    sortOrder: 0,
    modifiedAt: "",
    tags: [],
    people: [],
    project: null,
    subtasks: [],
    ...overrides,
  };
}
