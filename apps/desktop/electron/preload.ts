import { contextBridge, ipcRenderer } from "electron";
import {
  parseCastleChatEvent,
  parseCastleChatAuditSnapshot,
  type CastleChatEvent,
  type CastleChatRequest,
} from "../src/platform/ai_chat";
import {
  parseCastleContentServiceStatus,
  parseCastleContentDelta,
  parseCastleSourceChange,
  parseCastleLibrarySelectionResult,
  parseCastleManagedSheetBytes,
  parseCastleManagedSheet,
  parseCastleManagedSheets,
  parseCastleManagedCanvas,
  parseCastleManagedCanvases,
  parseCastleManagedCanvasSource,
  parseCastleImportedCanvasMedia,
  type CastleDesktopBridge,
  type CastleDesktopInfo,
  type CastleContentServiceStatus,
} from "../src/platform/desktop_bridge";
import type {
  CastleContentDelta,
  CastleSourceChange,
  CreateCastleSourceInput,
  CreateCastleFolderInput,
  DeleteCastleSourceInput,
  DeleteCastleFolderInput,
  MoveCastleSourceInput,
  RestoreCastleSourceInput,
  SaveCastleSourceInput,
} from "../src/platform/castle_platform";
import {
  parseCastleNoteContext,
  parseCastleSearchResponse,
  parseCastleStructuredQueryResponse,
  parseCastleKnowledgeOverview,
  parseCastleIndexStatus,
  type CastleEntityQuery,
  type CastleNoteContextRequest,
  type CastleSearchRequest,
} from "../src/platform/knowledge_queries";
import {
  parseCastleContract,
  type CreateTaskInput,
  type DeleteTaskInput,
  type MutateTaskInput,
  type RestoreTaskInput,
  type UpdatePersonInput,
} from "@castle/contracts";
import {
  parseCastleUserPreferences,
  type CastleUserPreferences,
} from "../src/platform/user_preferences";
import { parseVideoPosterResponse } from "../src/lib/videoPoster";
import {
  chooseLibraryChannel,
  desktopInfoChannel,
  loadUserPreferencesChannel,
  saveUserPreferencesChannel,
  createSourceChannel,
  createFolderChannel,
  createTaskChannel,
  moveSourceChannel,
  deleteSourceChannel,
  deleteFolderChannel,
  deleteTaskChannel,
  restoreSourceChannel,
  restoreTaskChannel,
  mutateTaskChannel,
  updatePersonChannel,
  contentServiceStatusChannel,
  contentDeltaChannel,
  sourceChangeChannel,
  fullScreenStateChannel,
  getFullScreenStateChannel,
  readSourceChannel,
  saveSourceChannel,
  retryContentServiceChannel,
  restartAppChannel,
  indexStatusChannel,
  searchKnowledgeChannel,
  readNoteContextChannel,
  relatedNotesChannel,
  queryTasksChannel,
  queryEventsChannel,
  listProjectsChannel,
  queryPeopleChannel,
  queryRelationshipsChannel,
  knowledgeOverviewChannel,
  openLibraryChannel,
  startAiChatChannel,
  cancelAiChatChannel,
  aiChatEventChannel,
  getAiChatAuditChannel,
  clearAiChatAuditChannel,
  listManagedSheetsChannel,
  readManagedSheetChannel,
  saveManagedSheetChannel,
  listManagedCanvasesChannel,
  readManagedCanvasChannel,
  createManagedCanvasChannel,
  saveManagedCanvasChannel,
  importCanvasMediaChannel,
  openCanvasMediaChannel,
  resolveVideoPosterChannel,
} from "./ipc_contract";

