import type {
  CalendarEvent,
  GraphNode,
  Note,
  Project,
  Task,
  TaskStatus,
} from "../../types";
import type {
  CastleContextMenuAction,
  CastleContextMenuModel,
} from "./context_menu_types";

const taskStatusLabels: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export function createNoteContextMenu(
  note: Note,
  kind = "Note",
  actions: { onEdit?: () => void } = {},
): CastleContextMenuModel {
  const sourceActions: CastleContextMenuAction[] = [
    ...(actions.onEdit
      ? [callbackAction("edit", `Edit ${kind.toLocaleLowerCase()}`, "edit", actions.onEdit)]
      : []),
    moveSourceAction(note, "move", "Move to…", "folder-shared"),
    moveSourceAction(note, "rename", "Rename", "text-highlight"),
  ];

  return {
    kind,
    subject: note.title,
    groups: [
      destinationGroup(note.route),
      {
        id: "copy",
        actions: [
          copyRouteAction(note.route),
          copyAction(
            "copy-obsidian-link",
            "Copy Obsidian link",
            "clipboard",
            createObsidianLink(note.sourceFile, note.title),
            "Obsidian link copied",
          ),
          copyAction(
            "copy-record-id",
            "Copy record ID",
            "id-number",
            note.id,
            "Record ID copied",
          ),
        ],
      },
      {
        id: "edit",
        actions: sourceActions,
      },
    ],
  };
}

export function createStashContextMenu(note: Note): CastleContextMenuModel {
  const menu = createNoteContextMenu(note, "Stash item");
  return {
    ...menu,
    groups: [
      menu.groups[0],
      menu.groups[1],
      {
        id: "organize",
        actions: [
          moveSourceAction(
            note,
            "move",
            "Move to library…",
            "folder-shared",
          ),
        ],
      },
    ],
  };
}

export function createFolderContextMenu({
  label,
  route,
  isPinned = false,
  onCreateNote,
  onTogglePin,
  onRemove,
}: {
  label: string;
  route: string;
  isPinned?: boolean;
  onCreateNote?: () => void;
  onTogglePin?: () => void;
  onRemove?: () => void;
}): CastleContextMenuModel {
  return {
    kind: "Folder",
    subject: label,
    groups: [
      destinationGroup(route),
      ...(onTogglePin
        ? [
            {
              id: "pin",
              actions: [
                callbackAction(
                  "toggle-pin",
                  isPinned ? "Remove from Pinned" : "Add to Pinned",
                  "pin",
                  onTogglePin,
                ),
              ],
            },
          ]
        : []),
      { id: "copy", actions: [copyRouteAction(route)] },
      ...(onCreateNote
        ? [{
            id: "create",
            actions: [
              callbackAction(
                "new-note",
                "New note here",
                "new-object",
                onCreateNote,
              ),
            ],
          }]
        : []),
      ...(onRemove
        ? [{
            id: "danger",
            actions: [
              {
                ...callbackAction("delete", "Remove folder…", "trash", onRemove),
                intent: "danger" as const,
              },
            ],
          }]
        : []),
    ],
  };
}

export function createFolderContentsContextMenu({
  label,
  onCreateFolder,
  onCreateNote,
}: {
  label: string;
  onCreateFolder: () => void;
  onCreateNote: () => void;
}): CastleContextMenuModel {
  return {
    kind: "Folder",
    subject: label,
    groups: [
      {
        id: "create",
        actions: [
          callbackAction(
            "new-note",
            "New note",
            "new-object",
            onCreateNote,
          ),
          callbackAction(
            "new-folder",
            "New folder",
            "new-object",
            onCreateFolder,
          ),
        ],
      },
    ],
  };
}

export function createTaskContextMenu(
  task: Task,
  actions: {
    onEdit?: () => void;
    onStatusChange?: (status: TaskStatus) => void;
    onDelete?: () => void;
  } = {},
): CastleContextMenuModel {
  const taskActions: CastleContextMenuAction[] = [
    ...(actions.onEdit
      ? [callbackAction("edit", "Edit task", "edit", actions.onEdit)]
      : []),
    ...(actions.onStatusChange
      ? [{
          id: "set-status",
          label: "Set status",
          icon: "exchange" as const,
          children: (Object.keys(taskStatusLabels) as TaskStatus[]).map(
            (status) => ({
              ...callbackAction(
                `status-${status}`,
                taskStatusLabels[status],
                status === "done" ? "tick-circle" : "circle",
                () => actions.onStatusChange?.(status),
              ),
              disabled: status === task.status,
            }),
          ),
        }]
      : []),
    ...(actions.onEdit
      ? [callbackAction("due-date", "Change due date…", "calendar", actions.onEdit)]
      : []),
  ];

  return {
    kind: "Task",
    subject: task.title,
    groups: [
      destinationGroup(task.route),
      {
        id: "copy",
        actions: [
          copyRouteAction(task.route),
          copyAction(
            "copy-obsidian-link",
            "Copy Obsidian link",
            "clipboard",
            createObsidianLinkFromRoute(task.route, task.title),
            "Obsidian link copied",
          ),
          copyAction(
            "copy-record-id",
            "Copy record ID",
            "id-number",
            task.id,
            "Task ID copied",
          ),
        ],
      },
      ...(taskActions.length > 0
        ? [{ id: "task", actions: taskActions }]
        : []),
      ...(actions.onDelete
        ? [{
            id: "danger",
            actions: [{
              ...callbackAction("delete", "Delete task", "trash", actions.onDelete),
              intent: "danger" as const,
            }],
          }]
        : []),
    ],
  };
}

