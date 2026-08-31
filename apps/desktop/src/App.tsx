import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ErrorBoundary, WorkspaceShell } from "@patkepa/kantzen-ui/app-shell";
import type { NavGroup } from "@patkepa/kantzen-ui/navigation";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
  useNavigate,
} from "react-router-dom";
import { FolderPage } from "./components/FolderPage";
import { LibraryHome } from "./components/LibraryHome";
import { LibraryBreadcrumb } from "./components/LibraryBreadcrumb";
import { NotFoundPage } from "./components/NotFoundPage";
import { ViewSettingsMenu } from "./components/ViewSettingsMenu";
import { SidebarNoteCollection } from "./components/SidebarNoteCollection";
import {
  createFolderRoute,
  decodeFolderPath,
  getNoteDirectory,
  getPinnedFolder,
  humanizePathSegment,
} from "./lib/libraryPaths";
import {
  addNoteJump,
  getPreviousNoteJumps,
} from "./lib/noteNavigationHistory";
import {
  announceGeneratedContentChange,
} from "./lib/generatedData";
import type { KnowledgeBase, Note, SectionSummary } from "./types";
import {
  KnowledgeBaseStoreProvider,
  useKnowledgeBaseStore,
} from "./app/knowledge_base_store";
import { useRouteKnowledgeSnapshot } from "./app/useRouteKnowledgeSnapshot";
import { createDocumentRouteMap } from "./lib/builtInDocuments";
import {
  getVisibleNavigationTabs,
  type NavigationTabId,
} from "./lib/navigationPreferences";
import {
  movePinnedNoteBy,
  reorderPinnedNoteIds,
  type SidebarNoteView,
} from "./lib/sidebarNotePreferences";
import { useKeyboardShortcut } from "./keyboard/use_keyboard_shortcut";
import {
  hiddenNavigationTabSet,
  updateCastleUserPreferences,
  useCastleUserPreferences,
} from "./lib/userPreferences";
import {
  createSheetFolderRoute,
  decodeSheetRoutePath,
  getSheetDirectory,
} from "./features/sheets/sheet_library";
import { formatLocalDateKey } from "./lib/calendarDate";
import { useCastlePlatform } from "./platform/castle_platform_provider";
import type {
  CreateCastleSourceInput,
} from "./platform/castle_platform";
import type {
  CastlePaletteAction,
} from "./features/castle_actions/castleActionModels";

