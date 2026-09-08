import type { CastleKnowledgeQueries } from "./knowledge_queries";
import type { CastleAiChat } from "./ai_chat";
import type { CastleUserPreferences } from "./user_preferences";
import type {
  CalendarEvent,
  LibraryFolder,
  Note,
  Project,
  SectionSummary,
  ShortcutCollection,
  Task,
} from "../types";
import type {
  CreateSourceInput,
  CreateFolderInput,
  CreateFolderResult,
  CreateTaskInput,
  DeleteSourceInput,
  DeleteFolderInput,
  DeleteFolderResult,
  DeleteSourceResult,
  DeleteTaskInput,
  DeleteTaskResult,
  MoveSourceInput,
  MoveSourceResult,
  MutateTaskInput,
  PersonMutationResult,
  RestoreSourceInput,
  RestoreTaskInput,
  SaveSourceInput,
  SaveSourceResult,
  SourceDocument,
  TaskMutationResult,
  UpdatePersonInput,
} from "@castle/contracts";

export type CastleRuntime = "web" | "desktop";

export interface CastleCapabilities {
  editContent: boolean;
  createContent: boolean;
  moveContent: boolean;
  deleteContent: boolean;
}

export interface CastleContentServiceStatus {
  state: "starting" | "ready" | "stale" | "unavailable";
  message: string;
  generatedAt: string;
}

export interface CastleDesktopLibrary {
  name: string;
  path: string;
  available: boolean;
  active: boolean;
}

export type CastleLibrarySelectionResult =
  | { status: "selected"; library: CastleDesktopLibrary }
  | { status: "cancelled" }
  | { status: "invalid"; message: string };

export interface CastleDesktopInfo {
  runtime: "desktop";
  operatingSystem: string;
  library: CastleDesktopLibrary | null;
  libraries: CastleDesktopLibrary[];
  capabilities: Readonly<CastleCapabilities>;
  contentServiceStatus: CastleContentServiceStatus;
}

export interface CastleManagedSheet {
  relativePath: string;
  name: string;
  size: number;
  modifiedAt: string;
}

export interface CastleManagedCanvas {
  relativePath: string;
  name: string;
  size: number;
  modifiedAt: string;
}

export interface CastleImportedCanvasMedia {
  file: string;
  kind: "image" | "pdf";
}

export type CastleSourceDocument = SourceDocument;
export type SaveCastleSourceInput = SaveSourceInput;
export type SaveCastleSourceResult = SaveSourceResult;
export type CreateCastleSourceInput = CreateSourceInput;
export type CreateCastleSourceResult = SaveSourceResult;
export type CreateCastleFolderInput = CreateFolderInput;
export type CreateCastleFolderResult = CreateFolderResult;
export type MoveCastleSourceInput = MoveSourceInput;
export type MoveCastleSourceResult = MoveSourceResult;
export type DeleteCastleSourceInput = DeleteSourceInput;
export type DeleteCastleSourceResult = DeleteSourceResult;
export type DeleteCastleFolderInput = DeleteFolderInput;
export type DeleteCastleFolderResult = DeleteFolderResult;

export interface CastleSourceChange {
  sourceGeneration: number;
  operation:
    | "saveSource"
    | "createSource"
    | "moveSource"
    | "deleteSource"
    | "restoreSource"
    | "mutateTask"
    | "createTask"
    | "deleteTask"
    | "restoreTask"
    | "updatePerson";
  noteId: string;
  sourceFile: string;
  revision: string;
  trashId: string;
}

export interface CastleEntityDelta<T = unknown> {
  upserted: T[];
  removedIds: string[];
  orderedIds?: string[];
}

export interface CastleContentDelta {
  contractVersion: number;
  generatedAt: string;
  sections: SectionSummary[];
  folders: LibraryFolder[];
  notes: CastleEntityDelta<Note>;
  tasks: CastleEntityDelta<Task>;
  projects: CastleEntityDelta<Project>;
  calendarEvents: CastleEntityDelta<CalendarEvent>;
  shortcutCollections: ShortcutCollection[];
  mutableResourcePaths: string[];
}

export type RestoreCastleSourceInput = RestoreSourceInput;

export interface CastleContentMutations {
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
}

export interface CastleMediaPreviews {
  resolveVideoPoster(sourceUrl: string): Promise<string | null>;
}

/** Desktop-only services exposed to renderer features without leaking the preload bridge. */
export interface CastleDesktopServices {
  supportsCanvasWebPreviews: boolean;
  getInfo(): Promise<CastleDesktopInfo>;
  onContentServiceStatusChange(
    listener: (status: CastleContentServiceStatus) => void,
  ): () => void;
  onContentDelta(listener: (delta: CastleContentDelta) => void): () => void;
  loadUserPreferences(): Promise<CastleUserPreferences | null>;
  saveUserPreferences(
    preferences: CastleUserPreferences,
  ): Promise<CastleUserPreferences>;
  chooseLibrary(): Promise<CastleLibrarySelectionResult>;
  openLibrary(libraryPath: string): Promise<CastleLibrarySelectionResult>;
  restartApp(): Promise<void>;
  listManagedSheets(): Promise<CastleManagedSheet[]>;
  readManagedSheet(relativePath: string): Promise<ArrayBuffer>;
  saveManagedSheet(
    relativePath: string,
    archive: ArrayBuffer,
  ): Promise<CastleManagedSheet>;
  listManagedCanvases(): Promise<CastleManagedCanvas[]>;
  readManagedCanvas(relativePath: string): Promise<string>;
  createManagedCanvas(
    relativePath: string,
    source: string,
  ): Promise<CastleManagedCanvas>;
  saveManagedCanvas(
    relativePath: string,
    source: string,
  ): Promise<CastleManagedCanvas>;
  importCanvasMedia(input: {
    name: string;
    mimeType: string;
    data: ArrayBuffer;
  }): Promise<CastleImportedCanvasMedia>;
  openCanvasMedia(relativePath: string): Promise<void>;
}

export interface CastlePlatform {
  runtime: CastleRuntime;
  capabilities: Readonly<CastleCapabilities>;
  contentMutations: CastleContentMutations | null;
  mediaPreviews: CastleMediaPreviews;
  knowledgeQueries: CastleKnowledgeQueries | null;
  aiChat: CastleAiChat | null;
  desktopServices: CastleDesktopServices | null;
}
