export type CastleSearchMode = "lexical" | "semantic" | "hybrid";

export interface CastleSearchFilters {
  section?: string;
  recordType?: string;
  tag?: string;
  status?: string;
  projectId?: string;
  personId?: string;
  modifiedFrom?: string;
  modifiedTo?: string;
}

export interface CastleSearchRequest {
  query: string;
  mode?: CastleSearchMode;
  filters?: CastleSearchFilters;
  currentNoteId?: string;
  attachedNoteIds?: string[];
  limit?: number;
  diagnostics?: boolean;
}

export interface CastleSearchResult {
  noteId: string;
  recordId: string | null;
  title: string;
  route: string;
  sourceFile: string;
  headingPath: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  lexicalScore: number;
  semanticScore: number | null;
  structuredScore: number;
  finalScore: number;
  explanationCodes: string[];
  sourceRevision: string;
  indexGeneration: string;
}

export interface CastleSearchResponse {
  query: string;
  requestedMode: CastleSearchMode;
  modeUsed: CastleSearchMode;
  semanticAvailable: boolean;
  degradedReasons: string[];
  generation: string;
  sourceFingerprint: string;
  results: CastleSearchResult[];
}

export interface CastleNoteContextRequest {
  noteId: string;
  startLine?: number;
  endLine?: number;
  maxBytes?: number;
}

export interface CastleNoteContext {
  noteId: string;
  title: string;
  route: string;
  sourceFile: string;
  startLine: number;
  endLine: number;
  markdown: string;
  truncated: boolean;
  sourceRevision: string;
  indexGeneration: string;
}

export interface CastleEntityQuery {
  status?: string;
  personId?: string;
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
  relation?: string;
  alignment?: string;
  knownFrom?: string;
  limit?: number;
}

export interface CastleStructuredQueryResponse {
  kind: "task" | "event" | "project" | "person" | "relationship";
  generation: string;
  sourceFingerprint: string;
  items: unknown[];
  truncated: boolean;
}

export interface CastleIndexStatus {
  state: "ready" | "building" | "degraded" | "stale" | "unavailable";
  manifest: {
    generation: string;
    sourceFingerprint: string;
    indexSchemaVersion: number;
    semanticAvailable: boolean;
  } | null;
  databasePath: string | null;
  recoveredManifest: boolean;
  message: string | null;
  embedding: CastleEmbeddingRuntimeStatus;
}

export type CastleEmbeddingRuntimeState =
  | "preparing"
  | "ready"
  | "scheduled"
  | "running"
  | "failed"
  | "shutdown";

export interface CastleEmbeddingProviderMetadata {
  provider: string;
  model: string;
  inputVersion: string;
  dimensions: number;
  maximumBatchSize: number;
}

export interface CastleEmbeddingSchedulerStatus {
  state: "idle" | "scheduled" | "running" | "failed" | "shutdown";
  provider: CastleEmbeddingProviderMetadata | null;
  activeSourceFingerprint: string | null;
  queuedSourceFingerprint: string | null;
  publishedRuns: number;
  cancelledRuns: number;
  staleRuns: number;
  failedRuns: number;
  lastUniqueContentCount: number;
  lastCacheHits: number;
  lastGenerated: number;
  lastPending: number;
  lastRetries: number;
  lastErrorClass: string | null;
}

export interface CastleEmbeddingRuntimeStatus {
  state: CastleEmbeddingRuntimeState;
  local: true;
  modelReady: boolean;
  provider: CastleEmbeddingProviderMetadata;
  scheduler: CastleEmbeddingSchedulerStatus | null;
  lastErrorClass: string | null;
  message: string | null;
}

export interface CastleCountBucket {
  label: string;
  count: number;
}

export interface CastleEntityAnalytics {
  kind: string;
  total: number;
  statuses: CastleCountBucket[];
}

export interface CastleKnowledgeOverview {
  generation: string;
  sourceFingerprint: string;
  notes: {
    total: number;
    wordCount: number;
    readingMinutes: number;
  };
  links: number;
  chunks: number;
  embeddedChunks: number;
  entities: CastleEntityAnalytics[];
}

export interface CastleKnowledgeQueries {
  status(): Promise<CastleIndexStatus>;
  search(request: CastleSearchRequest): Promise<CastleSearchResponse>;
  readNote(request: CastleNoteContextRequest): Promise<CastleNoteContext>;
  relatedNotes(noteId: string, limit?: number): Promise<CastleSearchResponse>;
  queryTasks(request?: CastleEntityQuery): Promise<CastleStructuredQueryResponse>;
  queryEvents(request?: CastleEntityQuery): Promise<CastleStructuredQueryResponse>;
  listProjects(request?: CastleEntityQuery): Promise<CastleStructuredQueryResponse>;
  queryPeople(request?: CastleEntityQuery): Promise<CastleStructuredQueryResponse>;
  queryRelationships(request?: CastleEntityQuery): Promise<CastleStructuredQueryResponse>;
  overview(): Promise<CastleKnowledgeOverview>;
}

