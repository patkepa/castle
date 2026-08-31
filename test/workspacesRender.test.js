import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ProjectsPage } from "../apps/desktop/src/features/projects/ProjectsPage.tsx";
import { LibraryBrowser } from "../apps/desktop/src/components/library_browser.tsx";
import { StashList } from "../apps/desktop/src/components/StashList.tsx";
import { orderProjects, TasksPage } from "../apps/desktop/src/features/tasks/TasksPage.tsx";
import { TaskBrowser } from "../apps/desktop/src/features/tasks/TaskBrowser.tsx";
import { TaskKanban } from "../apps/desktop/src/features/tasks/TaskKanban.tsx";
import { TaskInspector } from "../apps/desktop/src/features/tasks/TaskInspector.tsx";
import { CalendarTimeGrid } from "../apps/desktop/src/features/calendar/CalendarTimeGrid.tsx";
import { CalendarPage } from "../apps/desktop/src/features/calendar/CalendarPage.tsx";
import { CalendarEventEditor } from "../apps/desktop/src/features/calendar/CalendarEventEditor.tsx";
import { emptyCalendarEventFormValues } from "../apps/desktop/src/features/calendar/calendarEventMarkdown.ts";
import { TaskViewToggle } from "../apps/desktop/src/features/tasks/TaskViewToggle.tsx";
import { ChecklistsTool } from "../apps/desktop/src/components/tools/ChecklistsTool.tsx";
import { KnowledgeInsightsTool } from "../apps/desktop/src/components/tools/KnowledgeInsightsTool.tsx";
import { CastlePlatformProvider } from "../apps/desktop/src/platform/castle_platform_provider.tsx";
import { webCastlePlatform } from "../apps/desktop/src/platform/web_castle_platform.ts";
import { CastleContextMenuProvider } from "../apps/desktop/src/features/context_menu/CastleContextMenu.tsx";
import { CanvasEditor } from "../apps/desktop/src/features/canvas/CanvasEditor.tsx";
import { CanvasPage } from "../apps/desktop/src/features/canvas/CanvasPage.tsx";
import {
  SheetsPage,
  SheetsManager,
  SpreadsheetPanel,
} from "../apps/desktop/src/features/sheets/SheetsPage.tsx";

const projectReference = {
  id: "project_castle",
  title: "Castle",
  route: "/note/projects/castle/castle",
};
const projectTask = task("task_records", "Implement Castle Records", projectReference);
const personalTask = task("task_post", "Send a package", null);
const projectEvent = {
  id: "event_castle_review",
  noteId: "event_castle_review",
  route: "/note/events/2026/castle_review",
  date: "2026-08-01",
  startTime: "12:00",
  title: "Castle review",
  description: "Review the file model.",
  kind: "work",
  people: [],
  project: projectReference,
};
const project = {
  ...projectReference,
  noteId: "project_castle",
  description: "A file-based personal knowledge workspace.",
  status: "active",
  startedAt: "2026-07-31",
  completedAt: "",
  modifiedAt: "2026-08-01T12:00:00.000Z",
  tags: ["software"],
  people: [],
  taskIds: [projectTask.id],
  eventIds: [projectEvent.id],
};
const note = {
  id: "project_castle",
  section: "projects",
  sectionLabel: "Projects",
  relativePath: "castle/castle.md",
  sourceFile: "projects/castle/castle.md",
  route: project.route,
  title: "Castle",
  excerpt: project.description,
  tags: ["software"],
  aliases: [],
  status: "active",
  avatarUrl: "",
  modifiedAt: project.modifiedAt,
  contentPath: "",
  wordCount: 8,
  readingMinutes: 1,
  pinned: false,
};

