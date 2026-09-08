import assert from "node:assert/strict";
import test from "node:test";
import {
  createCalendarEventContextMenu,
  createFolderContentsContextMenu,
  createFolderContextMenu,
  createGraphNodeContextMenu,
  createNoteContextMenu,
  createPersonContextMenu,
  createProjectContextMenu,
  createStashContextMenu,
  createTaskContextMenu,
} from "../src/features/context_menu/context_menu_models.ts";

test("note menus combine navigation, copying, and source move operations", () => {
  let edits = 0;
  const note = {
    id: "person_ada_lovelace",
    section: "people",
    sectionLabel: "People",
    relativePath: "ada_lovelace.md",
    sourceFile: "people/ada_lovelace.md",
    route: "/note/people/ada_lovelace",
    title: "Ada Lovelace",
    excerpt: "",
    tags: [],
    aliases: [],
    status: "",
    avatarUrl: "",
    modifiedAt: "2026-08-02T00:00:00.000Z",
    contentPath: "/generated/note.json",
    wordCount: 0,
    readingMinutes: 1,
    pinned: false,
  };
  const menu = createNoteContextMenu(note, "Note", {
    onEdit: () => { edits += 1; },
  });

  assert.equal(menu.kind, "Note");
  assert.deepEqual(menu.groups[0].actions[0].operation, {
    type: "navigate",
    to: "/note/people/ada_lovelace",
  });
  assert.equal(
    findAction(menu, "copy-obsidian-link").operation.value,
    "[[people/ada_lovelace|Ada Lovelace]]",
  );
  findAction(menu, "edit").operation.execute();
  assert.equal(edits, 1);
  assert.deepEqual(findAction(menu, "rename").operation, {
    type: "move-source",
    mode: "rename",
    noteId: "person_ada_lovelace",
    sourceFile: "people/ada_lovelace.md",
    route: "/note/people/ada_lovelace",
  });
  assert.equal(hasAction(menu, "duplicate"), false);
  assert.equal(hasAction(menu, "delete"), false);
  assert.equal(hasAction(menu, "reveal"), false);

  const stashMenu = createStashContextMenu(note);
  assert.equal(findAction(stashMenu, "move").label, "Move to library…");
  assert.equal(hasAction(stashMenu, "convert-task"), false);
  assert.equal(hasAction(stashMenu, "delete"), false);
});

test("folder menus can add and remove the folder from Pinned", () => {
  let toggles = 0;
  const menu = createFolderContextMenu({
    label: "Travel",
    route: "/browse/wiki/travel",
    onTogglePin: () => {
      toggles += 1;
    },
  });

  const pin = findAction(menu, "toggle-pin");
  assert.equal(pin.label, "Add to Pinned");
  pin.operation.execute();
  assert.equal(toggles, 1);

  const pinnedMenu = createFolderContextMenu({
    label: "Travel",
    route: "/browse/wiki/travel",
    isPinned: true,
    onTogglePin: () => {},
  });
  assert.equal(findAction(pinnedMenu, "toggle-pin").label, "Remove from Pinned");
});

test("folder menus expose connected note and remove actions", () => {
  let notesCreated = 0;
  let removed = 0;
  const menu = createFolderContextMenu({
    label: "Travel",
    route: "/browse/wiki/travel",
    onCreateNote: () => { notesCreated += 1; },
    onRemove: () => { removed += 1; },
  });
  findAction(menu, "new-note").operation.execute();
  findAction(menu, "delete").operation.execute();
  assert.equal(notesCreated, 1);
  assert.equal(removed, 1);
  assert.equal(findAction(menu, "new-note").label, "New note here");
  assert.equal(findAction(menu, "delete").intent, "danger");
  assert.equal(menu.groups.flatMap((group) => group.actions).some((action) => action.id === "new-folder"), false);
  assert.equal(hasAction(menu, "rename"), false);
  assert.equal(hasAction(menu, "reveal"), false);
});

test("folder contents menu creates notes and folders in the current directory", () => {
  let created = 0;
  let notesCreated = 0;
  const menu = createFolderContentsContextMenu({
    label: "Accomodation",
    onCreateFolder: () => { created += 1; },
    onCreateNote: () => { notesCreated += 1; },
  });

  findAction(menu, "new-folder").operation.execute();
  findAction(menu, "new-note").operation.execute();
  assert.equal(created, 1);
  assert.equal(notesCreated, 1);
});

