import type {
  CreateCastleSourceInput,
  CreateCastleFolderInput,
  DeleteCastleSourceInput,
  DeleteCastleFolderInput,
  MoveCastleSourceInput,
  RestoreCastleSourceInput,
  SaveCastleSourceInput,
} from "../src/platform/castle_platform";
import type {
  CastleEntityQuery,
  CastleNoteContextRequest,
  CastleSearchFilters,
  CastleSearchRequest,
} from "../src/platform/knowledge_queries";
import type { CastleChatRequest } from "../src/platform/ai_chat";
import {
  parseCastleUserPreferences,
  type CastleUserPreferences,
} from "../src/platform/user_preferences";
import {
  parseCastleContract,
  type CreateTaskInput,
  type DeleteTaskInput,
  type MutateTaskInput,
  type RestoreTaskInput,
  type UpdatePersonInput,
} from "../src/generated/castle_contracts";
import { canvasMediaKind } from "../src/features/canvas/canvasMedia";

export const desktopInfoChannel = "castle:desktop:get-info";
export const loadUserPreferencesChannel = "castle:desktop:load-user-preferences";
export const saveUserPreferencesChannel = "castle:desktop:save-user-preferences";
export const chooseLibraryChannel = "castle:desktop:choose-library";
export const openLibraryChannel = "castle:desktop:open-library";
export const fullScreenStateChannel = "castle:desktop:full-screen-state";
export const getFullScreenStateChannel = "castle:desktop:get-full-screen-state";
export const readSourceChannel = "castle:desktop:read-source";
export const saveSourceChannel = "castle:desktop:save-source";
export const createSourceChannel = "castle:desktop:create-source";
export const createFolderChannel = "castle:desktop:create-folder";
export const moveSourceChannel = "castle:desktop:move-source";
export const deleteSourceChannel = "castle:desktop:delete-source";
export const deleteFolderChannel = "castle:desktop:delete-folder";
export const restoreSourceChannel = "castle:desktop:restore-source";
export const mutateTaskChannel = "castle:desktop:mutate-task";
export const createTaskChannel = "castle:desktop:create-task";
export const deleteTaskChannel = "castle:desktop:delete-task";
export const restoreTaskChannel = "castle:desktop:restore-task";
export const updatePersonChannel = "castle:desktop:update-person";
export const contentServiceStatusChannel = "castle:desktop:content-service-status";
export const sourceChangeChannel = "castle:desktop:source-change";
export const contentDeltaChannel = "castle:desktop:content-delta";
export const retryContentServiceChannel = "castle:desktop:retry-content-service";
export const restartAppChannel = "castle:desktop:restart-app";
export const listManagedSheetsChannel = "castle:desktop:list-managed-sheets";
export const readManagedSheetChannel = "castle:desktop:read-managed-sheet";
export const saveManagedSheetChannel = "castle:desktop:save-managed-sheet";
export const listManagedCanvasesChannel = "castle:desktop:list-managed-canvases";
export const readManagedCanvasChannel = "castle:desktop:read-managed-canvas";
export const createManagedCanvasChannel = "castle:desktop:create-managed-canvas";
export const saveManagedCanvasChannel = "castle:desktop:save-managed-canvas";
export const importCanvasMediaChannel = "castle:desktop:import-canvas-media";
export const openCanvasMediaChannel = "castle:desktop:open-canvas-media";
export const resolveVideoPosterChannel = "castle:desktop:resolve-video-poster";
export const indexStatusChannel = "castle:knowledge:index-status";
export const searchKnowledgeChannel = "castle:knowledge:search";
export const readNoteContextChannel = "castle:knowledge:read-note";
export const relatedNotesChannel = "castle:knowledge:related-notes";
export const queryTasksChannel = "castle:knowledge:query-tasks";
export const queryEventsChannel = "castle:knowledge:query-events";
export const listProjectsChannel = "castle:knowledge:list-projects";
export const queryPeopleChannel = "castle:knowledge:query-people";
export const queryRelationshipsChannel = "castle:knowledge:query-relationships";
export const knowledgeOverviewChannel = "castle:knowledge:overview";
export const startAiChatChannel = "castle:ai-chat:start";
export const cancelAiChatChannel = "castle:ai-chat:cancel";
export const aiChatEventChannel = "castle:ai-chat:event";
export const getAiChatAuditChannel = "castle:ai-chat:audit";
export const clearAiChatAuditChannel = "castle:ai-chat:clear-audit";

