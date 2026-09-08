import type {
  CastleContentDelta,
  CastleContentServiceStatus,
  CastleDesktopInfo,
  CastleDesktopLibrary,
  CastleDesktopServices,
  CastleImportedCanvasMedia,
  CastleLibrarySelectionResult,
  CastleManagedCanvas,
  CastleManagedSheet,
  CastleSourceChange,
  CastleSourceDocument,
  CreateCastleSourceInput,
  CreateCastleFolderInput,
  CreateCastleFolderResult,
  CreateCastleSourceResult,
  DeleteCastleSourceInput,
  DeleteCastleFolderInput,
  DeleteCastleFolderResult,
  DeleteCastleSourceResult,
  MoveCastleSourceInput,
  MoveCastleSourceResult,
  RestoreCastleSourceInput,
  SaveCastleSourceInput,
  SaveCastleSourceResult,
} from "./castle_platform";
import type {
  CastleEntityQuery,
  CastleIndexStatus,
  CastleKnowledgeOverview,
  CastleNoteContext,
  CastleNoteContextRequest,
  CastleSearchRequest,
  CastleSearchResponse,
  CastleStructuredQueryResponse,
} from "./knowledge_queries";
import type { CastleAiChat } from "./ai_chat";
import {
  parseCastleContract,
  type CreateTaskInput,
  type DeleteTaskInput,
  type DeleteTaskResult,
  type MutateTaskInput,
  type PersonMutationResult,
  type RestoreTaskInput,
  type TaskMutationResult,
  type UpdatePersonInput,
} from "@castle/contracts";

export interface CastleDesktopBridge extends CastleDesktopServices {
  runtime: "desktop";
  operatingSystem: string;
  supportsCanvasWebPreviews: true;
  getFullScreenState(): Promise<boolean>;
  onFullScreenStateChange(listener: (isFullScreen: boolean) => void): () => void;
  onSourceChange(listener: (change: CastleSourceChange) => void): () => void;
  resolveVideoPoster(sourceUrl: string): Promise<string | null>;
  readSource(noteId: string): Promise<CastleSourceDocument>;
  saveSource(input: SaveCastleSourceInput): Promise<SaveCastleSourceResult>;
  createSource(input: CreateCastleSourceInput): Promise<CreateCastleSourceResult>;
  createFolder(input: CreateCastleFolderInput): Promise<CreateCastleFolderResult>;
  moveSource(input: MoveCastleSourceInput): Promise<MoveCastleSourceResult>;
  deleteSource(input: DeleteCastleSourceInput): Promise<DeleteCastleSourceResult>;
  deleteFolder(input: DeleteCastleFolderInput): Promise<DeleteCastleFolderResult>;
  restoreSource(input: RestoreCastleSourceInput): Promise<SaveCastleSourceResult>;
  mutateTask(input: MutateTaskInput): Promise<TaskMutationResult>;
  createTask(input: CreateTaskInput): Promise<TaskMutationResult>;
  deleteTask(input: DeleteTaskInput): Promise<DeleteTaskResult>;
  restoreTask(input: RestoreTaskInput): Promise<TaskMutationResult>;
  updatePerson(input: UpdatePersonInput): Promise<PersonMutationResult>;
  getIndexStatus(): Promise<CastleIndexStatus>;
  searchKnowledge(request: CastleSearchRequest): Promise<CastleSearchResponse>;
  readNoteContext(request: CastleNoteContextRequest): Promise<CastleNoteContext>;
  relatedNotes(noteId: string, limit?: number): Promise<CastleSearchResponse>;
  queryTasks(request: CastleEntityQuery): Promise<CastleStructuredQueryResponse>;
  queryEvents(request: CastleEntityQuery): Promise<CastleStructuredQueryResponse>;
  listProjects(request: CastleEntityQuery): Promise<CastleStructuredQueryResponse>;
  queryPeople(request: CastleEntityQuery): Promise<CastleStructuredQueryResponse>;
  queryRelationships(request: CastleEntityQuery): Promise<CastleStructuredQueryResponse>;
  getKnowledgeOverview(): Promise<CastleKnowledgeOverview>;
  aiChat: CastleAiChat;
  retryContentService(): Promise<CastleContentServiceStatus>;
}