const LazyNotePage = lazy(() =>
  Promise.all([
    import("./components/NotePage"),
    import("./styles/reading.css"),
  ]).then(([module]) => ({ default: module.NotePage })),
);
const LazyRelationshipGraphPage = lazy(() =>
  Promise.all([
    import("./features/relationships/RelationshipGraphPage"),
    import("@patkepa/kantzen-ui/graph/styles.css"),
    import("./styles/reading.css"),
    import("./styles/relationships.css"),
  ]).then(([module]) => ({ default: module.RelationshipGraphPage })),
);
const LazyCalendarPage = lazy(() =>
  Promise.all([
    import("./features/calendar/CalendarPage"),
    import("./styles/calendar.css"),
  ]).then(([module]) => ({ default: module.CalendarPage })),
);
const LazyTasksPage = lazy(() =>
  Promise.all([
    import("./features/tasks/TasksPage"),
    import("./styles/tasks.css"),
  ]).then(([module]) => ({ default: module.TasksPage })),
);
const LazyProjectsPage = lazy(() =>
  Promise.all([
    import("./features/projects/ProjectsPage"),
    import("./styles/projects.css"),
    import("./styles/reading.css"),
  ]).then(([module]) => ({ default: module.ProjectsPage })),
);
const LazyShortcutsPage = lazy(() =>
  import("./components/ShortcutsPage").then((module) => ({
    default: module.ShortcutsPage,
  })),
);
const LazySheetFilePage = lazy(() =>
  Promise.all([
    import("./features/sheets/SheetsPage"),
    import("./styles/sheets.css"),
  ]).then(([module]) => ({ default: module.SheetFilePage })),
);
const LazySheetsLibraryPage = lazy(() =>
  Promise.all([
    import("./features/sheets/SheetsPage"),
    import("./styles/sheets.css"),
  ]).then(([module]) => ({ default: module.SheetsLibraryPage })),
);
const LazyCanvasPage = lazy(() =>
  Promise.all([
    import("./features/canvas/CanvasPage"),
    import("./styles/canvas.css"),
  ]).then(([module]) => ({ default: module.CanvasPage })),
);
const LazyNoteSearchPalette = lazy(() =>
  import("./components/NoteSearchPalette").then((module) => ({
    default: module.NoteSearchPalette,
  })),
);
const LazyAiChatSidebar = lazy(() =>
  import("./components/ai-chat/AiChatSidebar").then((module) => ({
    default: module.AiChatSidebar,
  })),
);
export function App() {
  const location = useLocation();
  const [notesRequested, setNotesRequested] = useState(false);
  const {
    error,
    loading,
    reload,
    notesComplete,
    snapshot,
  } = useRouteKnowledgeSnapshot(
    location.pathname,
    notesRequested,
  );
  const requireNotes = useCallback(() => setNotesRequested(true), []);

  if (error) {
    return (
      <div className="missing-note catalog-error" role="alert">
        <h1>Castle could not start</h1>
        <p>The knowledge-base resources could not be loaded.</p>
        <button type="button" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }

  if (!snapshot) {
    return <RouteLoading label="Opening the Castle…" />;
  }

  return (
    <KnowledgeBaseStoreProvider snapshot={snapshot}>
      <DesktopContentBridge />
      <CastleApp
        notesComplete={notesComplete}
        onRequireNotes={requireNotes}
        routeResourcesLoading={loading}
      />
    </KnowledgeBaseStoreProvider>
  );
}

function CastleApp({
  notesComplete,
  onRequireNotes,
  routeResourcesLoading,
}: {
  notesComplete: boolean;
  onRequireNotes: () => void;
  routeResourcesLoading: boolean;
}) {
  const { knowledgeBase, replaceTasks } = useKnowledgeBaseStore();
  const location = useLocation();
  const navigate = useNavigate();
  const platform = useCastlePlatform();
  const preferences = useCastleUserPreferences();
  const reservedActionSourceFiles = useRef(new Set<string>());
  const reservedActionEntityIds = useRef(new Set<string>());
  const [sidebarRevealed, setSidebarRevealed] = useState(false);
  const autoHideSidebar = preferences.autoHideSidebar;
  const sidebarCollapsed = autoHideSidebar
    ? !sidebarRevealed
    : preferences.sidebarCollapsed;
  const hiddenNavigationTabs = hiddenNavigationTabSet(preferences);
  const sidebarNoteView = preferences.sidebarNoteView;
  const pinnedFolderRoutes = preferences.pinnedFolderRoutes;
  const pinnedNoteIds = preferences.pinnedNoteIds;
  const librarySections = useMemo(
    () => addSheetsLibrarySection(knowledgeBase.sections),
    [knowledgeBase.sections],
  );
  const libraryKnowledgeBase = useMemo(
    () => ({ ...knowledgeBase, sections: librarySections }),
    [knowledgeBase, librarySections],
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const notesByRoute = useMemo(
    () => createDocumentRouteMap(knowledgeBase.notes),
    [knowledgeBase.notes],
  );
  const notesById = useMemo(
    () => new Map(knowledgeBase.notes.map((note) => [note.id, note])),
    [knowledgeBase.notes],
  );
  const currentLibraryFolder = useMemo(
    () => resolveCurrentLibraryFolder(
      location.pathname,
      notesByRoute,
      knowledgeBase.sections,
    ),
    [knowledgeBase.sections, location.pathname, notesByRoute],
  );
  const pinnedNoteIdSet = useMemo(
    () => new Set(pinnedNoteIds),
    [pinnedNoteIds],
  );
  const pinnedFolderRouteSet = useMemo(
    () => new Set(pinnedFolderRoutes),
    [pinnedFolderRoutes],
  );
  const currentNoteRoute = notesByRoute.has(location.pathname)
    ? location.pathname
    : null;
  const [noteJumpHistory, setNoteJumpHistory] = useState<string[]>(() =>
    currentNoteRoute ? [currentNoteRoute] : [],
  );
  const displayedNoteJumpHistory = useMemo(
    () =>
      currentNoteRoute
        ? addNoteJump(noteJumpHistory, currentNoteRoute)
        : noteJumpHistory,
    [currentNoteRoute, noteJumpHistory],
  );
  const previousNoteJumps = useMemo(
    () =>
      getPreviousNoteJumps(displayedNoteJumpHistory).flatMap((jump) => {
        const note = notesByRoute.get(jump.route);
        return note ? [{ ...jump, note }] : [];
      }),
    [displayedNoteJumpHistory, notesByRoute],
  );
  const navGroups = useMemo(
    () => createNavigation(hiddenNavigationTabs),
    [hiddenNavigationTabs],
  );
  const sidebarRecentNotes = useMemo(
    () =>
      [...knowledgeBase.notes]
        .filter((note) => note.section !== "people")
        .sort(
          (left, right) =>
            Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt),
        )
        .slice(0, 5),
    [knowledgeBase.notes],
  );
  const pinnedNotes = useMemo(
    () =>
      pinnedNoteIds.flatMap((noteId) => {
        const note = notesById.get(noteId);
        return note ? [note] : [];
      }),
    [notesById, pinnedNoteIds],
  );
  const pinnedFolders = useMemo(
    () =>
      pinnedFolderRoutes.flatMap((route) => {
        const folder = getPinnedFolder(
          route,
          librarySections,
          knowledgeBase.notes,
          knowledgeBase.folders,
        );
        return folder ? [folder] : [];
      }),
    [
      knowledgeBase.folders,
      knowledgeBase.notes,
      librarySections,
      pinnedFolderRoutes,
    ],
  );
  const recentNotes = useMemo(
    () =>
      [...knowledgeBase.notes]
        .sort(
          (left, right) =>
            Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt),
        )
        .slice(0, 6),
    [knowledgeBase.notes],
  );
  const breadcrumb = createBreadcrumb(
    location.pathname,
    libraryKnowledgeBase,
    notesByRoute,
  );

  useEffect(() => {
    if (!currentNoteRoute) return;
    setNoteJumpHistory((history) => addNoteJump(history, currentNoteRoute));
  }, [currentNoteRoute]);

  useEffect(() => {
    const currentSourceFiles = new Set(
      knowledgeBase.notes.map((note) => note.sourceFile),
    );
    const currentEntityIds = new Set(
      knowledgeBase.notes.map((note) => note.id),
    );
    for (const sourceFile of reservedActionSourceFiles.current) {
      if (currentSourceFiles.has(sourceFile)) {
        reservedActionSourceFiles.current.delete(sourceFile);
      }
    }
    for (const entityId of reservedActionEntityIds.current) {
      if (currentEntityIds.has(entityId)) {
        reservedActionEntityIds.current.delete(entityId);
      }
    }
  }, [knowledgeBase.notes]);

  useEffect(() => {
    if (pinnedNoteIds.length > 0 || pinnedFolderRoutes.length > 0) {
      onRequireNotes();
    }
  }, [onRequireNotes, pinnedFolderRoutes.length, pinnedNoteIds.length]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 680 && !preferences.sidebarCollapsed) {
        updateCastleUserPreferences((current) => ({
          ...current,
          sidebarCollapsed: true,
        }));
      }
    };
    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, [preferences.sidebarCollapsed]);

  useEffect(() => {
    if (!autoHideSidebar) {
      setSidebarRevealed(false);
      return;
    }

    const revealOrHideSidebar = (event: PointerEvent) => {
      if (event.pointerType === "touch" || window.innerWidth <= 760) return;
      if (event.clientX <= 24) {
        setSidebarRevealed(true);
        return;
      }
      const sidebar = document.querySelector<HTMLElement>(".app-sidebar");
      if (!sidebar) return;
      const bounds = sidebar.getBoundingClientRect();
      const pointerIsInsideSidebar =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;
      if (!pointerIsInsideSidebar) setSidebarRevealed(false);
    };

    const hideSidebar = () => setSidebarRevealed(false);
    window.addEventListener("pointermove", revealOrHideSidebar, { passive: true });
    window.addEventListener("blur", hideSidebar);
    return () => {
      window.removeEventListener("pointermove", revealOrHideSidebar);
      window.removeEventListener("blur", hideSidebar);
    };
  }, [autoHideSidebar]);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "castle-auto-hide-sidebar",
      autoHideSidebar,
    );
    return () => document.documentElement.classList.remove("castle-auto-hide-sidebar");
  }, [autoHideSidebar]);

  const selectPaletteNote = (note: Note) => {
    setPaletteOpen(false);
    navigate(note.route);
  };
  const selectPaletteRoute = (route: string) => {
    setPaletteOpen(false);
    navigate(route);
  };
  const togglePalette = useCallback(
    () => {
      setAiChatOpen(false);
      setPaletteOpen((open) => {
        if (!open) onRequireNotes();
        return !open;
      });
    },
    [onRequireNotes],
  );
  const openPalette = useCallback(() => {
    setAiChatOpen(false);
    onRequireNotes();
    setPaletteOpen(true);
  }, [onRequireNotes]);
  useKeyboardShortcut("search", togglePalette, {
    allowWhenOverlayOpen: paletteOpen,
  });
  const changeAiChatOpen = useCallback((open: boolean) => {
    if (open) setPaletteOpen(false);
    if (open) onRequireNotes();
    setAiChatOpen(open);
  }, [onRequireNotes]);
  const toggleSidebar = useCallback(() => {
    if (autoHideSidebar) {
      setSidebarRevealed((revealed) => !revealed);
      return;
    }
    updateCastleUserPreferences((current) => ({
      ...current,
      sidebarCollapsed: !current.sidebarCollapsed,
    }));
  }, [autoHideSidebar]);
  const persistActionSource = useCallback(async (
    input: CreateCastleSourceInput,
  ) => {
    const mutations = platform.contentMutations;
    if (!mutations || !platform.capabilities.createContent) {
      throw new Error("Creating library content is unavailable.");
    }
    reservedActionSourceFiles.current.add(input.sourceFile);
    reservedActionEntityIds.current.add(input.noteId);
    try {
      await mutations.createSource(input);
    } catch (reason) {
      reservedActionSourceFiles.current.delete(input.sourceFile);
      reservedActionEntityIds.current.delete(input.noteId);
      throw reason;
    }
  }, [platform]);
  const toggleAutoHideSidebar = useCallback(() => {
    updateCastleUserPreferences((current) => ({
      ...current,
      autoHideSidebar: !current.autoHideSidebar,
    }));
    setSidebarRevealed(false);
  }, []);
  const toggleNavigationTab = useCallback((tabId: NavigationTabId) => {
    updateCastleUserPreferences((current) => {
      const next = new Set(current.hiddenNavigationTabs);
      if (next.has(tabId)) {
        next.delete(tabId);
      } else {
        next.add(tabId);
      }
      return { ...current, hiddenNavigationTabs: [...next] };
    });
  }, []);
  const changeSidebarNoteView = useCallback((view: SidebarNoteView) => {
    updateCastleUserPreferences((current) => ({
      ...current,
      sidebarNoteView: view,
    }));
  }, []);
  const togglePinnedNote = useCallback((noteId: string) => {
    updateCastleUserPreferences((current) => {
      const pinnedNoteIds = current.pinnedNoteIds.includes(noteId)
        ? current.pinnedNoteIds.filter((candidate) => candidate !== noteId)
        : [...current.pinnedNoteIds, noteId];
      return { ...current, pinnedNoteIds };
    });
  }, []);
  const removePinnedNote = useCallback((noteId: string) => {
    updateCastleUserPreferences((current) => {
      return {
        ...current,
        pinnedNoteIds: current.pinnedNoteIds.filter((candidate) => candidate !== noteId),
      };
    });
  }, []);
  const togglePinnedFolder = useCallback((route: string) => {
    updateCastleUserPreferences((current) => {
      const pinnedFolderRoutes = current.pinnedFolderRoutes.includes(route)
        ? current.pinnedFolderRoutes.filter((candidate) => candidate !== route)
        : [...current.pinnedFolderRoutes, route];
      return { ...current, pinnedFolderRoutes };
    });
  }, []);
  const removePinnedFolder = useCallback((route: string) => {
    updateCastleUserPreferences((current) => ({
      ...current,
      pinnedFolderRoutes: current.pinnedFolderRoutes.filter(
        (candidate) => candidate !== route,
      ),
    }));
  }, []);
  const reorderPinnedNote = useCallback(
    (movedNoteId: string, targetNoteId: string) => {
      updateCastleUserPreferences((current) => {
        const pinnedNoteIds = reorderPinnedNoteIds(
          current.pinnedNoteIds,
          movedNoteId,
          targetNoteId,
        );
        return { ...current, pinnedNoteIds };
      });
    },
    [],
  );
  const movePinnedNote = useCallback((noteId: string, offset: -1 | 1) => {
    updateCastleUserPreferences((current) => {
      const pinnedNoteIds = movePinnedNoteBy(current.pinnedNoteIds, noteId, offset);
      return { ...current, pinnedNoteIds };
    });
  }, []);
  const navigateToPreviousNote = useCallback(
    (historyIndex: number) => {
      const destination = displayedNoteJumpHistory[historyIndex];
      if (!destination) return;

      setNoteJumpHistory(
        displayedNoteJumpHistory.slice(0, historyIndex + 1),
      );
      navigate(destination);
    },
    [displayedNoteJumpHistory, navigate],
  );

  const canCreateContent = Boolean(
    platform.capabilities.createContent && platform.contentMutations,
  );
  const todayDateKey = formatLocalDateKey(new Date());
  const todayJournalSourceFile =
    `journal/${todayDateKey.slice(0, 4)}/${todayDateKey}.md`;
  const todayJournal = knowledgeBase.notes.find(
    (note) => note.sourceFile === todayJournalSourceFile,
  );
  const castleActions = useMemo<CastlePaletteAction[]>(() => {
    const actions: CastlePaletteAction[] = [];
    const existingSourceFiles = () => new Set([
      ...knowledgeBase.notes.map((note) => note.sourceFile),
      ...reservedActionSourceFiles.current,
    ]);
    const existingEntityIds = () => new Set([
      ...knowledgeBase.notes.map((note) => note.id),
      ...reservedActionEntityIds.current,
    ]);

    if (canCreateContent) {
      actions.push(
        {
          id: "capture-stash",
          label: "Capture to Stash",
          description: "Save a thought or link without leaving your current view.",
          icon: "inbox",
          keywords: ["quick capture", "stash", "inbox", "thought", "link"],
          input: {
            label: "Text to capture",
            placeholder: "Capture a thought, link, or Markdown…",
            submitLabel: "Add to Stash",
          },
          execute: async (input) => {
            const { createStashSourceInput } = await import(
              "./features/stash/stashCapture"
            );
            await persistActionSource(
              createStashSourceInput(input, existingSourceFiles()),
            );
          },
        },
        {
          id: "create-task",
          label: "Create task",
          description: "Create a personal task and open Tasks.",
          icon: "tick-circle",
          keywords: ["new task", "todo", "work"],
          input: {
            label: "Task title",
            placeholder: "What needs to be done?",
            submitLabel: "Create task",
          },
          execute: async (input) => {
            const mutations = platform.contentMutations;
            if (!mutations) throw new Error("Creating tasks is unavailable.");
            const { createQuickTaskFields } = await import(
              "./lib/castleActionCreation"
            );
            const result = await mutations.createTask({
              fields: createQuickTaskFields(input),
            });
            replaceTasks([
              ...knowledgeBase.tasks.filter((task) => task.id !== result.task.id),
              result.task,
            ]);
            navigate("/tasks");
          },
        },
        {
          id: "create-event",
          label: "Create event",
          description: "Create a one-hour event today and open Calendar.",
          icon: "calendar",
          keywords: ["new event", "calendar", "meeting", "appointment"],
          input: {
            label: "Event title",
            placeholder: "What is happening?",
            submitLabel: "Create event",
          },
          execute: async (input) => {
            const {
              buildCalendarEventMarkdown,
              createCalendarEventIdentity,
              emptyCalendarEventFormValues,
            } = await import("./features/calendar/calendarEventMarkdown");
            const now = new Date();
            const date = formatLocalDateKey(now);
            const startTime = `${String(now.getHours()).padStart(2, "0")}:${String(
              now.getMinutes(),
            ).padStart(2, "0")}`;
            const values = {
              ...emptyCalendarEventFormValues(date, startTime),
              title: input,
            };
            const existingEvents = [
              ...knowledgeBase.calendarEvents.map((event) => ({ id: event.id })),
              ...[...reservedActionEntityIds.current]
                .filter((id) => id.startsWith("event_"))
                .map((id) => ({ id })),
            ];
            const identity = createCalendarEventIdentity(values, existingEvents);
            await persistActionSource({
              noteId: identity.noteId,
              sourceFile: identity.sourceFile,
              markdown: buildCalendarEventMarkdown({
                id: identity.id,
                values,
                projects: knowledgeBase.projects,
                people: knowledgeBase.notes.filter((note) => note.section === "people"),
              }),
            });
            navigate(`/calendar?date=${date}`);
          },
        },
        {
          id: "create-person",
          label: "Create person",
          description: "Create a minimal person record in People.",
          icon: "person",
          keywords: ["new person", "people", "contact", "relationship"],
          input: {
            label: "Person name",
            placeholder: "Full name",
            submitLabel: "Create person",
          },
          execute: async (input) => {
            const { createPersonSourceInput } = await import(
              "./lib/castleActionCreation"
            );
            await persistActionSource(
              createPersonSourceInput(input, existingEntityIds()),
            );
            navigate("/browse/people");
          },
        },
        {
          id: "create-project",
          label: "Create project",
          description: "Create an active project record and open Projects.",
          icon: "projects",
          keywords: ["new project", "initiative", "workspace"],
          input: {
            label: "Project title",
            placeholder: "Project title",
            submitLabel: "Create project",
          },
          execute: async (input) => {
            const { createProjectSeed } = await import(
              "./lib/projectCreation"
            );
            const projects = [
              ...knowledgeBase.projects.map((project) => ({ id: project.id })),
              ...[...reservedActionEntityIds.current]
                .filter((id) => id.startsWith("project_"))
                .map((id) => ({ id })),
            ];
            const project = createProjectSeed(input, projects);
            await persistActionSource(project.source);
            navigate("/projects");
          },
        },
      );

      if (currentLibraryFolder) {
        actions.push({
          id: "new-note-current-folder",
          label: "New note in current folder",
          description: `Create Markdown in ${currentLibraryFolder.label}.`,
          icon: "document",
          keywords: ["create note", "markdown", "current folder", "library"],
          input: {
            label: "Note title",
            placeholder: "Note title",
            submitLabel: "Create note",
          },
          execute: async (input) => {
            const { createLibraryNoteSourceInput } = await import(
              "./features/library/libraryNoteCreation"
            );
            await persistActionSource(createLibraryNoteSourceInput(
              input,
              currentLibraryFolder.sectionId,
              currentLibraryFolder.directory,
              existingSourceFiles(),
            ));
          },
        });
      }
    }

    if (todayJournal || canCreateContent) {
      actions.push({
        id: "open-todays-journal",
        label: "Open today’s journal",
        description: todayJournal
          ? `Open the journal entry for ${todayDateKey}.`
          : `Create the journal entry for ${todayDateKey} and open it.`,
        icon: "manual",
        keywords: ["today", "journal", "diary", "daily note"],
        execute: async () => {
          if (todayJournal) {
            navigate(todayJournal.route);
            return;
          }
          const { createJournalSourceInput } = await import(
            "./lib/castleActionCreation"
          );
          const input = createJournalSourceInput(todayDateKey);
          if (!reservedActionSourceFiles.current.has(input.sourceFile)) {
            await persistActionSource(input);
          }
          navigate(`/note/${input.noteId}`);
        },
      });
    }

    actions.push(
      {
        id: "toggle-sidebar",
        label: sidebarCollapsed ? "Show navigation sidebar" : "Hide navigation sidebar",
        description: "Toggle Castle’s left navigation panel.",
        icon: "panel-stats",
        keywords: ["toggle panel", "sidebar", "navigation", "interface"],
        execute: () => toggleSidebar(),
      },
      {
        id: "toggle-ai-panel",
        label: "Open AI panel",
        description: "Switch from Castle Actions to the assistant panel.",
        icon: "chat",
        keywords: ["toggle panel", "assistant", "chat", "interface"],
        execute: () => setAiChatOpen(true),
      },
      {
        id: "toggle-table-of-contents",
        label: preferences.tableOfContents
          ? "Hide On this page panel"
          : "Show On this page panel",
        description: "Toggle the note outline panel.",
        icon: "list",
        keywords: ["toggle panel", "outline", "contents", "interface"],
        execute: () => updateCastleUserPreferences((current) => ({
          ...current,
          tableOfContents: !current.tableOfContents,
        })),
      },
    );
    return actions;
  }, [
    canCreateContent,
    currentLibraryFolder,
    knowledgeBase.calendarEvents,
    knowledgeBase.notes,
    knowledgeBase.projects,
    knowledgeBase.tasks,
    navigate,
    persistActionSource,
    platform.contentMutations,
    preferences.tableOfContents,
    replaceTasks,
    sidebarCollapsed,
    todayDateKey,
    todayJournal,
    toggleSidebar,
  ]);

  return (
    <WorkspaceShell
      productName="The Castle"
      collapsedProductName="TC"
      currentPath={location.pathname}
      navGroups={sidebarCollapsed ? navGroups.slice(0, 2) : navGroups}
      onNavigate={navigate}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={toggleSidebar}
      sidebarShortcutLabel="⌘B"
      breadcrumb={breadcrumb}
      onOpenCommandPalette={openPalette}
      commandPalette={
        paletteOpen && notesComplete ? (
          <Suspense fallback={null}>
            <LazyNoteSearchPalette
              actions={castleActions}
              notes={knowledgeBase.notes}
              sections={knowledgeBase.sections}
              recentNotes={recentNotes}
              open
              onOpenChange={setPaletteOpen}
              onSelectNote={selectPaletteNote}
              onSelectRoute={selectPaletteRoute}
            />
          </Suspense>
        ) : null
      }
    >
        {!sidebarCollapsed ? (
          <SidebarNoteCollection
            onMovePinnedNote={movePinnedNote}
            onRemovePinnedFolder={removePinnedFolder}
            onRemovePinnedNote={removePinnedNote}
            onReorderPinnedNote={reorderPinnedNote}
            onViewChange={changeSidebarNoteView}
            pinnedFolders={pinnedFolders}
            pinnedNotes={pinnedNotes}
            recentNotes={sidebarRecentNotes}
            view={sidebarNoteView}
          />
        ) : null}
        <ErrorBoundary
          action="reload"
          actionLabel="Reload Castle"
          className="castle-error-boundary"
          description={(error) =>
            error.message || "An unexpected rendering error occurred."
          }
          key={location.pathname}
          title="Castle could not display this route"
        >
        {routeResourcesLoading ? (
          <RouteLoading label="Opening this part of the library…" />
        ) : (
        <Routes>
        <Route
          path="/"
          element={
            <Suspense fallback={<RouteLoading label="Opening home…" />}>
              <LazyShortcutsPage collections={knowledgeBase.shortcutCollections} />
            </Suspense>
          }
        />
        <Route
          path="/library"
          element={
            <LibraryHome
              onTogglePinnedFolder={togglePinnedFolder}
              pinnedFolderRoutes={pinnedFolderRouteSet}
              sections={librarySections}
            />
          }
        />
        <Route
          path="/browse/sheets/*"
          element={
            <Suspense fallback={<RouteLoading label="Opening sheets library…" />}>
              <LazySheetsLibraryPage />
            </Suspense>
          }
        />
        <Route
          path="/browse/:sectionId/*"
          element={
            <FolderPage
              notes={knowledgeBase.notes}
              folders={knowledgeBase.folders}
              onTogglePinnedFolder={togglePinnedFolder}
              pinnedFolderRoutes={pinnedFolderRouteSet}
              sections={librarySections}
            />
          }
        />
        <Route path="/section/:sectionId" element={<LegacySectionRedirect />} />
        <Route
          path="/note/*"
          element={
            <Suspense fallback={<RouteLoading label="Loading note…" />}>
              <LazyNotePage
                events={knowledgeBase.calendarEvents}
                notes={knowledgeBase.notes}
                notesByRoute={notesByRoute}
                onNavigateHistory={navigateToPreviousNote}
                onTogglePin={togglePinnedNote}
                pinnedNoteIds={pinnedNoteIdSet}
                previousNoteJumps={previousNoteJumps}
              />
            </Suspense>
          }
        />
        <Route
          path="/relationship-graph"
          element={
            <Suspense fallback={<RouteLoading label="Loading graph…" />}>
              <LazyRelationshipGraphPage
                events={knowledgeBase.calendarEvents}
                notes={knowledgeBase.notes}
              />
            </Suspense>
          }
        />
        <Route
          path="/calendar"
          element={
            <Suspense fallback={<RouteLoading label="Opening calendar…" />}>
              <LazyCalendarPage
                events={knowledgeBase.calendarEvents}
                tasks={knowledgeBase.tasks}
                projects={knowledgeBase.projects}
                people={knowledgeBase.notes.filter((note) => note.section === "people")}
              />
            </Suspense>
          }
        />
        <Route
          path="/projects"
          element={
            <Suspense fallback={<RouteLoading label="Opening projects…" />}>
              <LazyProjectsPage
                projects={knowledgeBase.projects}
                tasks={knowledgeBase.tasks}
                events={knowledgeBase.calendarEvents}
                notes={knowledgeBase.notes}
              />
            </Suspense>
          }
        />
        <Route
          path="/tasks"
          element={
            <Suspense fallback={<RouteLoading label="Organizing tasks…" />}>
              <LazyTasksPage
                tasks={knowledgeBase.tasks}
                projects={knowledgeBase.projects}
                people={knowledgeBase.notes.filter((note) => note.section === "people")}
                onTasksChange={replaceTasks}
              />
            </Suspense>
          }
        />
        <Route
          path="/shortcuts"
          element={<Navigate replace to="/" />}
        />
        <Route
          path="/sheets"
          element={<Navigate replace to="/browse/sheets" />}
        />
        <Route
          path="/sheet/*"
          element={
            <Suspense fallback={<RouteLoading label="Opening spreadsheet…" />}>
              <LazySheetFilePage />
            </Suspense>
          }
        />
        <Route
          path="/canvas"
          element={
            <Suspense fallback={<RouteLoading label="Opening Canvas…" />}>
              <LazyCanvasPage
                notes={knowledgeBase.notes}
                onOpenNote={(note) => navigate(note.route)}
              />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
        </Routes>
        )}
        </ErrorBoundary>
        {!sidebarCollapsed && (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close sidebar"
            tabIndex={-1}
            onClick={() =>
              updateCastleUserPreferences((current) => ({
                ...current,
                sidebarCollapsed: true,
              }))
            }
          />
        )}
        {notesComplete ? (
          <Suspense fallback={null}>
            <LazyAiChatSidebar
              currentNote={notesByRoute.get(location.pathname)}
              notes={knowledgeBase.notes}
              open={aiChatOpen}
              onOpenNote={(note) => navigate(note.route)}
              onOpenChange={changeAiChatOpen}
            />
          </Suspense>
        ) : null}
        <ViewSettingsMenu
          autoHideSidebar={autoHideSidebar}
          hiddenNavigationTabs={hiddenNavigationTabs}
          sidebarCollapsed={sidebarCollapsed}
          onToggleAutoHideSidebar={toggleAutoHideSidebar}
          onToggleNavigationTab={toggleNavigationTab}
          onToggleSidebar={toggleSidebar}
        />
    </WorkspaceShell>
  );
}