const maximumMarkdownLength = 8 * 1024 * 1024;
const maximumCanvasMediaBytes = 50 * 1024 * 1024;

export function parseManagedSheetPathInput(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "relativePath")
  ) {
    throw new Error("Castle rejected an invalid sheet request.");
  }
  const relativePath = (value as Record<string, unknown>).relativePath;
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.length > 2048 ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    relativePath.startsWith("/") ||
    !relativePath.toLocaleLowerCase().endsWith(".ods") ||
    relativePath.split("/").some((segment) =>
      segment.length === 0 || segment === "." || segment === ".." || segment.startsWith(".")
    )
  ) {
    throw new Error("Castle rejected an invalid sheet request.");
  }
  return { relativePath };
}

export function parseManagedCanvasPathInput(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "relativePath")
  ) {
    throw new Error("Castle rejected an invalid canvas request.");
  }
  const relativePath = (value as Record<string, unknown>).relativePath;
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.length > 2048 ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    relativePath.startsWith("/") ||
    !relativePath.toLocaleLowerCase().endsWith(".canvas") ||
    relativePath.split("/").some((segment) =>
      segment.length === 0 || segment === "." || segment === ".." || segment.startsWith(".")
    )
  ) {
    throw new Error("Castle rejected an invalid canvas request.");
  }
  return { relativePath };
}

export function parseManagedCanvasWriteInput(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => key !== "relativePath" && key !== "source",
    )
  ) {
    throw new Error("Castle rejected an invalid canvas write.");
  }
  const input = value as Record<string, unknown>;
  const { relativePath } = parseManagedCanvasPathInput({
    relativePath: input.relativePath,
  });
  if (
    typeof input.source !== "string" ||
    input.source.length === 0 ||
    Buffer.byteLength(input.source, "utf8") > 8 * 1024 * 1024
  ) {
    throw new Error("Castle rejected invalid JSON Canvas source.");
  }
  return { relativePath, source: input.source };
}

export function parseCanvasMediaImportInput(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "name" && key !== "mimeType" && key !== "data")
  ) {
    throw new Error("Castle rejected an invalid canvas media import.");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.name !== "string" ||
    input.name.length === 0 ||
    input.name.length > 240 ||
    input.name.includes("/") ||
    input.name.includes("\\") ||
    input.name.includes("\0") ||
    typeof input.mimeType !== "string" ||
    input.mimeType.length > 128 ||
    !(input.data instanceof ArrayBuffer) ||
    input.data.byteLength === 0 ||
    input.data.byteLength > maximumCanvasMediaBytes ||
    !canvasMediaKind(input.name, input.mimeType)
  ) {
    throw new Error("Castle rejected an unsupported canvas media import.");
  }
  return {
    name: input.name,
    mimeType: input.mimeType,
    data: input.data,
  };
}

export function parseCanvasMediaPathInput(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "relativePath")
  ) {
    throw new Error("Castle rejected an invalid canvas media request.");
  }
  const relativePath = (value as Record<string, unknown>).relativePath;
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.length > 2048 ||
    !relativePath.startsWith("assets/") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    relativePath.startsWith("/") ||
    relativePath.split("/").some((segment) =>
      segment.length === 0 || segment === "." || segment === ".." || segment.startsWith(".")
    ) ||
    !canvasMediaKind(relativePath)
  ) {
    throw new Error("Castle rejected an invalid canvas media request.");
  }
  return { relativePath };
}

export function parseOpenLibraryInput(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "path")
  ) {
    throw new Error("Castle rejected an invalid library request.");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.path !== "string" ||
    input.path.length === 0 ||
    input.path.length > 32_768
  ) {
    throw new Error("Castle rejected an invalid library request.");
  }
  return { path: input.path };
}

export function parseUserPreferencesInput(value: unknown): CastleUserPreferences {
  const preferences = parseCastleUserPreferences(value);
  if (!preferences) {
    throw new Error("Castle rejected invalid interface preferences.");
  }
  return preferences;
}

