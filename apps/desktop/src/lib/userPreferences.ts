import { useEffect, useSyncExternalStore } from "react";
import {
  defaultCastleUserPreferences,
  parseCastleUserPreferences,
  type CastleUserPreferences,
} from "../platform/user_preferences";
import { navigationTabs, type NavigationTabId } from "./navigationPreferences";

const storageKeys = {
  sidebarCollapsed: "castle.sidebar-collapsed.v1",
  autoHideSidebar: "castle.auto-hide-sidebar.v1",
  hiddenNavigationTabs: "castle.navigation-visibility.v1",
  sidebarNoteView: "castle.sidebar-note-view.v1",
  pinnedNoteIds: "castle.pinned-note-ids.v1",
  pinnedFolderRoutes: "castle.pinned-folder-routes.v1",
  libraryViewMode: "castle.library-view.v1",
  taskViewMode: "castle.task-view.v1",
  taskGroups: "castle.task-groups.v1",
  taskProjectFolders: "castle.task-project-folders.v1",
  taskProjectOrder: "castle.task-project-order.v1",
  noteView: "castle.view-settings.v1",
} as const;

const navigationTabIds = new Set<string>(navigationTabs.map((tab) => tab.id));
const listeners = new Set<() => void>();
let preferences = typeof window === "undefined"
  ? {
    ...defaultCastleUserPreferences,
    taskGroups: {},
    taskProjectFolders: [],
    taskProjectOrder: [],
  }
  : readLegacyPreferences();
let hydrationStarted = false;
let revision = 0;

export function useCastleUserPreferences() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    hydrateDesktopPreferences();
  }, []);
  return snapshot;
}