function DesktopContentBridge() {
  const { applyDelta, knowledgeBase } = useKnowledgeBaseStore();
  const latestDeltaGeneratedAt = useRef("");

  useEffect(() => {
    const bridge = window.castleDesktop;
    if (!bridge) return;
    return bridge.onContentDelta((delta) => {
      latestDeltaGeneratedAt.current = delta.generatedAt;
      applyDelta(delta);
      announceGeneratedContentChange(delta.mutableResourcePaths);
    });
  }, [applyDelta]);

  useEffect(() => {
    const bridge = window.castleDesktop;
    const generatedAt = knowledgeBase.generatedAt;
    if (!bridge || !generatedAt) return;
    let active = true;
    let announcedRevision = "";
    const refreshIfNewer = (status: { state: string; generatedAt: string }) => {
      if (
        active &&
        status.state === "ready" &&
        status.generatedAt &&
        status.generatedAt !== latestDeltaGeneratedAt.current &&
        status.generatedAt !== generatedAt &&
        status.generatedAt !== announcedRevision
      ) {
        announcedRevision = status.generatedAt;
        announceGeneratedContentChange();
      }
    };
    const unsubscribe = bridge.onContentServiceStatusChange(refreshIfNewer);
    void bridge
      .getInfo()
      .then((info) => refreshIfNewer(info.contentServiceStatus))
      .catch((reason: unknown) => {
        console.error("Castle could not refresh content service status", reason);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [knowledgeBase.generatedAt]);

  return null;
}

export function resolveCurrentLibraryFolder(
  pathname: string,
  notesByRoute: ReadonlyMap<string, Note>,
  sections: readonly SectionSummary[],
) {
  const routeParts = pathname.split("/").filter(Boolean);
  if (routeParts[0] === "browse" && routeParts[1]) {
    const [sectionId = ""] = decodeFolderPath(routeParts[1]);
    const section = sections.find((candidate) => candidate.id === sectionId);
    if (!section) return null;
    const directory = decodeFolderPath(routeParts.slice(2).join("/"));
    return {
      sectionId,
      directory,
      label: [section.label, ...directory.map(humanizePathSegment)].join(" / "),
    };
  }

  const note = notesByRoute.get(pathname);
  if (!note) return null;
  const section = sections.find((candidate) => candidate.id === note.section);
  if (!section) return null;
  const directory = getNoteDirectory(note);
  return {
    sectionId: section.id,
    directory,
    label: [section.label, ...directory.map(humanizePathSegment)].join(" / "),
  };
}

function createNavigation(
  hiddenNavigationTabs: ReadonlySet<NavigationTabId>,
): NavGroup[] {
  return [
    {
      label: "The Castle",
      items: [
        {
          label: "Home",
          icon: "home",
          href: "/",
        },
        {
          label: "Library",
          icon: "folder-open",
          href: "/library",
        },
        {
          label: "People",
          icon: "graph",
          href: "/relationship-graph",
        },
      ],
    },
    {
      label: "Workspace",
      items: getVisibleNavigationTabs(hiddenNavigationTabs).map(
        ({ href, icon, label }) => ({ href, icon, label }),
      ),
    },
  ];
}

function createBreadcrumb(
  pathname: string,
  knowledgeBase: KnowledgeBase,
  notesByRoute: ReadonlyMap<string, Note>,
) {
  if (pathname === "/") return <span>Home</span>;
  if (pathname === "/canvas") return <span>Canvas</span>;
  if (pathname === "/projects") return <span>Projects</span>;
  if (pathname === "/tasks") return <span>Tasks</span>;
  if (pathname === "/calendar") return <span>Calendar</span>;

  if (pathname === "/relationship-graph") {
    return <span>People</span>;
  }

  if (pathname.startsWith("/sheet/")) {
    const relativePath = decodeSheetRoutePath(pathname.slice("/sheet/".length));
    const parentRoute = createSheetFolderRoute(getSheetDirectory(relativePath));
    const fileName = relativePath.split("/").at(-1) ?? "Spreadsheet";
    return (
      <>
        <LibraryBreadcrumb
          knowledgeBase={knowledgeBase}
          pathname={parentRoute}
        />
        <span className="breadcrumb-sep">/</span>
        <span>{fileName.replace(/\.ods$/i, "").replace(/[-_]+/g, " ")}</span>
      </>
    );
  }

  const note = notesByRoute.get(pathname.replace(/\/$/, ""));
  if (pathname === "/library" || note || pathname.startsWith("/browse/")) {
    return (
      <LibraryBreadcrumb
        knowledgeBase={knowledgeBase}
        note={note}
        pathname={pathname}
      />
    );
  }

  const section = knowledgeBase.sections.find(
    (candidate) => pathname === `/section/${candidate.id}`,
  );
  return section ? (
    <span>{section.label}</span>
  ) : (
    <span>The Castle</span>
  );
}

const sheetsLibrarySection: SectionSummary = {
  id: "sheets",
  label: "Sheets",
  icon: "th",
  count: 0,
};

function addSheetsLibrarySection(sections: readonly SectionSummary[]) {
  return sections.some((section) => section.id === sheetsLibrarySection.id)
    ? [...sections]
    : [...sections, sheetsLibrarySection];
}

function LegacySectionRedirect() {
  const { sectionId } = useParams();
  return sectionId ? (
    <Navigate replace to={createFolderRoute(sectionId)} />
  ) : (
    <Navigate replace to="/library" />
  );
}

function RouteLoading({ label }: { label: string }) {
  return (
    <div className="route-loading" role="status">
      <span />
      <p>{label}</p>
    </div>
  );
}