export function parseSaveSourceInput(value: unknown): SaveCastleSourceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle rejected an invalid save request.");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.noteId !== "string" ||
    input.noteId.length === 0 ||
    input.noteId.length > 512 ||
    typeof input.sourceFile !== "string" ||
    input.sourceFile.length === 0 ||
    input.sourceFile.length > 2048 ||
    typeof input.markdown !== "string" ||
    input.markdown.length > maximumMarkdownLength ||
    typeof input.expectedRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.expectedRevision)
  ) {
    throw new Error("Castle rejected an invalid save request.");
  }

  return {
    noteId: input.noteId,
    sourceFile: input.sourceFile,
    markdown: input.markdown,
    expectedRevision: input.expectedRevision,
  };
}

export function parseCreateSourceInput(value: unknown): CreateCastleSourceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle rejected an invalid create request.");
  }
  const input = value as Record<string, unknown>;
  if (
    !isBoundedNoteId(input.noteId) ||
    !isBoundedSourceFile(input.sourceFile) ||
    typeof input.markdown !== "string" ||
    input.markdown.length > maximumMarkdownLength
  ) {
    throw new Error("Castle rejected an invalid create request.");
  }
  return {
    noteId: input.noteId,
    sourceFile: input.sourceFile,
    markdown: input.markdown,
  };
}

export function parseCreateFolderInput(value: unknown): CreateCastleFolderInput {
  const sourceDirectory = parseFolderSourceDirectory(value, "create");
  return { sourceDirectory };
}

export function parseDeleteSourceInput(value: unknown): DeleteCastleSourceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle rejected an invalid delete request.");
  }
  const input = value as Record<string, unknown>;
  if (
    !isBoundedNoteId(input.noteId) ||
    !isBoundedSourceFile(input.sourceFile) ||
    typeof input.expectedRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.expectedRevision)
  ) {
    throw new Error("Castle rejected an invalid delete request.");
  }
  return {
    noteId: input.noteId,
    sourceFile: input.sourceFile,
    expectedRevision: input.expectedRevision,
  };
}

export function parseDeleteFolderInput(value: unknown): DeleteCastleFolderInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle rejected an invalid folder removal request.");
  }
  const input = value as Record<string, unknown>;
  const sourceDirectory = parseFolderSourceDirectory(value, "remove");
  if (typeof input.recursive !== "boolean") {
    throw new Error("Castle rejected an invalid folder removal request.");
  }
  return { sourceDirectory, recursive: input.recursive };
}

export function parseMoveSourceInput(value: unknown): MoveCastleSourceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle rejected an invalid move request.");
  }
  const input = value as Record<string, unknown>;
  if (
    !isBoundedNoteId(input.noteId) ||
    !isBoundedSourceFile(input.sourceFile) ||
    !isBoundedSourceFile(input.destinationSourceFile) ||
    typeof input.expectedRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.expectedRevision)
  ) {
    throw new Error("Castle rejected an invalid move request.");
  }
  return {
    noteId: input.noteId,
    sourceFile: input.sourceFile,
    destinationSourceFile: input.destinationSourceFile,
    expectedRevision: input.expectedRevision,
  };
}

export function parseRestoreSourceInput(value: unknown): RestoreCastleSourceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle rejected an invalid restore request.");
  }
  const input = value as Record<string, unknown>;
  if (
    !isBoundedNoteId(input.noteId) ||
    !isBoundedSourceFile(input.sourceFile) ||
    typeof input.trashId !== "string" ||
    input.trashId.length === 0 ||
    input.trashId.length > 4096
  ) {
    throw new Error("Castle rejected an invalid restore request.");
  }
  return {
    noteId: input.noteId,
    sourceFile: input.sourceFile,
    trashId: input.trashId,
  };
}

export function parseMutateTaskInput(value: unknown): MutateTaskInput {
  return parseStructuredMutation("MutateTaskInput", value) as MutateTaskInput;
}

export function parseCreateTaskInput(value: unknown): CreateTaskInput {
  return parseStructuredMutation("CreateTaskInput", value) as CreateTaskInput;
}

export function parseDeleteTaskInput(value: unknown): DeleteTaskInput {
  return parseStructuredMutation("DeleteTaskInput", value) as DeleteTaskInput;
}