export function updateCastleUserPreferences(
  update: (current: CastleUserPreferences) => CastleUserPreferences,
) {
  const next = parseCastleUserPreferences(update(preferences));
  if (!next) throw new Error("Castle rejected invalid user preferences.");
  revision += 1;
  replacePreferences(next);
  if (typeof window === "undefined") return;
  void window.castleDesktop?.saveUserPreferences(next).catch((reason: unknown) => {
    console.error("Castle could not save interface preferences", reason);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return preferences;
}

function replacePreferences(next: CastleUserPreferences) {
  preferences = next;
  writeLegacyPreferences(next);
  for (const listener of listeners) listener();
}

function hydrateDesktopPreferences() {
  if (typeof window === "undefined" || hydrationStarted || !window.castleDesktop) {
    return;
  }
  hydrationStarted = true;
  const startingRevision = revision;
  void window.castleDesktop
    .loadUserPreferences()
    .then((stored) => {
      if (revision !== startingRevision) return;
      if (stored) {
        replacePreferences(stored);
        return;
      }
      return window.castleDesktop?.saveUserPreferences(preferences);
    })
    .catch((reason: unknown) => {
      console.error("Castle could not load interface preferences", reason);
    });
}

function readLegacyPreferences(): CastleUserPreferences {
  try {
    const noteView = readObject(window.localStorage.getItem(storageKeys.noteView));
    const storedHiddenNavigationTabs = window.localStorage.getItem(
      storageKeys.hiddenNavigationTabs,
    );
    return {
      schemaVersion: 1,
      sidebarCollapsed: window.localStorage.getItem(storageKeys.sidebarCollapsed) === "true",
      autoHideSidebar: window.localStorage.getItem(storageKeys.autoHideSidebar) === "true",
      hiddenNavigationTabs: (storedHiddenNavigationTabs === null
        ? defaultCastleUserPreferences.hiddenNavigationTabs
        : readStringArray(storedHiddenNavigationTabs)
      ).filter((tabId) => navigationTabIds.has(tabId)),
      sidebarNoteView:
        window.localStorage.getItem(storageKeys.sidebarNoteView) === "pinned"
          ? "pinned"
          : "recent",
      pinnedNoteIds: readStringArray(
        window.localStorage.getItem(storageKeys.pinnedNoteIds),
      ),
      pinnedFolderRoutes: readStringArray(
        window.localStorage.getItem(storageKeys.pinnedFolderRoutes),
      ),
      libraryViewMode:
        window.localStorage.getItem(storageKeys.libraryViewMode) === "grid"
          ? "grid"
          : "list",
      taskViewMode:
        window.localStorage.getItem(storageKeys.taskViewMode) === "kanban"
          ? "kanban"
          : "list",
      taskGroups: readStringArrayRecord(
        window.localStorage.getItem(storageKeys.taskGroups),
      ),
      taskProjectFolders: readTaskProjectFolders(
        window.localStorage.getItem(storageKeys.taskProjectFolders),
      ),
      taskProjectOrder: readStringArray(
        window.localStorage.getItem(storageKeys.taskProjectOrder),
      ),
      readingProgress:
        typeof noteView.readingProgress === "boolean"
          ? noteView.readingProgress
          : defaultCastleUserPreferences.readingProgress,
      tableOfContents:
        typeof noteView.tableOfContents === "boolean"
          ? noteView.tableOfContents
          : defaultCastleUserPreferences.tableOfContents,
    };
  } catch {
    return {
      ...defaultCastleUserPreferences,
      taskGroups: {},
      taskProjectFolders: [],
      taskProjectOrder: [],
    };
  }
}

function writeLegacyPreferences(next: CastleUserPreferences) {
  try {
    window.localStorage.setItem(storageKeys.sidebarCollapsed, String(next.sidebarCollapsed));
    window.localStorage.setItem(storageKeys.autoHideSidebar, String(next.autoHideSidebar));
    window.localStorage.setItem(
      storageKeys.hiddenNavigationTabs,
      JSON.stringify(next.hiddenNavigationTabs),
    );
    window.localStorage.setItem(storageKeys.sidebarNoteView, next.sidebarNoteView);
    window.localStorage.setItem(storageKeys.pinnedNoteIds, JSON.stringify(next.pinnedNoteIds));
    window.localStorage.setItem(
      storageKeys.pinnedFolderRoutes,
      JSON.stringify(next.pinnedFolderRoutes),
    );
    window.localStorage.setItem(storageKeys.libraryViewMode, next.libraryViewMode);
    window.localStorage.setItem(storageKeys.taskViewMode, next.taskViewMode);
    window.localStorage.setItem(storageKeys.taskGroups, JSON.stringify(next.taskGroups));
    window.localStorage.setItem(
      storageKeys.taskProjectFolders,
      JSON.stringify(next.taskProjectFolders),
    );
    window.localStorage.setItem(
      storageKeys.taskProjectOrder,
      JSON.stringify(next.taskProjectOrder),
    );
    window.localStorage.setItem(
      storageKeys.noteView,
      JSON.stringify({
        readingProgress: next.readingProgress,
        tableOfContents: next.tableOfContents,
      }),
    );
  } catch {
    // Browser storage is only a compatibility cache for the web version.
  }
}

function readTaskProjectFolders(
  value: string | null,
): CastleUserPreferences["taskProjectFolders"] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const knownProjectIds = new Set<string>();
    return parsed.flatMap((folder) => {
      if (!folder || typeof folder !== "object" || Array.isArray(folder)) return [];
      const candidate = folder as Record<string, unknown>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.title !== "string" ||
        !Array.isArray(candidate.projectIds) ||
        !candidate.projectIds.every((projectId) => typeof projectId === "string")
      ) {
        return [];
      }
      const id = candidate.id.trim();
      const title = candidate.title.trim();
      if (!id || !title) return [];
      const projectIds = [...new Set(candidate.projectIds)].filter((projectId) => {
        if (knownProjectIds.has(projectId)) return false;
        knownProjectIds.add(projectId);
        return true;
      });
      return [{ id, title, projectIds }];
    });
  } catch {
    return [];
  }
}

function readObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function readStringArray(value: string | null) {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? [...new Set(parsed.filter((item): item is string => typeof item === "string"))]
    : [];
}

function readStringArrayRecord(value: string | null): Record<string, string[]> {
  const parsed = readObject(value);
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([workspace, groups]) =>
      Array.isArray(groups) && groups.every((group) => typeof group === "string")
        ? [[workspace, [...new Set(groups)]]]
        : [],
    ),
  );
}

export function hiddenNavigationTabSet(preferences: CastleUserPreferences) {
  return new Set(
    preferences.hiddenNavigationTabs.filter(
      (tabId): tabId is NavigationTabId => navigationTabIds.has(tabId),
    ),
  );
}