export function parseCastleSearchResponse(value: unknown): CastleSearchResponse {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error("Castle received an invalid knowledge-search response.");
  }
  if (
    typeof value.query !== "string" ||
    !isSearchMode(value.requestedMode) ||
    !isSearchMode(value.modeUsed) ||
    typeof value.semanticAvailable !== "boolean" ||
    !isStringArray(value.degradedReasons) ||
    typeof value.generation !== "string" ||
    typeof value.sourceFingerprint !== "string"
  ) {
    throw new Error("Castle received an invalid knowledge-search response.");
  }
  const results = value.results.map(parseSearchResult);
  return { ...value, results } as CastleSearchResponse;
}

export function parseCastleIndexStatus(value: unknown): CastleIndexStatus {
  if (
    !isRecord(value) ||
    !isIndexState(value.state) ||
    !(value.manifest === null || isIndexManifest(value.manifest)) ||
    !(value.databasePath === null || typeof value.databasePath === "string") ||
    typeof value.recoveredManifest !== "boolean" ||
    !(value.message === null || typeof value.message === "string")
  ) {
    throw new Error("Castle received an invalid index-status response.");
  }
  return {
    state: value.state,
    manifest: value.manifest,
    databasePath: value.databasePath,
    recoveredManifest: value.recoveredManifest,
    message: value.message,
    embedding: parseEmbeddingRuntimeStatus(value.embedding),
  };
}

function parseEmbeddingRuntimeStatus(value: unknown): CastleEmbeddingRuntimeStatus {
  if (
    !isRecord(value) ||
    !isEmbeddingRuntimeState(value.state) ||
    value.local !== true ||
    typeof value.modelReady !== "boolean" ||
    !(value.scheduler === null || isEmbeddingSchedulerStatus(value.scheduler)) ||
    !(value.lastErrorClass === null || typeof value.lastErrorClass === "string") ||
    !(value.message === null || typeof value.message === "string")
  ) {
    throw new Error("Castle received an invalid embedding-status response.");
  }
  return {
    state: value.state,
    local: true,
    modelReady: value.modelReady,
    provider: parseEmbeddingProviderMetadata(value.provider),
    scheduler: value.scheduler,
    lastErrorClass: value.lastErrorClass,
    message: value.message,
  };
}

function parseEmbeddingProviderMetadata(value: unknown): CastleEmbeddingProviderMetadata {
  if (
    !isRecord(value) ||
    typeof value.provider !== "string" ||
    typeof value.model !== "string" ||
    typeof value.inputVersion !== "string" ||
    !isPositiveCount(value.dimensions) ||
    !isPositiveCount(value.maximumBatchSize)
  ) {
    throw new Error("Castle received invalid embedding-provider metadata.");
  }
  return value as unknown as CastleEmbeddingProviderMetadata;
}

function isEmbeddingSchedulerStatus(
  value: unknown,
): value is CastleEmbeddingSchedulerStatus {
  if (!isRecord(value) || !isEmbeddingSchedulerState(value.state)) return false;
  if (!(value.provider === null || isEmbeddingProviderMetadata(value.provider))) {
    return false;
  }
  return (
    isNullableString(value.activeSourceFingerprint) &&
    isNullableString(value.queuedSourceFingerprint) &&
    isCount(value.publishedRuns) &&
    isCount(value.cancelledRuns) &&
    isCount(value.staleRuns) &&
    isCount(value.failedRuns) &&
    isCount(value.lastUniqueContentCount) &&
    isCount(value.lastCacheHits) &&
    isCount(value.lastGenerated) &&
    isCount(value.lastPending) &&
    isCount(value.lastRetries) &&
    isNullableString(value.lastErrorClass)
  );
}

function isEmbeddingProviderMetadata(
  value: unknown,
): value is CastleEmbeddingProviderMetadata {
  try {
    parseEmbeddingProviderMetadata(value);
    return true;
  } catch {
    return false;
  }
}

function isIndexManifest(value: unknown): value is CastleIndexStatus["manifest"] {
  return (
    isRecord(value) &&
    typeof value.generation === "string" &&
    typeof value.sourceFingerprint === "string" &&
    isPositiveCount(value.indexSchemaVersion) &&
    typeof value.semanticAvailable === "boolean"
  );
}