export function parseRestoreTaskInput(value: unknown): RestoreTaskInput {
  return parseStructuredMutation("RestoreTaskInput", value) as RestoreTaskInput;
}

export function parseUpdatePersonInput(value: unknown): UpdatePersonInput {
  return parseStructuredMutation("UpdatePersonInput", value) as UpdatePersonInput;
}

function parseStructuredMutation(
  name:
    | "MutateTaskInput"
    | "CreateTaskInput"
    | "DeleteTaskInput"
    | "RestoreTaskInput"
    | "UpdatePersonInput",
  value: unknown,
) {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string" || encoded.length > maximumMarkdownLength) {
    throw new Error("Castle rejected an oversized structured mutation.");
  }
  try {
    return parseCastleContract(name, value);
  } catch {
    throw new Error("Castle rejected an invalid structured mutation.");
  }
}

function isBoundedNoteId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function isBoundedSourceFile(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048;
}

function parseFolderSourceDirectory(value: unknown, operation: "create" | "remove") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Castle rejected an invalid folder ${operation} request.`);
  }
  const input = value as Record<string, unknown>;
  const sourceDirectory = input.sourceDirectory;
  const segments = typeof sourceDirectory === "string"
    ? sourceDirectory.split("/")
    : [];
  const supportedSections = new Set([
    "personal",
    "people",
    "wiki",
    "journal",
    "events",
    "notes",
    "stash",
    "projects",
    "tasks",
  ]);
  if (
    typeof sourceDirectory !== "string" ||
    sourceDirectory.length === 0 ||
    sourceDirectory.length > 2048 ||
    sourceDirectory.includes("\\") ||
    sourceDirectory.startsWith("/") ||
    segments.length < 2 ||
    !supportedSections.has(segments[0]) ||
    segments.some((segment) =>
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.startsWith(".")
    )
  ) {
    throw new Error(`Castle rejected an invalid folder ${operation} request.`);
  }
  return sourceDirectory;
}

export function parseSearchRequest(value: unknown): CastleSearchRequest {
  const input = record(value, "Castle rejected an invalid search request.");
  const keys = new Set([
    "query",
    "mode",
    "filters",
    "currentNoteId",
    "attachedNoteIds",
    "limit",
    "diagnostics",
  ]);
  assertKnownKeys(input, keys, "Castle rejected an invalid search request.");
  if (
    typeof input.query !== "string" ||
    input.query.trim().length === 0 ||
    Array.from(input.query).length > 512 ||
    (input.mode !== undefined &&
      !["lexical", "semantic", "hybrid"].includes(String(input.mode))) ||
    (input.currentNoteId !== undefined && !isBoundedNoteId(input.currentNoteId)) ||
    (input.limit !== undefined && !isBoundedInteger(input.limit, 1, 50)) ||
    (input.diagnostics !== undefined && typeof input.diagnostics !== "boolean")
  ) {
    throw new Error("Castle rejected an invalid search request.");
  }
  const attachedNoteIds = input.attachedNoteIds ?? [];
  if (
    !Array.isArray(attachedNoteIds) ||
    attachedNoteIds.length > 20 ||
    !attachedNoteIds.every(isBoundedNoteId)
  ) {
    throw new Error("Castle rejected an invalid search request.");
  }
  const filters = parseSearchFilters(input.filters);
  return compact({
    query: input.query,
    mode: input.mode,
    filters,
    currentNoteId: input.currentNoteId,
    attachedNoteIds,
    limit: input.limit,
    diagnostics: input.diagnostics,
  }) as unknown as CastleSearchRequest;
}

export function parseNoteContextRequest(value: unknown): CastleNoteContextRequest {
  const input = record(value, "Castle rejected an invalid note-context request.");
  assertKnownKeys(
    input,
    new Set(["noteId", "startLine", "endLine", "maxBytes"]),
    "Castle rejected an invalid note-context request.",
  );
  if (
    !isBoundedNoteId(input.noteId) ||
    (input.startLine !== undefined && !isBoundedInteger(input.startLine, 1, 10_000_000)) ||
    (input.endLine !== undefined && !isBoundedInteger(input.endLine, 1, 10_000_000)) ||
    (input.maxBytes !== undefined && !isBoundedInteger(input.maxBytes, 1, 64 * 1024)) ||
    (typeof input.startLine === "number" &&
      typeof input.endLine === "number" &&
      input.endLine < input.startLine)
  ) {
    throw new Error("Castle rejected an invalid note-context request.");
  }
  return compact(input) as unknown as CastleNoteContextRequest;
}

export function parseRelatedNotesRequest(value: unknown) {
  const input = record(value, "Castle rejected an invalid related-notes request.");
  assertKnownKeys(
    input,
    new Set(["noteId", "limit"]),
    "Castle rejected an invalid related-notes request.",
  );
  if (
    !isBoundedNoteId(input.noteId) ||
    (input.limit !== undefined && !isBoundedInteger(input.limit, 1, 50))
  ) {
    throw new Error("Castle rejected an invalid related-notes request.");
  }
  return compact(input) as { noteId: string; limit?: number };
}

export function parseEntityQuery(value: unknown): CastleEntityQuery {
  const input = record(value, "Castle rejected an invalid structured query.");
  assertKnownKeys(
    input,
    new Set([
      "status",
      "personId",
      "projectId",
      "dateFrom",
      "dateTo",
      "relation",
      "alignment",
      "knownFrom",
      "limit",
    ]),
    "Castle rejected an invalid structured query.",
  );
  for (const key of [
    "status",
    "personId",
    "projectId",
    "dateFrom",
    "dateTo",
    "relation",
    "alignment",
    "knownFrom",
  ] as const) {
    const item = input[key];
    if (item !== undefined && (typeof item !== "string" || item.length > 512)) {
      throw new Error("Castle rejected an invalid structured query.");
    }
  }
  if (input.limit !== undefined && !isBoundedInteger(input.limit, 1, 100)) {
    throw new Error("Castle rejected an invalid structured query.");
  }
  return compact(input) as CastleEntityQuery;
}

export function parseChatRequest(value: unknown): CastleChatRequest {
  const input = record(value, "Castle rejected an invalid chat request.");
  assertKnownKeys(
    input,
    new Set([
      "requestId",
      "question",
      "currentNoteId",
      "attachedNoteIds",
      "searchLibrary",
    ]),
    "Castle rejected an invalid chat request.",
  );
  if (
    !isRequestId(input.requestId) ||
    typeof input.question !== "string" ||
    input.question.trim().length === 0 ||
    Array.from(input.question).length > 8_000 ||
    typeof input.searchLibrary !== "boolean" ||
    (input.currentNoteId !== undefined && !isSafeNoteId(input.currentNoteId))
  ) {
    throw new Error("Castle rejected an invalid chat request.");
  }
  if (
    !Array.isArray(input.attachedNoteIds) ||
    input.attachedNoteIds.length > 10 ||
    !input.attachedNoteIds.every(isSafeNoteId) ||
    new Set(input.attachedNoteIds).size !== input.attachedNoteIds.length
  ) {
    throw new Error("Castle rejected an invalid chat request.");
  }
  return compact(input) as unknown as CastleChatRequest;
}

export function parseChatCancellation(value: unknown) {
  const input = record(value, "Castle rejected an invalid chat cancellation.");
  assertKnownKeys(
    input,
    new Set(["requestId"]),
    "Castle rejected an invalid chat cancellation.",
  );
  if (!isRequestId(input.requestId)) {
    throw new Error("Castle rejected an invalid chat cancellation.");
  }
  return { requestId: input.requestId };
}

function parseSearchFilters(value: unknown): CastleSearchFilters | undefined {
  if (value === undefined) return undefined;
  const filters = record(value, "Castle rejected invalid search filters.");
  const keys = new Set([
    "section",
    "recordType",
    "tag",
    "status",
    "projectId",
    "personId",
    "modifiedFrom",
    "modifiedTo",
  ]);
  assertKnownKeys(filters, keys, "Castle rejected invalid search filters.");
  for (const item of Object.values(filters)) {
    if (typeof item !== "string" || item.length === 0 || item.length > 512) {
      throw new Error("Castle rejected invalid search filters.");
    }
  }
  return filters as CastleSearchFilters;
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
  message: string,
) {
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error(message);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isSafeNoteId(value: unknown): value is string {
  return (
    isBoundedNoteId(value) &&
    !value.includes("..") &&
    !value.includes("\0")
  );
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
