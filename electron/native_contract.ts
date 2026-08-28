import {
  parseCastleContract,
  type CreateFolderInput,
  type CreateFolderResult,
  type CreateSourceInput,
  type CreateTaskInput,
  type DeleteSourceInput,
  type DeleteFolderInput,
  type DeleteFolderResult,
  type DeleteSourceResult,
  type DeleteTaskInput,
  type DeleteTaskResult,
  type MoveSourceInput,
  type MoveSourceResult,
  type MutateTaskInput,
  type PersonMutationResult,
  type RestoreSourceInput,
  type RestoreTaskInput,
  type SaveSourceInput,
  type SaveSourceResult,
  type ServiceState,
  type SourceDocument,
  type TaskMutationResult,
  type UpdatePersonInput,
} from "../src/generated/castle_contracts";
import {
  parseCastleIndexStatus,
  parseCastleKnowledgeOverview,
  parseCastleNoteContext,
  parseCastleRecordDocument,
  parseCastleSearchResponse,
  parseCastleStructuredQueryResponse,
  type CastleEntityQuery,
  type CastleIndexStatus,
  type CastleKnowledgeOverview,
  type CastleNoteContext,
  type CastleNoteContextRequest,
  type CastleSearchRequest,
  type CastleSearchResponse,
  type CastleStructuredQueryResponse,
} from "../src/platform/knowledge_queries";

type EmptyParams = Record<string, never>;

export interface CastleNativeMethodMap {
  getState: { params: EmptyParams; result: ServiceState };
  readSource: { params: { noteId: string }; result: SourceDocument };
  saveSource: { params: SaveSourceInput; result: SaveSourceResult };
  createSource: { params: CreateSourceInput; result: SaveSourceResult };
  createFolder: { params: CreateFolderInput; result: CreateFolderResult };
  moveSource: { params: MoveSourceInput; result: MoveSourceResult };
  deleteSource: { params: DeleteSourceInput; result: DeleteSourceResult };
  deleteFolder: { params: DeleteFolderInput; result: DeleteFolderResult };
  restoreSource: { params: RestoreSourceInput; result: SaveSourceResult };
  mutateTask: { params: MutateTaskInput; result: TaskMutationResult };
  createTask: { params: CreateTaskInput; result: TaskMutationResult };
  deleteTask: { params: DeleteTaskInput; result: DeleteTaskResult };
  restoreTask: { params: RestoreTaskInput; result: TaskMutationResult };
  updatePerson: { params: UpdatePersonInput; result: PersonMutationResult };
  refresh: { params: EmptyParams; result: ServiceState };
  getIndexStatus: { params: EmptyParams; result: CastleIndexStatus };
  searchKnowledge: { params: CastleSearchRequest; result: CastleSearchResponse };
  readNoteContext: { params: CastleNoteContextRequest; result: CastleNoteContext };
  relatedNotes: {
    params: { noteId: string; limit?: number };
    result: CastleSearchResponse;
  };
  queryTasks: { params: CastleEntityQuery; result: CastleStructuredQueryResponse };
  queryEvents: { params: CastleEntityQuery; result: CastleStructuredQueryResponse };
  listProjects: { params: CastleEntityQuery; result: CastleStructuredQueryResponse };
  queryPeople: { params: CastleEntityQuery; result: CastleStructuredQueryResponse };
  queryRelationships: {
    params: CastleEntityQuery;
    result: CastleStructuredQueryResponse;
  };
  getKnowledgeOverview: { params: EmptyParams; result: CastleKnowledgeOverview };
  getRelationshipGraph: {
    params: EmptyParams;
    result: Record<string, unknown>;
  };
  cancelRequest: { params: { requestId: number }; result: { cancelled: boolean } };
  shutdown: { params: EmptyParams; result: { ok: boolean } };
}

export type CastleNativeMethod = keyof CastleNativeMethodMap;
export type CastleNativeParams<Method extends CastleNativeMethod> =
  CastleNativeMethodMap[Method]["params"];
export type CastleNativeResult<Method extends CastleNativeMethod> =
  CastleNativeMethodMap[Method]["result"];
export type CastleNativeLane = "read" | "write";