export function createProjectContextMenu(
  project: Project,
): CastleContextMenuModel {
  return {
    kind: "Project",
    subject: project.title,
    groups: [
      destinationGroup(project.route),
      {
        id: "copy",
        actions: [
          copyRouteAction(project.route),
          copyAction(
            "copy-obsidian-link",
            "Copy Obsidian link",
            "clipboard",
            createObsidianLinkFromRoute(project.route, project.title),
            "Obsidian link copied",
          ),
          copyAction(
            "copy-record-id",
            "Copy record ID",
            "id-number",
            project.id,
            "Project ID copied",
          ),
        ],
      },
    ],
  };
}

export function createPersonContextMenu(
  person: GraphNode,
): CastleContextMenuModel {
  const groups: CastleContextMenuModel["groups"] = [];
  if (person.href) groups.push(destinationGroup(person.href));
  groups.push(
    {
      id: "copy",
      actions: [
        ...(person.href ? [copyRouteAction(person.href)] : []),
        ...(person.href
          ? [
              copyAction(
                "copy-obsidian-link",
                "Copy Obsidian link",
                "clipboard",
                createObsidianLinkFromRoute(person.href, person.label),
                "Obsidian link copied",
              ),
            ]
          : []),
        copyAction(
          "copy-record-id",
          "Copy record ID",
          "id-number",
          person.id,
          "Person ID copied",
        ),
      ],
    },
  );
  return { kind: "Person", subject: person.label, groups };
}

export function createGraphNodeContextMenu(
  node: GraphNode,
  onFocus?: () => void,
): CastleContextMenuModel {
  if (node.type === "person") {
    const menu = createPersonContextMenu(node);
    if (!onFocus) return menu;
    return {
      ...menu,
      groups: [
        ...menu.groups,
        {
          id: "graph",
          actions: [callbackAction("focus-graph", "Focus node", "locate", onFocus)],
        },
      ],
    };
  }

  return {
    kind: node.type.charAt(0).toLocaleUpperCase() + node.type.slice(1),
    subject: node.label,
    groups: [
      ...(onFocus
        ? [{
            id: "graph",
            actions: [callbackAction("focus-graph", "Focus node", "locate", onFocus)],
          }]
        : []),
      {
        id: "copy",
        actions: [
          copyAction(
            "copy-node-id",
            "Copy node ID",
            "id-number",
            node.id,
            "Node ID copied",
          ),
        ],
      },
    ],
  };
}

export function createCalendarEventContextMenu(
  event: CalendarEvent,
): CastleContextMenuModel {
  return {
    kind: "Calendar event",
    subject: event.title,
    groups: [
      destinationGroup(event.route),
      {
        id: "copy",
        actions: [
          copyRouteAction(event.route),
          copyAction(
            "copy-details",
            "Copy event details",
            "clipboard",
            formatCalendarEventDetails(event),
            "Event details copied",
          ),
          copyAction(
            "copy-record-id",
            "Copy record ID",
            "id-number",
            event.id,
            "Event ID copied",
          ),
        ],
      },
    ],
  };
}

function destinationGroup(route: string): CastleContextMenuModel["groups"][number] {
  return {
    id: "open",
    actions: [
      {
        id: "open",
        label: "Open",
        icon: "document-open",
        operation: { type: "navigate", to: route },
      },
      {
        id: "open-new-tab",
        label: "Open in new tab",
        icon: "share",
        operation: { type: "navigate", to: route, newTab: true },
      },
    ],
  };
}

function copyRouteAction(route: string): CastleContextMenuAction {
  return {
    id: "copy-castle-link",
    label: "Copy Castle link",
    icon: "link",
    operation: {
      type: "copy-route",
      route,
      feedback: "Castle link copied",
    },
  };
}

function copyAction(
  id: string,
  label: string,
  icon: CastleContextMenuAction["icon"],
  value: string,
  feedback: string,
): CastleContextMenuAction {
  return {
    id,
    label,
    icon,
    operation: { type: "copy", value, feedback },
  };
}

function callbackAction(
  id: string,
  label: string,
  icon: CastleContextMenuAction["icon"],
  execute: () => void,
): CastleContextMenuAction {
  return {
    id,
    label,
    icon,
    operation: { type: "callback", execute },
  };
}

function moveSourceAction(
  note: Note,
  mode: "move" | "rename",
  label: string,
  icon: CastleContextMenuAction["icon"],
): CastleContextMenuAction {
  return {
    id: mode,
    label,
    icon,
    operation: {
      type: "move-source",
      mode,
      noteId: note.id,
      sourceFile: note.sourceFile,
      route: note.route,
    },
  };
}

function createObsidianLink(sourceFile: string, title: string) {
  return `[[${sourceFile.replace(/\.md$/u, "")}|${title}]]`;
}

function createObsidianLinkFromRoute(route: string, title: string) {
  return `[[${decodeURIComponent(route.replace(/^\/note\//u, ""))}|${title}]]`;
}

function formatCalendarEventDetails(event: CalendarEvent) {
  const time = event.endTime
    ? `${event.startTime}–${event.endTime}`
    : event.startTime;
  return `${event.title}\n${event.date} · ${time}${
    event.description ? `\n${event.description}` : ""
  }`;
}