test("renders the managed Sheets browser and spreadsheet back navigation", () => {
  const managedSheet = {
    relativePath: "planning/roadmap_2026.ods",
    name: "budget_2026.ods",
    size: 4096,
    modifiedAt: "2026-08-09T12:00:00.000Z",
  };
  const managerMarkup = render(createElement(SheetsManager, {
    desktopAvailable: true,
    error: "",
    loading: false,
    managedSheets: [managedSheet],
    openingPath: "",
    onOpenLocal: () => {},
    onOpenSheet: () => {},
    onRefresh: () => {},
  }));
  const workbook = {
    sheets: [
      {
        name: "Budget",
        rows: [[{ value: "Total", kind: "text" }]],
        rowCount: 1,
        columnCount: 1,
        truncated: false,
      },
      {
        name: "Notes",
        rows: [],
        rowCount: 0,
        columnCount: 0,
        truncated: false,
      },
    ],
  };
  const previewMarkup = render(createElement(SpreadsheetPanel, {
    document: {
      fileName: managedSheet.name,
      fileSize: managedSheet.size,
      sourcePath: `library/sheets/${managedSheet.relativePath}`,
      initialWorkbook: workbook,
      readOnly: true,
      downloadPath: `/generated/sheets/files/${"a".repeat(64)}.ods`,
      workbook,
    },
    error: "",
    selectedSheet: workbook.sheets[0],
    selectedSheetIndex: 0,
    onBack: () => {},
    onOpen: () => {},
    onSelectSheet: () => {},
  }));

  assert.match(managerMarkup, /Library collection/);
  assert.match(managerMarkup, /Budget 2026/);
  assert.match(managerMarkup, /library\/sheets\/planning/);
  assert.match(managerMarkup, />Refresh</);
  assert.match(previewMarkup, /aria-label="Back to sheets"/);
  assert.match(previewMarkup, /library\/sheets\/planning\/roadmap_2026\.ods/);
  assert.match(previewMarkup, /Budget/);
  assert.match(previewMarkup, /Notes/);
  assert.match(previewMarkup, /Total/);
  assert.match(previewMarkup, /Read-only Cloudflare snapshot/);
  assert.doesNotMatch(previewMarkup, /Replace file/);
  assert.doesNotMatch(previewMarkup, />Apply</);
});

test("renders a Cloudflare canvas snapshot without editing controls", () => {
  const markup = render(createElement(CanvasEditor, {
    autoSave: false,
    data: { nodes: [], edges: [] },
    fileName: "summer.canvas",
    notes: [],
    readOnly: true,
    onChange: () => {},
    onDownload: () => {},
    onOpenNote: () => {},
    onSave: async () => {},
  }));

  assert.match(markup, /Read-only Cloudflare snapshot/);
  assert.match(markup, /Download \.canvas/);
  assert.doesNotMatch(markup, /aria-label="Canvas tools"/);
  assert.doesNotMatch(markup, /aria-label="Save canvas"/);
  assert.doesNotMatch(markup, />Edit</);
  assert.doesNotMatch(markup, />Preview</);
});

