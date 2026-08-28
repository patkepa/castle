import type {
  CastleChatEvent,
  CastleChatToolName,
} from "../../src/platform/ai_chat";

export type CastleChatAuditOutcome =
  | "active"
  | "completed"
  | "cancelled"
  | "error";

export interface CastleChatAuditEntry {
  requestId: string;
  startedAt: string;
  finishedAt: string | null;
  durationMilliseconds: number | null;
  outcome: CastleChatAuditOutcome;
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

export class CastleChatAuditLog {
  private readonly active = new Map<string, CastleChatAuditEntry>();
  private readonly completed: CastleChatAuditEntry[] = [];

  constructor(
    private readonly retentionLimit = 100,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!Number.isSafeInteger(retentionLimit) || retentionLimit < 1) {
      throw new Error("Castle chat audit retention must be a positive integer.");
    }
  }

  begin(requestId: string) {
    if (this.active.has(requestId)) {
      throw new Error("Castle rejected a duplicate chat audit request ID.");
    }
    this.active.set(requestId, {
      requestId,
      startedAt: this.now().toISOString(),
      finishedAt: null,
      durationMilliseconds: null,
      outcome: "active",
      providerKind: null,
      providerName: null,
      model: null,
      externalTransmission: null,
      sourceCount: 0,
      responseCharacters: 0,
      citedSourceCount: 0,
      unsupportedCitationCount: 0,
      toolNames: [],
      toolCallCount: 0,
    });
  }

  observe(event: CastleChatEvent) {
    const entry = this.active.get(event.requestId);
    if (!entry) return;
    if (event.type === "context") {
      entry.providerKind = event.provider.kind;
      entry.providerName = event.provider.name;
      entry.model = event.provider.model;
      entry.externalTransmission = event.externalTransmission;
      entry.sourceCount = event.citations.length;
      entry.toolNames = [...event.toolNames];
      entry.toolCallCount = event.toolCallCount;
      return;
    }
    if (event.type === "delta") {
      entry.responseCharacters += Array.from(event.text).length;
      return;
    }
    if (event.type === "complete") {
      entry.citedSourceCount = event.citations.length;
      entry.unsupportedCitationCount = event.unsupportedCitationHandles.length;
      this.finish(entry, "completed");
      return;
    }
    if (event.type === "error") {
      this.finish(entry, "error");
      return;
    }
    if (event.type === "status" && event.status === "cancelled") {
      this.finish(entry, "cancelled");
    }
  }

  failStart(requestId: string) {
    const entry = this.active.get(requestId);
    if (entry) this.finish(entry, "error");
  }

  snapshot(): CastleChatAuditSnapshot {
    const active = Array.from(this.active.values()).map((entry) => ({ ...entry }));
    return {
      persistence: "memory_only",
      retentionLimit: this.retentionLimit,
      activeCount: active.length,
      entries: [...active, ...this.completed].map((entry) => ({ ...entry })),
    };
  }

  clear(): CastleChatAuditSnapshot {
    this.completed.length = 0;
    return this.snapshot();
  }

  private finish(
    entry: CastleChatAuditEntry,
    outcome: Exclude<CastleChatAuditOutcome, "active">,
  ) {
    const finished = this.now();
    const started = Date.parse(entry.startedAt);
    entry.finishedAt = finished.toISOString();
    entry.durationMilliseconds = Math.max(0, finished.getTime() - started);
    entry.outcome = outcome;
    this.active.delete(entry.requestId);
    this.completed.unshift({ ...entry });
    if (this.completed.length > this.retentionLimit) {
      this.completed.length = this.retentionLimit;
    }
  }
}
