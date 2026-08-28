import type { CastleKnowledgeQueries } from "./knowledge_queries";
import type { CastleAiChat } from "./ai_chat";
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
} from "../generated/castle_contracts";

export type CastleRuntime = "web" | "desktop";

export interface CastleCapabilities {
  editContent: boolean;
  createContent: boolean;
  moveContent: boolean;
  deleteContent: boolean;
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

export interface CastlePlatform {
  runtime: CastleRuntime;
  capabilities: Readonly<CastleCapabilities>;
  contentMutations: CastleContentMutations | null;
  mediaPreviews: CastleMediaPreviews;
  knowledgeQueries: CastleKnowledgeQueries | null;
  aiChat: CastleAiChat | null;
}