test("task menus expose status and delete actions only when callbacks are connected", () => {
  let nextStatus = "";
  let deletes = 0;
  const task = {
    id: "task_ship_context_menu",
    noteId: "task_ship_context_menu",
    route: "/note/tasks/ship_context_menu",
    title: "Ship context menu",
    description: "",
    status: "in_progress",
    targetDate: "2026-08-02",
    targetTime: "",
    estimateMinutes: 0,
    createdAt: "2026-08-02",
    completedAt: "",
    sortOrder: 1000,
    modifiedAt: "2026-08-02T00:00:00.000Z",
    tags: [],
    people: [],
    project: null,
    subtasks: [],
  };
  const menu = createTaskContextMenu(task, {
    onStatusChange: (status) => { nextStatus = status; },
    onDelete: () => { deletes += 1; },
  });

  const statuses = findAction(menu, "set-status").children;
  assert.equal(statuses.find((action) => action.id === "status-in_progress").disabled, true);
  statuses.find((action) => action.id === "status-done").operation.execute();
  assert.equal(nextStatus, "done");
  findAction(menu, "delete").operation.execute();
  assert.equal(deletes, 1);
  assert.equal(findAction(menu, "copy-record-id").operation.value, "task_ship_context_menu");
  assert.equal(hasAction(menu, "pin"), false);
  assert.equal(hasAction(menu, "duplicate"), false);

  const readOnlyMenu = createTaskContextMenu(task);
  assert.equal(hasAction(readOnlyMenu, "set-status"), false);
  assert.equal(hasAction(readOnlyMenu, "delete"), false);
});

test("project and calendar menus hide unsupported entity mutations", () => {
  const projectMenu = createProjectContextMenu({
    id: "project_castle",
    noteId: "project_castle",
    route: "/note/projects/castle/castle",
    title: "Castle",
    description: "",
    status: "active",
    startedAt: "",
    completedAt: "",
    modifiedAt: "2026-08-02T00:00:00.000Z",
    tags: [],
    people: [],
    taskIds: [],
    eventIds: [],
  });
  const eventMenu = createCalendarEventContextMenu({
    id: "event_context_menu",
    noteId: "event_context_menu",
    route: "/note/events/2026/context_menu",
    date: "2026-08-02",
    startTime: "13:00",
    endTime: "14:00",
    title: "Context menu review",
    description: "Review the interaction.",
    kind: "work",
    people: [],
    project: null,
  });

  assert.equal(hasAction(projectMenu, "new-task"), false);
  assert.equal(hasAction(projectMenu, "set-status"), false);
  assert.equal(hasAction(projectMenu, "delete"), false);
  assert.equal(
    findAction(eventMenu, "copy-details").operation.value,
    "Context menu review\n2026-08-02 · 13:00–14:00\nReview the interaction.",
  );
  assert.equal(hasAction(eventMenu, "reschedule"), false);
  assert.equal(hasAction(eventMenu, "duplicate"), false);
  assert.equal(hasAction(eventMenu, "delete"), false);
});

test("person and graph menus expose focus only when it has a callback", () => {
  const person = {
    id: "person_ada_lovelace",
    label: "Ada Lovelace",
    type: "person",
    href: "/note/people/ada_lovelace",
  };
  let focuses = 0;

  const personMenu = createPersonContextMenu(person);
  assert.equal(hasAction(personMenu, "focus-graph"), false);
  assert.equal(hasAction(personMenu, "new-event"), false);
  assert.equal(hasAction(personMenu, "delete"), false);

  const graphMenu = createGraphNodeContextMenu(person, () => { focuses += 1; });
  findAction(graphMenu, "focus-graph").operation.execute();
  assert.equal(focuses, 1);
  assertAllLeavesConnected(graphMenu);
});

function findAction(menu, id) {
  for (const group of menu.groups) {
    for (const action of group.actions) {
      if (action.id === id) return action;
      const child = action.children?.find((candidate) => candidate.id === id);
      if (child) return child;
    }
  }
  throw new Error(`Missing action: ${id}`);
}

function hasAction(menu, id) {
  try {
    findAction(menu, id);
    return true;
  } catch {
    return false;
  }
}

function assertAllLeavesConnected(menu) {
  for (const group of menu.groups) {
    for (const action of group.actions) {
      if (action.children) {
        for (const child of action.children) {
          assert.ok(child.operation, `Missing operation for ${child.id}`);
        }
      } else {
        assert.ok(action.operation, `Missing operation for ${action.id}`);
      }
    }
  }
}