test("omits local Canvas and Sheets editor controls from the static page", () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const canvasMarkup = render(createElement(CanvasPage, {
      notes: [],
      onOpenNote: () => {},
    }));
    const sheetsMarkup = render(createElement(SheetsPage));

    assert.doesNotMatch(canvasMarkup, /Open local \.canvas/);
    assert.doesNotMatch(canvasMarkup, /Create local canvas/);
    assert.doesNotMatch(canvasMarkup, /accept="\.canvas/);
    assert.doesNotMatch(sheetsMarkup, /Open local \.ods/);
    assert.doesNotMatch(sheetsMarkup, /Open \.ods/);
    assert.doesNotMatch(sheetsMarkup, /accept="\.ods/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("renders an autosaving canvas without save or mode chrome", () => {
  const markup = render(createElement(CanvasEditor, {
    autoSave: true,
    data: { nodes: [], edges: [] },
    fileName: "summer.canvas",
    notes: [note],
    onChange: () => {},
    onOpenNote: () => {},
    onSave: async () => {},
  }));

  assert.match(markup, /aria-label="Canvas tools"/);
  assert.match(markup, /aria-label="Note or file \(F\)"/);
  assert.doesNotMatch(markup, /aria-label="Save canvas"/);
  assert.doesNotMatch(markup, />Saved</);
  assert.doesNotMatch(markup, />Edit</);
  assert.doesNotMatch(markup, />Preview</);
});

test("renders Canvas image and PDF cards with desktop media controls", () => {
  const markup = render(createElement(CanvasEditor, {
    autoSave: true,
    data: {
      nodes: [
        {
          id: "image",
          type: "file",
          x: 0,
          y: 0,
          width: 360,
          height: 260,
          file: "assets/canvas/summer_photo.png",
        },
        {
          id: "pdf",
          type: "file",
          x: 400,
          y: 0,
          width: 360,
          height: 260,
          file: "assets/canvas/plan.pdf",
        },
      ],
      edges: [],
    },
    fileName: "summer.canvas",
    notes: [],
    onChange: () => {},
    onImportMedia: async () => ({ file: "assets/canvas/added.png" }),
    onOpenMedia: () => {},
    onOpenNote: () => {},
    onSave: async () => {},
  }));

  assert.match(markup, /aria-label="Image or PDF \(M\)"/);
  assert.match(markup, /accept="\.png,.jpg,.jpeg,.gif,.webp,.pdf/);
  assert.match(markup, /src="\/assets\/canvas\/summer_photo.png"/);
  assert.match(markup, /PDF document/);
  assert.match(markup, /Double-click to open/);
});

test("renders desktop Canvas web links as isolated live previews", () => {
  const markup = render(
    createElement(CanvasEditor, {
      autoSave: true,
      data: {
        nodes: [
          {
            id: "web",
            type: "link",
            x: 0,
            y: 0,
            width: 540,
            height: 540,
            url: "https://example.com/path",
          },
        ],
        edges: [],
      },
      fileName: "links.canvas",
      notes: [],
      onChange: () => {},
      onOpenNote: () => {},
      onSave: async () => {},
    }),
    desktopPlatformWithCanvasPreviews(true),
  );

  assert.match(markup, /<webview/);
  assert.match(markup, /aria-label="Preview of example\.com"/);
  assert.match(markup, /partition="castle-canvas-previews"/);
  assert.match(markup, /src="https:\/\/example\.com\/path"/);
  assert.match(markup, /Loading page preview/);
  assert.doesNotMatch(markup, /nodeintegration="true"/);
});

test("explains when Canvas web previews need a desktop restart", () => {
  const markup = render(
    createElement(CanvasEditor, {
      autoSave: true,
      data: {
        nodes: [
          {
            id: "web",
            type: "link",
            x: 0,
            y: 0,
            width: 280,
            height: 180,
            url: "https://example.com",
          },
        ],
        edges: [],
      },
      fileName: "links.canvas",
      notes: [],
      onChange: () => {},
      onOpenNote: () => {},
      onSave: async () => {},
    }),
    desktopPlatformWithCanvasPreviews(false),
  );

  assert.doesNotMatch(markup, /<webview/);
  assert.match(markup, /Restart Castle to enable this page preview/);
});

test("renders keyboard-navigable Library collections", () => {
  const markup = render(
    createElement(
      LibraryBrowser,
      { className: "file-browser-list", viewMode: "list" },
      createElement("a", {
        "aria-keyshortcuts": "Space",
        "data-library-folder": "true",
        "data-library-item": "true",
        href: "/browse/wiki",
      }),
      createElement("a", {
        "aria-keyshortcuts": "Space",
        "data-library-item": "true",
        href: "/note/wiki/example",
      }),
    ),
  );

  assert.match(markup, /data-library-layout="list"/);
  assert.equal(markup.match(/data-library-item="true"/g)?.length, 2);
  assert.equal(markup.match(/data-library-folder="true"/g)?.length, 1);
  assert.equal(markup.match(/aria-keyshortcuts="Space"/g)?.length, 2);
});

test("renders calendar events and scheduled tasks in the same time grid", () => {
  const scheduledTask = {
    ...personalTask,
    targetDate: "2026-08-01",
    targetTime: "13:15",
    estimateMinutes: 45,
  };
  const day = new Date(2026, 7, 1);
  const markup = render(createElement(CalendarTimeGrid, {
    days: [day],
    events: [projectEvent],
    tasks: [scheduledTask],
    currentTime: new Date(2026, 7, 1, 10, 0),
    today: day,
    selectedEventId: projectEvent.id,
    onCreateEvent: () => {},
    onEditEvent: () => {},
  }));

  assert.match(markup, /calendar-grid-event--work/);
  assert.match(markup, /Castle review/);
  assert.match(markup, /calendar-grid-task/);
  assert.match(markup, /Send a package/);
  assert.match(markup, /Task · 45 min/);
});

test("omits calendar creation controls from the static page", () => {
  const markup = render(createElement(CalendarPage, {
    events: [projectEvent],
    tasks: [personalTask],
    projects: [project],
    people: [],
  }));

  assert.match(markup, /Week schedule/);
  assert.doesNotMatch(markup, /New event/);
  assert.doesNotMatch(markup, /Add event on/);
  assert.doesNotMatch(markup, /calendar-grid-slot[^>]*<\/button>/);
});

test("renders event details without mutation controls on the static page", () => {
  const markup = render(createElement(CalendarEventEditor, {
    mode: "edit",
    initialValues: {
      ...emptyCalendarEventFormValues("2026-08-03", "09:30"),
      title: "Work on Castle",
    },
    projects: [project],
    people: [],
    canEdit: false,
    canDelete: false,
    busy: false,
    mutationError: "",
    onClose: () => {},
    onSave: async () => false,
  }));

  assert.doesNotMatch(markup, /New event/);
  assert.match(markup, /Event details/);
  assert.match(markup, /Work on Castle/);
  assert.match(markup, /End date/);
  assert.match(markup, /Kind/);
  assert.match(markup, /Project/);
  assert.match(markup, /Description/);
  assert.match(markup, /Open this library in the Castle desktop app/);
  assert.doesNotMatch(markup, /Delete event/);
  assert.doesNotMatch(markup, /Save changes/);
});

test("renders the Projects list-and-inspector workspace from generated records", () => {
  const markup = render(
    createElement(ProjectsPage, {
      projects: [project],
      tasks: [projectTask],
      events: [projectEvent],
      notes: [note],
    }),
  );

  assert.match(markup, /File-based workspace/);
  assert.match(markup, /A file-based personal knowledge workspace/);
  assert.match(markup, /Implement Castle Records/);
  assert.match(markup, /Castle review/);
  assert.match(markup, /Open note/);
  assert.match(markup, /aria-label="All projects"/);
  assert.match(markup, /aria-orientation="vertical"/);
  assert.match(markup, /data-kui-selectable-option="true"[^>]*tabindex="0"/);
});

test("renders the default Personal task browser and inspector workspace", () => {
  const markup = render(
    createElement(TasksPage, {
      tasks: [personalTask, projectTask],
      projects: [project],
      people: [],
    }),
  );

  assert.match(markup, /Direct task planning across personal work and projects/);
  assert.match(markup, /aria-label="Task planning workspace"/);
  assert.match(markup, /class="task-groups"/);
  assert.match(markup, /class="tasks-browser"/);
  assert.match(markup, /class="task-inspector"/);
  assert.match(markup, /Send a package/);
  assert.match(markup, /role="listbox" aria-label="Tasks"/);
  assert.match(markup, /data-task-option="true"[^>]*tabindex="0"/);
  assert.doesNotMatch(markup, />Workspace</);
  assert.doesNotMatch(markup, />Current group</);
  assert.equal(markup.match(/class="task-pane-count"/g)?.length, 1);
  assert.doesNotMatch(markup, /Implement Castle Records/);
  assert.doesNotMatch(markup, /aria-label="Create project"/);
  assert.doesNotMatch(markup, /aria-label="Create task"/);
  assert.doesNotMatch(markup, /aria-label="Add task group"/);
  assert.doesNotMatch(markup, /draggable="true"/);
});

test("orders task projects with saved positions while keeping new projects visible", () => {
  const projects = [
    { id: "project_alpha", title: "Alpha" },
    { id: "project_beta", title: "Beta" },
    { id: "project_gamma", title: "Gamma" },
  ];

  assert.deepEqual(
    orderProjects(projects, ["project_gamma", "project_alpha", "project_missing"])
      .map((project) => project.id),
    ["project_gamma", "project_alpha", "project_beta"],
  );
});

test("omits the redundant project label from a project-scoped task list", () => {
  const markup = render(
    createElement(TaskBrowser, {
      tasks: [projectTask],
      totalTaskCount: 1,
      selectedTaskId: projectTask.id,
      now: new Date("2026-08-02T12:00:00+02:00"),
      filter: "all",
      filtered: false,
      onClearFilters: () => {},
      onFilterChange: () => {},
      onNewTask: () => {},
      onSelectTask: () => {},
      canCreate: true,
      canEdit: true,
      busyTaskId: null,
      onMoveTask: () => {},
      onStatusChange: () => {},
      onDeleteTask: () => {},
    }),
  );

  assert.match(markup, /Implement Castle Records/);
  assert.doesNotMatch(markup, /tasks-browser-context/);
  assert.doesNotMatch(markup, />Castle</);
});

test("renders the task view switch and Kanban status columns", () => {
  const toggleMarkup = render(
    createElement(TaskViewToggle, { value: "list", onChange: () => {} }),
  );
  const boardMarkup = render(
    createElement(TaskKanban, {
      tasks: [personalTask],
      totalTaskCount: 1,
      selectedTaskId: personalTask.id,
      now: new Date("2026-08-02T12:00:00+02:00"),
      filter: "all",
      filtered: false,
      onClearFilters: () => {},
      onFilterChange: () => {},
      onNewTask: () => {},
      onSelectTask: () => {},
      canCreate: true,
      canEdit: true,
      busyTaskId: null,
      onMoveTask: () => {},
      onStatusChange: () => {},
      onDeleteTask: () => {},
    }),
  );

  assert.match(toggleMarkup, /aria-label="Task view"/);
  assert.match(toggleMarkup, /title="Kanban view"/);
  assert.match(boardMarkup, /aria-label="Task Kanban board"/);
  assert.doesNotMatch(boardMarkup, />Current group</);
  assert.match(boardMarkup, /To do/);
  assert.match(boardMarkup, /In progress/);
  assert.match(boardMarkup, /Blocked/);
  assert.match(boardMarkup, /Done/);
  assert.match(boardMarkup, /Send a package/);
  assert.match(boardMarkup, /aria-orientation="vertical"/);
  assert.match(boardMarkup, /data-task-option="true"[^>]*tabindex="0"/);
  assert.match(boardMarkup, /draggable="true"/);
  assert.match(boardMarkup, /drag-handle-vertical/);
});

test("renders task details as direct editable controls without an edit gate", () => {
  const markup = render(
    createElement(TaskInspector, {
      task: personalTask,
      projects: [project],
      people: [],
      groups: [],
      canEdit: true,
      canDelete: true,
      busy: false,
      error: "",
      onClose: () => {},
      onClearError: () => {},
      onSave: async () => true,
      onStatusChange: async () => true,
      onToggleSubtask: async () => true,
      onAddSubtask: async () => true,
      onRemoveSubtask: async () => true,
      onDelete: async () => true,
    }),
  );

  assert.match(markup, /aria-label="Task title"/);
  assert.match(markup, /aria-label="Task description in Markdown"/);
  assert.match(markup, /aria-label="Task date"/);
  assert.match(markup, /aria-label="Task time"/);
  assert.match(markup, /aria-label="Task estimate"/);
  assert.match(markup, /aria-label="Task final deadline"/);
  assert.match(markup, /aria-label="Task group"/);
  assert.match(markup, /aria-label="Task target person"/);
  assert.match(markup, /aria-label="Task project"/);
  assert.match(markup, /aria-label="Task tags"/);
  assert.match(markup, /class="task-control-trigger"/);
  assert.doesNotMatch(markup, /task-inspector-eyebrow/);
  assert.doesNotMatch(markup, /task-inspector-open-note/);
  assert.doesNotMatch(markup, /<select/);
  assert.doesNotMatch(markup, /type="(?:date|time|number|checkbox)"/);
  assert.doesNotMatch(markup, /Double-click/);
  assert.doesNotMatch(markup, />Edit<\/button>/);
});

test("renders the default temporary checklist", () => {
  const toolMarkup = render(createElement(ChecklistsTool));

  assert.match(toolMarkup, /Quick reset/);
  assert.match(toolMarkup, /Drink some water/);
  assert.match(toolMarkup, /Stand up and stretch/);
  assert.match(toolMarkup, /Focus reset/);
  assert.match(toolMarkup, /0 \/ 2/);
  assert.equal(toolMarkup.match(/type="checkbox"/g)?.length, 2);
  assert.doesNotMatch(toolMarkup, /localStorage|sessionStorage/);
});

test("renders an honest desktop-only state for intelligence on the web", () => {
  const markup = render(createElement(KnowledgeInsightsTool));

  assert.match(markup, /Desktop intelligence/);
  assert.match(markup, /available in Castle Desktop/);
  assert.doesNotMatch(markup, /SQL-backed summaries/);
});

test("renders Stash as a content-first list linking to the full note", () => {
  const stashNote = {
    ...note,
    id: "stash/the_charisma_myth",
    section: "stash",
    sectionLabel: "Stash",
    relativePath: "the_charisma_myth.md",
    sourceFile: "stash/the_charisma_myth.md",
    route: "/note/stash/the-charisma-myth",
    title: "The Charisma Myth",
    excerpt: "A short fallback excerpt.",
    preview: "The complete captured thought shown directly in Stash.",
    createdAt: new Date(2026, 7, 2, 12).toISOString(),
  };
  const markup = render(createElement(StashList, { notes: [stashNote] }));

  assert.match(markup, /Sunday, 2 August 2026/);
  assert.match(markup, /1 item/);
  assert.match(markup, /file-tile--stash/);
  assert.match(markup, /The complete captured thought shown directly in Stash/);
  assert.match(markup, /href="\/note\/stash\/the-charisma-myth"/);
  assert.doesNotMatch(markup, /bp6-icon-inbox/);
  assert.doesNotMatch(markup, />The Charisma Myth</);
});

test("renders standalone YouTube URLs as previews with safe destinations", () => {
  const youtubeUrl = "https://www.youtube.com/watch?v=QrgGy-pki1Y";
  const youtubeNote = {
    ...note,
    id: "stash/youtube_qrggy_pki1y_1",
    route: "/note/stash/youtube_qrggy_pki1y_1",
    preview: youtubeUrl,
  };
  const markup = render(createElement(StashList, { notes: [youtubeNote] }));

  assert.match(
    markup,
    /src="https:\/\/www\.youtube-nocookie\.com\/embed\/QrgGy-pki1Y"/,
  );
  assert.match(markup, /href="https:\/\/www\.youtube\.com\/watch\?v=QrgGy-pki1Y"/);
  assert.match(markup, /href="\/note\/stash\/youtube_qrggy_pki1y_1"/);
});

test("renders stash links as a directly clickable list beside the full-note action", () => {
  const linkNote = {
    ...note,
    id: "stash/useful_links",
    route: "/note/stash/useful_links",
    preview: "https://example.com/first\nhttps://example.com/second",
  };
  const markup = render(createElement(StashList, { notes: [linkNote] }));

  assert.match(markup, /class="stash-link-list"/);
  assert.match(markup, /file-tile-stash-preview--link-only/);
  assert.match(markup, /href="https:\/\/example\.com\/first"/);
  assert.match(markup, /href="https:\/\/example\.com\/second"/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /href="\/note\/stash\/useful_links"/);
  assert.doesNotMatch(markup, /<a[^>]*href="\/note\/stash\/useful_links"[^>]*>[\s\S]*<a/u);
});

test("limits the initial stash render and offers another page", () => {
  const manyNotes = Array.from({ length: 3_214 }, (_, index) => ({
    ...note,
    id: `stash/entry_${index}`,
    route: `/note/stash/entry_${index}`,
    preview: `Entry ${index}`,
    createdAt: new Date(2026, 7, 2, 12, 0, 0, index).toISOString(),
  }));
  const markup = render(createElement(StashList, { notes: manyNotes }));

  assert.equal(markup.match(/file-tile--stash/g)?.length, 24);
  assert.match(markup, /Load 24 more/);
  assert.match(markup, /3190 remaining/);
  assert.match(markup, /3214 items/);
});

function render(element, platform = webCastlePlatform) {
  const originalError = console.error;
  console.error = (message, ...args) => {
    if (!String(message).includes("useLayoutEffect does nothing on the server")) {
      originalError(message, ...args);
    }
  };
  try {
    return renderToStaticMarkup(
      createElement(
        CastlePlatformProvider,
        { platform },
        createElement(
          MemoryRouter,
          { initialEntries: ["/"] },
          createElement(CastleContextMenuProvider, null, element),
        ),
      ),
    );
  } finally {
    console.error = originalError;
  }
}

function desktopPlatformWithCanvasPreviews(supportsCanvasWebPreviews) {
  return {
    ...webCastlePlatform,
    runtime: "desktop",
    desktopServices: { supportsCanvasWebPreviews },
  };
}

function task(id, title, projectValue) {
  return {
    id,
    noteId: id,
    route: `/note/tasks/${id}`,
    title,
    description: `${title}.`,
    status: "todo",
    targetDate: "2026-08-01",
    targetTime: "",
    estimateMinutes: 0,
    createdAt: "2026-08-01",
    completedAt: "",
    sortOrder: 1000,
    modifiedAt: "2026-08-01T12:00:00.000Z",
    tags: [],
    people: [],
    project: projectValue,
    subtasks: [],
  };
}