export type {
  CastleContentServiceStatus,
  CastleDesktopInfo,
  CastleDesktopLibrary,
  CastleImportedCanvasMedia,
  CastleLibrarySelectionResult,
  CastleManagedCanvas,
  CastleManagedSheet,
};

export function parseCastleManagedSheets(value: unknown): CastleManagedSheet[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new Error("Castle received an invalid sheet library.");
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Castle received an invalid sheet library.");
    }
    const sheet = candidate as Record<string, unknown>;
    if (
      typeof sheet.relativePath !== "string" ||
      typeof sheet.name !== "string" ||
      typeof sheet.size !== "number" ||
      !Number.isSafeInteger(sheet.size) ||
      sheet.size < 0 ||
      typeof sheet.modifiedAt !== "string"
    ) {
      throw new Error("Castle received an invalid sheet library.");
    }
    return {
      relativePath: sheet.relativePath,
      name: sheet.name,
      size: sheet.size,
      modifiedAt: sheet.modifiedAt,
    };
  });
}

export function parseCastleManagedSheet(value: unknown): CastleManagedSheet {
  return parseCastleManagedSheets([value])[0];
}

export function parseCastleManagedSheetBytes(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    ).buffer;
  }
  throw new Error("Castle received invalid spreadsheet bytes.");
}

export function parseCastleManagedCanvases(value: unknown): CastleManagedCanvas[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new Error("Castle received an invalid canvas library.");
  }
  return value.map((candidate) => parseCastleManagedCanvas(candidate));
}

export function parseCastleManagedCanvas(value: unknown): CastleManagedCanvas {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle received an invalid canvas entry.");
  }
  const canvas = value as Record<string, unknown>;
  if (
    typeof canvas.relativePath !== "string" ||
    typeof canvas.name !== "string" ||
    typeof canvas.size !== "number" ||
    !Number.isSafeInteger(canvas.size) ||
    canvas.size < 0 ||
    typeof canvas.modifiedAt !== "string"
  ) {
    throw new Error("Castle received an invalid canvas entry.");
  }
  return {
    relativePath: canvas.relativePath,
    name: canvas.name,
    size: canvas.size,
    modifiedAt: canvas.modifiedAt,
  };
}

export function parseCastleImportedCanvasMedia(value: unknown): CastleImportedCanvasMedia {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle received an invalid imported canvas media file.");
  }
  const media = value as Record<string, unknown>;
  if (
    typeof media.file !== "string" ||
    media.file.length === 0 ||
    !["image", "pdf"].includes(String(media.kind))
  ) {
    throw new Error("Castle received an invalid imported canvas media file.");
  }
  return {
    file: media.file,
    kind: media.kind as CastleImportedCanvasMedia["kind"],
  };
}

export function parseCastleManagedCanvasSource(value: unknown) {
  if (typeof value !== "string" || value.length > 8 * 1024 * 1024) {
    throw new Error("Castle received invalid JSON Canvas source.");
  }
  return value;
}

export function parseCastleContentServiceStatus(
  value: unknown,
): CastleContentServiceStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle received an invalid content-service status.");
  }
  const status = value as Record<string, unknown>;
  if (
    !["starting", "ready", "stale", "unavailable"].includes(String(status.state)) ||
    typeof status.message !== "string" ||
    typeof status.generatedAt !== "string"
  ) {
    throw new Error("Castle received an invalid content-service status.");
  }
  return {
    state: status.state as CastleContentServiceStatus["state"],
    message: status.message,
    generatedAt: status.generatedAt,
  };
}