const castleDesktopBridge: CastleDesktopBridge = Object.freeze({
  runtime: "desktop",
  operatingSystem: process.platform,
  supportsCanvasWebPreviews: true,
  getFullScreenState: () =>
    ipcRenderer.invoke(getFullScreenStateChannel) as Promise<boolean>,
  onFullScreenStateChange: (listener: (isFullScreen: boolean) => void) => {
    const handleFullScreenStateChange = (
      _event: Electron.IpcRendererEvent,
      isFullScreen: boolean,
    ) => listener(isFullScreen);
    ipcRenderer.on(fullScreenStateChannel, handleFullScreenStateChange);
    return () =>
      ipcRenderer.removeListener(
        fullScreenStateChannel,
        handleFullScreenStateChange,
      );
  },
  onContentServiceStatusChange: (
    listener: (status: CastleContentServiceStatus) => void,
  ) => {
    const handleContentServiceStatusChange = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ) => listener(parseCastleContentServiceStatus(value));
    ipcRenderer.on(contentServiceStatusChannel, handleContentServiceStatusChange);
    return () =>
      ipcRenderer.removeListener(
        contentServiceStatusChannel,
        handleContentServiceStatusChange,
      );
  },
  onSourceChange: (listener: (change: CastleSourceChange) => void) => {
    const handleSourceChange = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ) => listener(parseCastleSourceChange(value));
    ipcRenderer.on(sourceChangeChannel, handleSourceChange);
    return () => ipcRenderer.removeListener(sourceChangeChannel, handleSourceChange);
  },
  onContentDelta: (listener: (delta: CastleContentDelta) => void) => {
    const handleContentDelta = (
      _event: Electron.IpcRendererEvent,
      value: unknown,
    ) => listener(parseCastleContentDelta(value));
    ipcRenderer.on(contentDeltaChannel, handleContentDelta);
    return () => ipcRenderer.removeListener(contentDeltaChannel, handleContentDelta);
  },
  getInfo: () =>
    ipcRenderer.invoke(desktopInfoChannel) as Promise<CastleDesktopInfo>,
  loadUserPreferences: () =>
    ipcRenderer.invoke(loadUserPreferencesChannel).then((value) => {
      if (value === null) return null;
      const preferences = parseCastleUserPreferences(value);
      if (!preferences) throw new Error("Castle received invalid interface preferences.");
      return preferences;
    }),
  saveUserPreferences: (preferences: CastleUserPreferences) =>
    ipcRenderer.invoke(saveUserPreferencesChannel, preferences).then((value) => {
      const saved = parseCastleUserPreferences(value);
      if (!saved) throw new Error("Castle received invalid interface preferences.");
      return saved;
    }),
  chooseLibrary: () =>
    ipcRenderer
      .invoke(chooseLibraryChannel)
      .then(parseCastleLibrarySelectionResult),
  openLibrary: (libraryPath: string) =>
    ipcRenderer
      .invoke(openLibraryChannel, { path: libraryPath })
      .then(parseCastleLibrarySelectionResult),
  listManagedSheets: () =>
    ipcRenderer.invoke(listManagedSheetsChannel).then(parseCastleManagedSheets),
  readManagedSheet: (relativePath: string) =>
    ipcRenderer
      .invoke(readManagedSheetChannel, { relativePath })
      .then(parseCastleManagedSheetBytes),
  saveManagedSheet: (relativePath: string, archive: ArrayBuffer) =>
    ipcRenderer
      .invoke(saveManagedSheetChannel, { relativePath, archive })
      .then(parseCastleManagedSheet),
  listManagedCanvases: () =>
    ipcRenderer.invoke(listManagedCanvasesChannel).then(parseCastleManagedCanvases),
  readManagedCanvas: (relativePath: string) =>
    ipcRenderer
      .invoke(readManagedCanvasChannel, { relativePath })
      .then(parseCastleManagedCanvasSource),
  createManagedCanvas: (relativePath: string, source: string) =>
    ipcRenderer
      .invoke(createManagedCanvasChannel, { relativePath, source })
      .then(parseCastleManagedCanvas),
  saveManagedCanvas: (relativePath: string, source: string) =>
    ipcRenderer
      .invoke(saveManagedCanvasChannel, { relativePath, source })
      .then(parseCastleManagedCanvas),
  importCanvasMedia: (input: { name: string; mimeType: string; data: ArrayBuffer }) =>
    ipcRenderer
      .invoke(importCanvasMediaChannel, input)
      .then(parseCastleImportedCanvasMedia),
  openCanvasMedia: (relativePath: string) =>
    ipcRenderer.invoke(openCanvasMediaChannel, { relativePath }) as Promise<void>,
  resolveVideoPoster: (sourceUrl: string) =>
    ipcRenderer
      .invoke(resolveVideoPosterChannel, { url: sourceUrl })
      .then(parseVideoPosterResponse),
  readSource: (noteId: string) =>
    ipcRenderer.invoke(readSourceChannel, noteId).then((value) =>
      parseCastleContract("SourceDocument", value)
    ),
  saveSource: (input: SaveCastleSourceInput) =>
    ipcRenderer.invoke(saveSourceChannel, input).then((value) =>
      parseCastleContract("SaveSourceResult", value)
    ),
  createSource: (input: CreateCastleSourceInput) =>
    ipcRenderer.invoke(createSourceChannel, input).then((value) =>
      parseCastleContract("SaveSourceResult", value)
    ),
  createFolder: (input: CreateCastleFolderInput) =>
    ipcRenderer.invoke(createFolderChannel, input).then((value) =>
      parseCastleContract("CreateFolderResult", value)
    ),
  moveSource: (input: MoveCastleSourceInput) =>
    ipcRenderer.invoke(moveSourceChannel, input).then((value) =>
      parseCastleContract("MoveSourceResult", value)
    ),
  deleteSource: (input: DeleteCastleSourceInput) =>
    ipcRenderer.invoke(deleteSourceChannel, input).then((value) =>
      parseCastleContract("DeleteSourceResult", value)
    ),
  deleteFolder: (input: DeleteCastleFolderInput) =>
    ipcRenderer.invoke(deleteFolderChannel, input).then((value) =>
      parseCastleContract("DeleteFolderResult", value)
    ),
  restoreSource: (input: RestoreCastleSourceInput) =>
    ipcRenderer.invoke(restoreSourceChannel, input).then((value) =>
      parseCastleContract("SaveSourceResult", value)
    ),
  mutateTask: (input: MutateTaskInput) =>
    ipcRenderer.invoke(mutateTaskChannel, input).then((value) =>
      parseCastleContract("TaskMutationResult", value)
    ),
  createTask: (input: CreateTaskInput) =>
    ipcRenderer.invoke(createTaskChannel, input).then((value) =>
      parseCastleContract("TaskMutationResult", value)
    ),
  deleteTask: (input: DeleteTaskInput) =>
    ipcRenderer.invoke(deleteTaskChannel, input).then((value) =>
      parseCastleContract("DeleteTaskResult", value)
    ),
  restoreTask: (input: RestoreTaskInput) =>
    ipcRenderer.invoke(restoreTaskChannel, input).then((value) =>
      parseCastleContract("TaskMutationResult", value)
    ),
  updatePerson: (input: UpdatePersonInput) =>
    ipcRenderer.invoke(updatePersonChannel, input).then((value) =>
      parseCastleContract("PersonMutationResult", value)
    ),
  getIndexStatus: () =>
    ipcRenderer.invoke(indexStatusChannel).then(parseCastleIndexStatus),
  searchKnowledge: (request: CastleSearchRequest) =>
    ipcRenderer.invoke(searchKnowledgeChannel, request).then(parseCastleSearchResponse),
  readNoteContext: (request: CastleNoteContextRequest) =>
    ipcRenderer.invoke(readNoteContextChannel, request).then(parseCastleNoteContext),
  relatedNotes: (noteId: string, limit?: number) =>
    ipcRenderer
      .invoke(relatedNotesChannel, { noteId, limit })
      .then(parseCastleSearchResponse),
  queryTasks: (request: CastleEntityQuery) =>
    ipcRenderer.invoke(queryTasksChannel, request).then(parseCastleStructuredQueryResponse),
  queryEvents: (request: CastleEntityQuery) =>
    ipcRenderer.invoke(queryEventsChannel, request).then(parseCastleStructuredQueryResponse),
  listProjects: (request: CastleEntityQuery) =>
    ipcRenderer.invoke(listProjectsChannel, request).then(parseCastleStructuredQueryResponse),
  queryPeople: (request: CastleEntityQuery) =>
    ipcRenderer.invoke(queryPeopleChannel, request).then(parseCastleStructuredQueryResponse),
  queryRelationships: (request: CastleEntityQuery) =>
    ipcRenderer.invoke(queryRelationshipsChannel, request).then(parseCastleStructuredQueryResponse),
  getKnowledgeOverview: () =>
    ipcRenderer.invoke(knowledgeOverviewChannel).then(parseCastleKnowledgeOverview),
  aiChat: Object.freeze({
    start: (request: CastleChatRequest) =>
      ipcRenderer.invoke(startAiChatChannel, request) as Promise<{ requestId: string }>,
    cancel: (requestId: string) =>
      ipcRenderer.invoke(cancelAiChatChannel, { requestId }) as Promise<void>,
    onEvent: (listener: (event: CastleChatEvent) => void) => {
      const handleChatEvent = (
        _event: Electron.IpcRendererEvent,
        value: unknown,
      ) => listener(parseCastleChatEvent(value));
      ipcRenderer.on(aiChatEventChannel, handleChatEvent);
      return () => ipcRenderer.removeListener(aiChatEventChannel, handleChatEvent);
    },
    audit: () =>
      ipcRenderer.invoke(getAiChatAuditChannel).then(parseCastleChatAuditSnapshot),
    clearAudit: () =>
      ipcRenderer.invoke(clearAiChatAuditChannel).then(parseCastleChatAuditSnapshot),
  }),
  retryContentService: () =>
    ipcRenderer.invoke(retryContentServiceChannel).then((value) =>
      parseCastleContentServiceStatus(value),
    ),
  restartApp: () => ipcRenderer.invoke(restartAppChannel) as Promise<void>,
});

contextBridge.exposeInMainWorld("castleDesktop", castleDesktopBridge);