function isIndexState(value: unknown): value is CastleIndexStatus["state"] {
  return ["ready", "building", "degraded", "stale", "unavailable"].includes(
    String(value),
  );
}

function isEmbeddingRuntimeState(
  value: unknown,
): value is CastleEmbeddingRuntimeState {
  return ["preparing", "ready", "scheduled", "running", "failed", "shutdown"].includes(
    String(value),
  );
}

function isEmbeddingSchedulerState(
  value: unknown,
): value is CastleEmbeddingSchedulerStatus["state"] {
  return ["idle", "scheduled", "running", "failed", "shutdown"].includes(
    String(value),
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseCastleKnowledgeOverview(
  value: unknown,
): CastleKnowledgeOverview {
  if (
    !isRecord(value) ||
    typeof value.generation !== "string" ||
    typeof value.sourceFingerprint !== "string" ||
    !isRecord(value.notes) ||
    !isCount(value.notes.total) ||
    !isCount(value.notes.wordCount) ||
    !isCount(value.notes.readingMinutes) ||
    !isCount(value.links) ||
    !isCount(value.chunks) ||
    !isCount(value.embeddedChunks) ||
    !Array.isArray(value.entities)
  ) {
    throw new Error("Castle received an invalid knowledge-overview response.");
  }
  const entities = value.entities.map((entity) => {
    if (
      !isRecord(entity) ||
      typeof entity.kind !== "string" ||
      !isCount(entity.total) ||
      !Array.isArray(entity.statuses)
    ) {
      throw new Error("Castle received an invalid knowledge-overview response.");
    }
    const statuses = entity.statuses.map((status) => {
      if (
        !isRecord(status) ||
        typeof status.label !== "string" ||
        !isCount(status.count)
      ) {
        throw new Error("Castle received an invalid knowledge-overview response.");
      }
      return { label: status.label, count: status.count };
    });
    return { kind: entity.kind, total: entity.total, statuses };
  });
  return {
    generation: value.generation,
    sourceFingerprint: value.sourceFingerprint,
    notes: {
      total: value.notes.total,
      wordCount: value.notes.wordCount,
      readingMinutes: value.notes.readingMinutes,
    },
    links: value.links,
    chunks: value.chunks,
    embeddedChunks: value.embeddedChunks,
    entities,
  };
}

export function parseCastleNoteContext(value: unknown): CastleNoteContext {
  if (
    !isRecord(value) ||
    typeof value.noteId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.route !== "string" ||
    typeof value.sourceFile !== "string" ||
    !Number.isSafeInteger(value.startLine) ||
    !Number.isSafeInteger(value.endLine) ||
    typeof value.markdown !== "string" ||
    typeof value.truncated !== "boolean" ||
    typeof value.sourceRevision !== "string" ||
    typeof value.indexGeneration !== "string"
  ) {
    throw new Error("Castle received an invalid note-context response.");
  }
  return value as unknown as CastleNoteContext;
}

export function parseCastleStructuredQueryResponse(
  value: unknown,
): CastleStructuredQueryResponse {
  if (
    !isRecord(value) ||
    !["task", "event", "project", "person", "relationship"].includes(
      String(value.kind),
    ) ||
    typeof value.generation !== "string" ||
    typeof value.sourceFingerprint !== "string" ||
    !Array.isArray(value.items) ||
    typeof value.truncated !== "boolean"
  ) {
    throw new Error("Castle received an invalid structured-query response.");
  }
  return value as unknown as CastleStructuredQueryResponse;
}

export function parseCastleRecordDocument(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Castle received an invalid document response.");
  }
  return value;
}

function parseSearchResult(value: unknown): CastleSearchResult {
  if (
    !isRecord(value) ||
    typeof value.noteId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.route !== "string" ||
    typeof value.sourceFile !== "string" ||
    typeof value.headingPath !== "string" ||
    !Number.isSafeInteger(value.startLine) ||
    !Number.isSafeInteger(value.endLine) ||
    typeof value.excerpt !== "string" ||
    typeof value.finalScore !== "number" ||
    !isStringArray(value.explanationCodes) ||
    typeof value.sourceRevision !== "string" ||
    typeof value.indexGeneration !== "string"
  ) {
    throw new Error("Castle received an invalid knowledge-search result.");
  }
  return value as unknown as CastleSearchResult;
}

function isSearchMode(value: unknown): value is CastleSearchMode {
  return value === "lexical" || value === "semantic" || value === "hybrid";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
