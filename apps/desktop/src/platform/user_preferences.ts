export type CastleSidebarNoteView = "recent" | "pinned";
export type CastleLibraryViewMode = "list" | "grid";
export type CastleTaskViewMode = "list" | "kanban";

export interface CastleTaskProjectFolder {
  id: string;
  title: string;
  projectIds: string[];
}

export interface CastleUserPreferences {
  schemaVersion: 1;
  sidebarCollapsed: boolean;
  autoHideSidebar: boolean;
  hiddenNavigationTabs: string[];
  sidebarNoteView: CastleSidebarNoteView;
  pinnedNoteIds: string[];
  pinnedFolderRoutes: string[];
  libraryViewMode: CastleLibraryViewMode;
  taskViewMode: CastleTaskViewMode;
  taskGroups: Record<string, string[]>;
  taskProjectFolders: CastleTaskProjectFolder[];
  taskProjectOrder: string[];
  readingProgress: boolean;
  tableOfContents: boolean;
}

export const defaultCastleUserPreferences: CastleUserPreferences = Object.freeze({
  schemaVersion: 1,
  sidebarCollapsed: false,
  autoHideSidebar: false,
  hiddenNavigationTabs: [],
  sidebarNoteView: "recent",
  pinnedNoteIds: [],
  pinnedFolderRoutes: [],
  libraryViewMode: "list",
  taskViewMode: "list",
  taskGroups: {},
  taskProjectFolders: [],
  taskProjectOrder: [],
  readingProgress: true,
  tableOfContents: true,
});

export function parseCastleUserPreferences(
  value: unknown,
): CastleUserPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const preferences = value as Record<string, unknown>;
  const expectedKeys = new Set([
    "schemaVersion",
    "sidebarCollapsed",
    "autoHideSidebar",
    "hiddenNavigationTabs",
    "sidebarNoteView",
    "pinnedNoteIds",
    "pinnedFolderRoutes",
    "libraryViewMode",
    "taskViewMode",
    "taskGroups",
    "taskProjectFolders",
    "taskProjectOrder",
    "readingProgress",
    "tableOfContents",
  ]);
  if (Object.keys(preferences).some((key) => !expectedKeys.has(key))) return null;
  if (
    preferences.schemaVersion !== 1 ||
    typeof preferences.sidebarCollapsed !== "boolean" ||
    (preferences.autoHideSidebar !== undefined &&
      typeof preferences.autoHideSidebar !== "boolean") ||
    !isStringArray(preferences.hiddenNavigationTabs) ||
    !["recent", "pinned"].includes(String(preferences.sidebarNoteView)) ||
    !isStringArray(preferences.pinnedNoteIds) ||
    (preferences.pinnedFolderRoutes !== undefined &&
      !isStringArray(preferences.pinnedFolderRoutes)) ||
    !["list", "grid"].includes(String(preferences.libraryViewMode)) ||
    !["list", "kanban"].includes(String(preferences.taskViewMode)) ||
    !isStringArrayRecord(preferences.taskGroups) ||
    (preferences.taskProjectFolders !== undefined &&
      !isTaskProjectFolders(preferences.taskProjectFolders)) ||
    (preferences.taskProjectOrder !== undefined &&
      !isStringArray(preferences.taskProjectOrder)) ||
    typeof preferences.readingProgress !== "boolean" ||
    typeof preferences.tableOfContents !== "boolean"
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    sidebarCollapsed: preferences.sidebarCollapsed,
    autoHideSidebar: preferences.autoHideSidebar === true,
    hiddenNavigationTabs: uniqueStrings(preferences.hiddenNavigationTabs),
    sidebarNoteView: preferences.sidebarNoteView as CastleSidebarNoteView,
    pinnedNoteIds: uniqueStrings(preferences.pinnedNoteIds),
    pinnedFolderRoutes:
      preferences.pinnedFolderRoutes === undefined
        ? []
        : uniqueStrings(preferences.pinnedFolderRoutes as string[]),
    libraryViewMode: preferences.libraryViewMode as CastleLibraryViewMode,
    taskViewMode: preferences.taskViewMode as CastleTaskViewMode,
    taskGroups: Object.fromEntries(
      Object.entries(preferences.taskGroups).map(([workspace, groups]) => [
        workspace,
        uniqueStrings(groups),
      ]),
    ),
    taskProjectFolders:
      preferences.taskProjectFolders === undefined
        ? []
        : normalizeTaskProjectFolders(preferences.taskProjectFolders),
    taskProjectOrder:
      preferences.taskProjectOrder === undefined
        ? []
        : uniqueStrings(preferences.taskProjectOrder as string[]),
    readingProgress: preferences.readingProgress,
    tableOfContents: preferences.tableOfContents,
  };
}

function isTaskProjectFolders(value: unknown): value is CastleTaskProjectFolder[] {
  return Array.isArray(value) &&
    value.length <= 200 &&
    value.every((folder) => {
      if (!folder || typeof folder !== "object" || Array.isArray(folder)) return false;
      const candidate = folder as Record<string, unknown>;
      return typeof candidate.id === "string" && candidate.id.length > 0 &&
        candidate.id.length <= 512 &&
        typeof candidate.title === "string" && candidate.title.trim().length > 0 &&
        candidate.title.length <= 512 &&
        isStringArray(candidate.projectIds);
    });
}

function normalizeTaskProjectFolders(folders: CastleTaskProjectFolder[]) {
  const folderIds = new Set<string>();
  const projectIds = new Set<string>();
  return folders.flatMap((folder) => {
    const id = folder.id.trim();
    const title = folder.title.trim();
    if (!id || !title || folderIds.has(id)) return [];
    folderIds.add(id);
    const uniqueProjectIds = uniqueStrings(folder.projectIds).filter((projectId) => {
      if (projectIds.has(projectId)) return false;
      projectIds.add(projectId);
      return true;
    });
    return [{ id, title, projectIds: uniqueProjectIds }];
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length <= 1_000 &&
    value.every((item) => typeof item === "string" && item.length <= 2_048);
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length <= 1_000 &&
    Object.entries(value).every(
      ([key, groups]) => key.length > 0 && key.length <= 512 && isStringArray(groups),
    );
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)];
}