export function parseCastleSourceChange(value: unknown): CastleSourceChange {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle received an invalid source-change event.");
  }
  const change = value as Record<string, unknown>;
  if (
    typeof change.sourceGeneration !== "number" ||
    !Number.isSafeInteger(change.sourceGeneration) ||
    change.sourceGeneration < 1 ||
    ![
      "saveSource",
      "createSource",
      "moveSource",
      "deleteSource",
      "restoreSource",
      "mutateTask",
      "createTask",
      "deleteTask",
      "restoreTask",
      "updatePerson",
    ].includes(
      String(change.operation),
    ) ||
    typeof change.noteId !== "string" ||
    typeof change.sourceFile !== "string" ||
    typeof change.revision !== "string" ||
    typeof change.trashId !== "string"
  ) {
    throw new Error("Castle received an invalid source-change event.");
  }
  return {
    sourceGeneration: change.sourceGeneration,
    operation: change.operation as CastleSourceChange["operation"],
    noteId: change.noteId,
    sourceFile: change.sourceFile,
    revision: change.revision,
    trashId: change.trashId,
  };
}

export function parseCastleContentDelta(value: unknown): CastleContentDelta {
  try {
    parseCastleContract("CompilationDelta", value);
  } catch {
    throw new Error("Castle received an invalid content-delta event.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle received an invalid content-delta event.");
  }
  const delta = value as Record<string, unknown>;
  const notes = parseEntityDelta(delta.notes);
  const tasks = parseEntityDelta(delta.tasks);
  const projects = parseEntityDelta(delta.projects);
  const calendarEvents = parseEntityDelta(delta.calendarEvents);
  if (
    typeof delta.contractVersion !== "number" ||
    !Number.isSafeInteger(delta.contractVersion) ||
    typeof delta.generatedAt !== "string" ||
    !Array.isArray(delta.sections) ||
    !Array.isArray(delta.folders) ||
    !Array.isArray(delta.shortcutCollections) ||
    !Array.isArray(delta.mutableResourcePaths) ||
    !delta.mutableResourcePaths.every((path) => typeof path === "string")
  ) {
    throw new Error("Castle received an invalid content-delta event.");
  }
  return {
    contractVersion: delta.contractVersion,
    generatedAt: delta.generatedAt,
    sections: delta.sections,
    folders: delta.folders as CastleContentDelta["folders"],
    notes,
    tasks,
    projects,
    calendarEvents,
    shortcutCollections:
      delta.shortcutCollections as CastleContentDelta["shortcutCollections"],
    mutableResourcePaths: delta.mutableResourcePaths as string[],
  } as CastleContentDelta;
}

function parseEntityDelta(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle received an invalid content-delta event.");
  }
  const delta = value as Record<string, unknown>;
  if (
    !Array.isArray(delta.upserted) ||
    !Array.isArray(delta.removedIds) ||
    !delta.removedIds.every((id) => typeof id === "string") ||
    (delta.orderedIds !== undefined &&
      (!Array.isArray(delta.orderedIds) ||
        !delta.orderedIds.every((id) => typeof id === "string")))
  ) {
    throw new Error("Castle received an invalid content-delta event.");
  }
  return {
    upserted: delta.upserted,
    removedIds: delta.removedIds as string[],
    ...(delta.orderedIds === undefined
      ? {}
      : { orderedIds: delta.orderedIds as string[] }),
  };
}

export function parseCastleLibrarySelectionResult(
  value: unknown,
): CastleLibrarySelectionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle received an invalid library-selection result.");
  }
  const result = value as Record<string, unknown>;
  if (result.status === "cancelled") return { status: "cancelled" };
  if (result.status === "invalid" && typeof result.message === "string") {
    return { status: "invalid", message: result.message };
  }
  if (result.status !== "selected") {
    throw new Error("Castle received an invalid library-selection result.");
  }
  const library = parseCastleDesktopLibrary(result.library);
  return { status: "selected", library };
}

function parseCastleDesktopLibrary(value: unknown): CastleDesktopLibrary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle received an invalid library-selection result.");
  }
  const library = value as Record<string, unknown>;
  if (
    typeof library.name !== "string" ||
    typeof library.path !== "string" ||
    typeof library.available !== "boolean" ||
    typeof library.active !== "boolean"
  ) {
    throw new Error("Castle received an invalid library-selection result.");
  }
  return {
    name: library.name,
    path: library.path,
    available: library.available,
    active: library.active,
  };
}

declare global {
  interface Window {
    castleDesktop?: CastleDesktopBridge;
  }
}