interface NativeMethodSpec<Method extends CastleNativeMethod> {
  lane: CastleNativeLane;
  timeoutMilliseconds: number;
  parse(value: unknown): CastleNativeResult<Method>;
}

const generatedParser = <Name extends Parameters<typeof parseCastleContract>[0]>(
  name: Name,
) => (value: unknown) => parseCastleContract(name, value);

const okParser = (value: unknown) => {
  if (!isRecord(value) || value.ok !== true) {
    throw new Error("Castle native service returned an invalid shutdown response.");
  }
  return { ok: true };
};

const cancellationParser = (value: unknown) => {
  if (!isRecord(value) || typeof value.cancelled !== "boolean") {
    throw new Error("Castle native service returned an invalid cancellation response.");
  }
  return { cancelled: value.cancelled };
};

export const nativeMethodSpecs: {
  [Method in CastleNativeMethod]: NativeMethodSpec<Method>;
} = {
  getState: { lane: "read", timeoutMilliseconds: 10_000, parse: generatedParser("ServiceState") },
  readSource: { lane: "read", timeoutMilliseconds: 10_000, parse: generatedParser("SourceDocument") },
  saveSource: { lane: "write", timeoutMilliseconds: 30_000, parse: generatedParser("SaveSourceResult") },
  createSource: { lane: "write", timeoutMilliseconds: 30_000, parse: generatedParser("SaveSourceResult") },
  createFolder: { lane: "write", timeoutMilliseconds: 30_000, parse: generatedParser("CreateFolderResult") },
  moveSource: { lane: "write", timeoutMilliseconds: 30_000, parse: generatedParser("MoveSourceResult") },
  deleteSource: { lane: "write", timeoutMilliseconds: 30_000, parse: generatedParser("DeleteSourceResult") },
  deleteFolder: { lane: "write", timeoutMilliseconds: 30_000, parse: generatedParser("DeleteFolderResult") },
  restoreSource: { lane: "write", timeoutMilliseconds: 30_000, parse: generatedParser("SaveSourceResult") },
  mutateTask: { lane: "write", timeoutMilliseconds: 60_000, parse: generatedParser("TaskMutationResult") },
  createTask: { lane: "write", timeoutMilliseconds: 60_000, parse: generatedParser("TaskMutationResult") },
  deleteTask: { lane: "write", timeoutMilliseconds: 60_000, parse: generatedParser("DeleteTaskResult") },
  restoreTask: { lane: "write", timeoutMilliseconds: 60_000, parse: generatedParser("TaskMutationResult") },
  updatePerson: { lane: "write", timeoutMilliseconds: 60_000, parse: generatedParser("PersonMutationResult") },
  refresh: { lane: "write", timeoutMilliseconds: 60_000, parse: generatedParser("ServiceState") },
  getIndexStatus: { lane: "read", timeoutMilliseconds: 10_000, parse: parseCastleIndexStatus },
  searchKnowledge: { lane: "read", timeoutMilliseconds: 30_000, parse: parseCastleSearchResponse },
  readNoteContext: { lane: "read", timeoutMilliseconds: 10_000, parse: parseCastleNoteContext },
  relatedNotes: { lane: "read", timeoutMilliseconds: 30_000, parse: parseCastleSearchResponse },
  queryTasks: { lane: "read", timeoutMilliseconds: 15_000, parse: parseCastleStructuredQueryResponse },
  queryEvents: { lane: "read", timeoutMilliseconds: 15_000, parse: parseCastleStructuredQueryResponse },
  listProjects: { lane: "read", timeoutMilliseconds: 15_000, parse: parseCastleStructuredQueryResponse },
  queryPeople: { lane: "read", timeoutMilliseconds: 15_000, parse: parseCastleStructuredQueryResponse },
  queryRelationships: { lane: "read", timeoutMilliseconds: 15_000, parse: parseCastleStructuredQueryResponse },
  getKnowledgeOverview: { lane: "read", timeoutMilliseconds: 15_000, parse: parseCastleKnowledgeOverview },
  getRelationshipGraph: { lane: "read", timeoutMilliseconds: 15_000, parse: parseCastleRecordDocument },
  cancelRequest: { lane: "write", timeoutMilliseconds: 5_000, parse: cancellationParser },
  shutdown: { lane: "write", timeoutMilliseconds: 5_000, parse: okParser },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
