export interface CastleChatRequest {
  requestId: string;
  question: string;
  currentNoteId?: string;
  attachedNoteIds: string[];
  searchLibrary: boolean;
}

export interface CastleChatCitation {
  handle: string;
  noteId: string;
  title: string;
  route: string;
  sourceFile: string;
  startLine: number;
  endLine: number;
  sourceRevision: string;
}

export type CastleChatToolName = "search_knowledge" | "read_note";

export type CastleChatEvent =
  | {
      type: "status";
      requestId: string;
      status: "retrieving" | "awaiting_approval" | "generating" | "cancelled";
      message: string;
    }
  | {
      type: "context";
      requestId: string;
      provider: { kind: "local" | "external"; name: string; model: string };
      externalTransmission: boolean;
      citations: CastleChatCitation[];
      toolNames: CastleChatToolName[];
      toolCallCount: number;
    }
  | { type: "delta"; requestId: string; text: string }
  | {
      type: "complete";
      requestId: string;
      citations: CastleChatCitation[];
      unsupportedCitationHandles: string[];
    }
  | { type: "error"; requestId: string; message: string; recoverable: boolean };

export interface CastleAiChat {
  start(request: CastleChatRequest): Promise<{ requestId: string }>;
  cancel(requestId: string): Promise<void>;
  onEvent(listener: (event: CastleChatEvent) => void): () => void;
  audit(): Promise<CastleChatAuditSnapshot>;
  clearAudit(): Promise<CastleChatAuditSnapshot>;
}

export interface CastleChatAuditEntry {
  requestId: string;
  startedAt: string;
  finishedAt: string | null;
  durationMilliseconds: number | null;
  outcome: "active" | "completed" | "cancelled" | "error";
  providerKind: "local" | "external" | null;
  providerName: string | null;
  model: string | null;
  externalTransmission: boolean | null;
  sourceCount: number;
  responseCharacters: number;
  citedSourceCount: number;
  unsupportedCitationCount: number;
  toolNames: CastleChatToolName[];
  toolCallCount: number;
}

export interface CastleChatAuditSnapshot {
  persistence: "memory_only";
  retentionLimit: number;
  activeCount: number;
  entries: CastleChatAuditEntry[];
}

export function parseCastleChatAuditSnapshot(
  value: unknown,
): CastleChatAuditSnapshot {
  if (
    !isRecord(value) ||
    value.persistence !== "memory_only" ||
    !isCount(value.retentionLimit) ||
    value.retentionLimit < 1 ||
    !isCount(value.activeCount) ||
    !Array.isArray(value.entries)
  ) {
    throw new Error("Castle received invalid chat audit diagnostics.");
  }
  const entries = value.entries.map(parseAuditEntry);
  if (
    entries.length > value.retentionLimit + value.activeCount ||
    entries.filter((entry) => entry.outcome === "active").length !==
      value.activeCount
  ) {
    throw new Error("Castle received invalid chat audit diagnostics.");
  }
  return {
    persistence: value.persistence,
    retentionLimit: value.retentionLimit,
    activeCount: value.activeCount,
    entries,
  };
}

export function parseCastleChatEvent(value: unknown): CastleChatEvent {
  if (!isRecord(value) || typeof value.type !== "string" || !isRequestId(value.requestId)) {
    throw new Error("Castle received an invalid chat event.");
  }
  if (value.type === "delta") {
    if (typeof value.text !== "string") throw invalidEvent();
    return value as unknown as CastleChatEvent;
  }
  if (value.type === "status") {
    if (
      !["retrieving", "awaiting_approval", "generating", "cancelled"].includes(
        String(value.status),
      ) ||
      typeof value.message !== "string"
    ) {
      throw invalidEvent();
    }
    return value as unknown as CastleChatEvent;
  }
  if (value.type === "error") {
    if (typeof value.message !== "string" || typeof value.recoverable !== "boolean") {
      throw invalidEvent();
    }
    return value as unknown as CastleChatEvent;
  }
  if (value.type === "context") {
    if (
      !isProvider(value.provider) ||
      typeof value.externalTransmission !== "boolean" ||
      !isCitations(value.citations) ||
      !isToolNames(value.toolNames) ||
      !isCount(value.toolCallCount) ||
      value.toolCallCount > 12
    ) {
      throw invalidEvent();
    }
    return value as unknown as CastleChatEvent;
  }
  if (value.type === "complete") {
    if (!isCitations(value.citations) || !isStringArray(value.unsupportedCitationHandles)) {
      throw invalidEvent();
    }
    return value as unknown as CastleChatEvent;
  }
  throw invalidEvent();
}

function isProvider(value: unknown) {
  return (
    isRecord(value) &&
    (value.kind === "local" || value.kind === "external") &&
    typeof value.name === "string" &&
    typeof value.model === "string"
  );
}

function isCitations(value: unknown): value is CastleChatCitation[] {
  return (
    Array.isArray(value) &&
    value.length <= 8 &&
    value.every(
      (citation) =>
        isRecord(citation) &&
        typeof citation.handle === "string" &&
        typeof citation.noteId === "string" &&
        typeof citation.title === "string" &&
        typeof citation.route === "string" &&
        typeof citation.sourceFile === "string" &&
        Number.isSafeInteger(citation.startLine) &&
        Number.isSafeInteger(citation.endLine) &&
        typeof citation.sourceRevision === "string",
    )
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}

function parseAuditEntry(value: unknown): CastleChatAuditEntry {
  if (
    !isRecord(value) ||
    !isRequestId(value.requestId) ||
    typeof value.startedAt !== "string" ||
    (value.finishedAt !== null && typeof value.finishedAt !== "string") ||
    (value.durationMilliseconds !== null && !isCount(value.durationMilliseconds)) ||
    !["active", "completed", "cancelled", "error"].includes(
      String(value.outcome),
    ) ||
    (value.providerKind !== null &&
      value.providerKind !== "local" &&
      value.providerKind !== "external") ||
    (value.providerName !== null && typeof value.providerName !== "string") ||
    (value.model !== null && typeof value.model !== "string") ||
    (value.externalTransmission !== null &&
      typeof value.externalTransmission !== "boolean") ||
    !isCount(value.sourceCount) ||
    !isCount(value.responseCharacters) ||
    !isCount(value.citedSourceCount) ||
    !isCount(value.unsupportedCitationCount) ||
    !isToolNames(value.toolNames) ||
    !isCount(value.toolCallCount) ||
    value.toolCallCount > 12
  ) {
    throw new Error("Castle received invalid chat audit diagnostics.");
  }
  return value as unknown as CastleChatAuditEntry;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isToolNames(value: unknown): value is CastleChatToolName[] {
  return (
    Array.isArray(value) &&
    value.length <= 2 &&
    value.every(
      (item) => item === "search_knowledge" || item === "read_note",
    ) &&
    new Set(value).size === value.length
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidEvent(): Error {
  return new Error("Castle received an invalid chat event.");
}
