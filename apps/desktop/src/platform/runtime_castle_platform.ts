import type { CastleDesktopBridge } from "./desktop_bridge";
import type {
  CastleCapabilities,
  CastleContentMutations,
  CastleDesktopServices,
  CreateCastleFolderInput,
  CastlePlatform,
  CreateCastleSourceInput,
  DeleteCastleSourceInput,
  DeleteCastleFolderInput,
  MoveCastleSourceInput,
  RestoreCastleSourceInput,
  SaveCastleSourceInput,
} from "./castle_platform";
import { webCastlePlatform } from "./web_castle_platform";
import type {
  CastleEntityQuery,
  CastleNoteContextRequest,
  CastleSearchRequest,
} from "./knowledge_queries";
import type {
  CreateTaskInput,
  DeleteTaskInput,
  MutateTaskInput,
  RestoreTaskInput,
  UpdatePersonInput,
} from "@castle/contracts";

const unavailableDesktopCapabilities = Object.freeze({
  editContent: false,
  createContent: false,
  moveContent: false,
  deleteContent: false,
});

export function createDesktopCastlePlatform(
  bridge: CastleDesktopBridge,
  capabilities: Readonly<CastleCapabilities> = unavailableDesktopCapabilities,
): CastlePlatform {
  const desktopCapabilities = Object.freeze({
    editContent: capabilities.editContent === true,
    createContent: capabilities.createContent === true,
    moveContent: capabilities.moveContent === true,
    deleteContent: capabilities.deleteContent === true,
  });
  const contentMutations: CastleContentMutations | null = desktopCapabilities.editContent
    ? Object.freeze({
        readSource: (noteId: string) => bridge.readSource(noteId),
        saveSource: (input: SaveCastleSourceInput) => bridge.saveSource(input),
        createSource: (input: CreateCastleSourceInput) => bridge.createSource(input),
        createFolder: (input: CreateCastleFolderInput) => bridge.createFolder(input),
        moveSource: (input: MoveCastleSourceInput) => bridge.moveSource(input),
        deleteSource: (input: DeleteCastleSourceInput) => bridge.deleteSource(input),
        deleteFolder: (input: DeleteCastleFolderInput) => bridge.deleteFolder(input),
        restoreSource: (input: RestoreCastleSourceInput) => bridge.restoreSource(input),
        mutateTask: (input: MutateTaskInput) => bridge.mutateTask(input),
        createTask: (input: CreateTaskInput) => bridge.createTask(input),
        deleteTask: (input: DeleteTaskInput) => bridge.deleteTask(input),
        restoreTask: (input: RestoreTaskInput) => bridge.restoreTask(input),
        updatePerson: (input: UpdatePersonInput) => bridge.updatePerson(input),
      })
    : null;
  const desktopServices = Object.freeze({
    supportsCanvasWebPreviews: bridge.supportsCanvasWebPreviews === true,
    getInfo: () => bridge.getInfo(),
    onContentServiceStatusChange: (listener) =>
      bridge.onContentServiceStatusChange(listener),
    onContentDelta: (listener) => bridge.onContentDelta(listener),
    loadUserPreferences: () => bridge.loadUserPreferences(),
    saveUserPreferences: (preferences) => bridge.saveUserPreferences(preferences),
    chooseLibrary: () => bridge.chooseLibrary(),
    openLibrary: (libraryPath) => bridge.openLibrary(libraryPath),
    restartApp: () => bridge.restartApp(),
    listManagedSheets: () => bridge.listManagedSheets(),
    readManagedSheet: (relativePath) => bridge.readManagedSheet(relativePath),
    saveManagedSheet: (relativePath, archive) =>
      bridge.saveManagedSheet(relativePath, archive),
    listManagedCanvases: () => bridge.listManagedCanvases(),
    readManagedCanvas: (relativePath) => bridge.readManagedCanvas(relativePath),
    createManagedCanvas: (relativePath, source) =>
      bridge.createManagedCanvas(relativePath, source),
    saveManagedCanvas: (relativePath, source) =>
      bridge.saveManagedCanvas(relativePath, source),
    importCanvasMedia: (input) => bridge.importCanvasMedia(input),
    openCanvasMedia: (relativePath) => bridge.openCanvasMedia(relativePath),
  } satisfies CastleDesktopServices);

  return Object.freeze({
    runtime: "desktop",
    capabilities: desktopCapabilities,
    contentMutations,
    mediaPreviews: Object.freeze({
      resolveVideoPoster: (sourceUrl: string) =>
        bridge.resolveVideoPoster(sourceUrl),
    }),
    knowledgeQueries: Object.freeze({
      status: () => bridge.getIndexStatus(),
      search: (request: CastleSearchRequest) => bridge.searchKnowledge(request),
      readNote: (request: CastleNoteContextRequest) =>
        bridge.readNoteContext(request),
      relatedNotes: (noteId: string, limit?: number) =>
        bridge.relatedNotes(noteId, limit),
      queryTasks: (request: CastleEntityQuery = {}) => bridge.queryTasks(request),
      queryEvents: (request: CastleEntityQuery = {}) => bridge.queryEvents(request),
      listProjects: (request: CastleEntityQuery = {}) => bridge.listProjects(request),
      queryPeople: (request: CastleEntityQuery = {}) => bridge.queryPeople(request),
      queryRelationships: (request: CastleEntityQuery = {}) =>
        bridge.queryRelationships(request),
      overview: () => bridge.getKnowledgeOverview(),
    }),
    aiChat: bridge.aiChat,
    desktopServices,
  });
}

export async function loadDesktopCastlePlatform(bridge: CastleDesktopBridge) {
  const info = await bridge.getInfo();
  return createDesktopCastlePlatform(bridge, info.capabilities);
}

export function resolveCastlePlatform(bridge?: CastleDesktopBridge) {
  return bridge?.runtime === "desktop"
    ? createDesktopCastlePlatform(bridge)
    : webCastlePlatform;
}
