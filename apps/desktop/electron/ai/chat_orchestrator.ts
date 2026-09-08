import type {
  CastleChatCitation,
  CastleChatEvent,
  CastleChatRequest,
} from "../../src/platform/ai_chat";
import type {
  CastleNoteContext,
  CastleSearchResponse,
} from "../../src/platform/knowledge_queries";
import type { ChatContextSource, ChatProvider } from "./chat_provider";
import type { ExternalRequestAuthorizer } from "./privacy_policy";

export interface CastleChatLimits {
  maximumQuestionCharacters: number;
  maximumAttachedNotes: number;
  maximumSources: number;
  maximumContextCharacters: number;
  maximumToolRounds: number;
  retrievalTimeoutMilliseconds: number;
  providerChunkTimeoutMilliseconds: number;
}

export const defaultCastleChatLimits: Readonly<CastleChatLimits> = Object.freeze({
  maximumQuestionCharacters: 8_000,
  maximumAttachedNotes: 10,
  maximumSources: 8,
  maximumContextCharacters: 32_000,
  maximumToolRounds: 12,
  retrievalTimeoutMilliseconds: 2_000,
  providerChunkTimeoutMilliseconds: 30_000,
});

export interface CastleChatKnowledgeGateway {
  search(request: {
    query: string;
    mode: "hybrid";
    currentNoteId?: string;
    attachedNoteIds: string[];
    limit: number;
  }): Promise<CastleSearchResponse>;
  readNote(request: {
    noteId: string;
    startLine?: number;
    endLine?: number;
    maxBytes: number;
  }): Promise<CastleNoteContext>;
}

export class CastleChatOrchestrator {
  private readonly active = new Map<string, AbortController>();
  private readonly limits: CastleChatLimits;

  constructor(
    private readonly knowledge: CastleChatKnowledgeGateway,
    private readonly provider: ChatProvider,
    private readonly authorizeExternalRequest?: ExternalRequestAuthorizer,
    limits: Partial<CastleChatLimits> = {},
  ) {
    this.limits = { ...defaultCastleChatLimits, ...limits };
    validateLimits(this.limits);
  }

  start(request: CastleChatRequest, emit: (event: CastleChatEvent) => void) {
    validateRequest(request, this.limits);
    if (this.active.has(request.requestId)) {
      throw new Error("Castle rejected a duplicate chat request ID.");
    }
    const controller = new AbortController();
    this.active.set(request.requestId, controller);
    void this.run(request, controller, emit).finally(() => {
      this.active.delete(request.requestId);
    });
  }

  cancel(requestId: string) {
    this.active.get(requestId)?.abort();
  }

  cancelAll() {
    for (const controller of this.active.values()) controller.abort();
  }

  private async run(
    request: CastleChatRequest,
    controller: AbortController,
    emit: (event: CastleChatEvent) => void,
  ) {
    try {
      if (this.provider.metadata.kind === "external") {
        emit({
          type: "status",
          requestId: request.requestId,
          status: "awaiting_approval",
          message: "Waiting for approval before anything leaves this device…",
        });
        const approved = await this.authorizeExternalRequest?.({
          request,
          provider: {
            ...this.provider.metadata,
            kind: "external" as const,
          },
          maximumSources: this.limits.maximumSources,
          maximumContextCharacters: this.limits.maximumContextCharacters,
        });
        if (!approved) {
          emit({
            type: "status",
            requestId: request.requestId,
            status: "cancelled",
            message: "Request wasn’t sent.",
          });
          return;
        }
      }
      emit({
        type: "status",
        requestId: request.requestId,
        status: "retrieving",
        message: request.searchLibrary || request.attachedNoteIds.length > 0
          ? "Preparing the Castle context you selected…"
          : "Preparing your message…",
      });
      const retrieval = await this.retrieve(request, controller.signal);
      const { contexts } = retrieval;
      const citations = contexts.map((context, index) =>
        citationFromContext(context, index),
      );
      emit({
        type: "context",
        requestId: request.requestId,
        provider: this.provider.metadata,
        externalTransmission: this.provider.metadata.kind === "external",
        citations,
        toolNames: retrieval.toolNames,
        toolCallCount: retrieval.toolCallCount,
      });
      emit({
        type: "status",
        requestId: request.requestId,
        status: "generating",
        message: contexts.length === 0
          ? "Answering without Castle files…"
          : `Answering with ${contexts.length} selected source${contexts.length === 1 ? "" : "s"}…`,
      });
      let response = "";
      const sources: ChatContextSource[] = contexts.map((context, index) => ({
        handle: `C${index + 1}`,
        title: context.title,
        text: context.markdown,
      }));
      const stream = this.provider.stream({
        question: request.question,
        sources,
        signal: controller.signal,
      })[Symbol.asyncIterator]();
      while (true) {
        const next = await withTimeout(
          stream.next(),
          this.limits.providerChunkTimeoutMilliseconds,
          controller,
          "Castle chat provider timed out.",
        );
        if (next.done) break;
        if (controller.signal.aborted) throw abortError();
        response += next.value;
        emit({ type: "delta", requestId: request.requestId, text: next.value });
      }
      const referencedHandles = Array.from(
        response.matchAll(/\[(C\d+)\]/gu),
        (match) => match[1],
      );
      const validHandles = new Set(citations.map((citation) => citation.handle));
      const unsupportedCitationHandles = Array.from(
        new Set(referencedHandles.filter((handle) => !validHandles.has(handle))),
      );
      emit({
        type: "complete",
        requestId: request.requestId,
        citations: citations.filter((citation) =>
          referencedHandles.includes(citation.handle),
        ),
        unsupportedCitationHandles,
      });
    } catch (reason) {
      if (isTimeoutError(reason)) {
        emit({
          type: "error",
          requestId: request.requestId,
          message: reason.message,
          recoverable: true,
        });
        return;
      }
      if (controller.signal.aborted || isAbortError(reason)) {
        emit({
          type: "status",
          requestId: request.requestId,
          status: "cancelled",
          message: "Castle chat was cancelled.",
        });
        return;
      }
      emit({
        type: "error",
        requestId: request.requestId,
        message: reason instanceof Error ? reason.message : String(reason),
        recoverable: true,
      });
    }
  }

  private async retrieve(request: CastleChatRequest, signal: AbortSignal) {
    const contexts: CastleNoteContext[] = [];
    const seen = new Set<string>();
    let characters = 0;
    let toolRounds = 0;
    const toolNames = new Set<"search_knowledge" | "read_note">();
    const explicitIds = [...request.attachedNoteIds];
    for (const noteId of explicitIds) {
      if (
        contexts.length >= this.limits.maximumSources ||
        characters >= this.limits.maximumContextCharacters
      ) break;
      checkCancellation(signal);
      toolRounds += 1;
      if (toolRounds > this.limits.maximumToolRounds) break;
      toolNames.add("read_note");
      const remaining = this.limits.maximumContextCharacters - characters;
      const context = await withTimeout(
        this.knowledge.readNote({
          noteId,
          maxBytes: Math.min(8_192, remaining),
        }),
        this.limits.retrievalTimeoutMilliseconds,
        undefined,
        "Castle note retrieval timed out.",
      );
      seen.add(context.noteId);
      characters += context.markdown.length;
      contexts.push(context);
    }

    if (
      !request.searchLibrary ||
      contexts.length >= this.limits.maximumSources ||
      characters >= this.limits.maximumContextCharacters ||
      toolRounds >= this.limits.maximumToolRounds
    ) {
      return {
        contexts,
        toolNames: Array.from(toolNames),
        toolCallCount: toolRounds,
      };
    }
    checkCancellation(signal);
    const search = await withTimeout(this.knowledge.search({
      query: request.question,
      mode: "hybrid",
      currentNoteId: request.currentNoteId,
      attachedNoteIds: request.attachedNoteIds,
      limit: this.limits.maximumSources * 2,
    }), this.limits.retrievalTimeoutMilliseconds, undefined, "Castle knowledge search timed out.");
    toolRounds += 1;
    toolNames.add("search_knowledge");
    for (const result of search.results) {
      if (
        contexts.length >= this.limits.maximumSources ||
        characters >= this.limits.maximumContextCharacters ||
        toolRounds >= this.limits.maximumToolRounds
      ) {
        break;
      }
      if (seen.has(result.noteId)) continue;
      checkCancellation(signal);
      toolRounds += 1;
      toolNames.add("read_note");
      const remaining = Math.max(
        1,
        this.limits.maximumContextCharacters - characters,
      );
      const context = await withTimeout(
        this.knowledge.readNote({
          noteId: result.noteId,
          startLine: result.startLine,
          endLine: result.endLine,
          maxBytes: Math.min(4_096, remaining),
        }),
        this.limits.retrievalTimeoutMilliseconds,
        undefined,
        "Castle note retrieval timed out.",
      );
      seen.add(context.noteId);
      characters += context.markdown.length;
      contexts.push(context);
    }
    return {
      contexts,
      toolNames: Array.from(toolNames),
      toolCallCount: toolRounds,
    };
  }
}

function citationFromContext(
  context: CastleNoteContext,
  index: number,
): CastleChatCitation {
  return {
    handle: `C${index + 1}`,
    noteId: context.noteId,
    title: context.title,
    route: context.route,
    sourceFile: context.sourceFile,
    startLine: context.startLine,
    endLine: context.endLine,
    sourceRevision: context.sourceRevision,
  };
}

function validateRequest(request: CastleChatRequest, limits: CastleChatLimits) {
  if (
    !request.requestId ||
    request.requestId.length > 128 ||
    !request.question.trim() ||
    Array.from(request.question).length > limits.maximumQuestionCharacters ||
    typeof request.searchLibrary !== "boolean" ||
    request.attachedNoteIds.length > limits.maximumAttachedNotes ||
    request.attachedNoteIds.some((noteId) => !validNoteId(noteId)) ||
    (request.currentNoteId !== undefined && !validNoteId(request.currentNoteId))
  ) {
    throw new Error("Castle rejected an invalid chat request.");
  }
}

function validateLimits(limits: CastleChatLimits) {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error("Castle chat limits must be positive safe integers.");
    }
  }
}

function validNoteId(value: string) {
  return value.length > 0 && value.length <= 512 && !value.includes("..") && !value.includes("\0");
}

function checkCancellation(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}

function abortError() {
  return new DOMException("Castle chat was cancelled.", "AbortError");
}

function isAbortError(reason: unknown) {
  return reason instanceof DOMException && reason.name === "AbortError";
}

function isTimeoutError(reason: unknown): reason is Error {
  return reason instanceof Error && reason.name === "TimeoutError";
}

function withTimeout<T>(
  operation: Promise<T>,
  milliseconds: number,
  controller: AbortController | undefined,
  message: string,
) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const error = new Error(message);
      error.name = "TimeoutError";
      controller?.abort();
      reject(error);
    }, milliseconds);
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (reason: unknown) => {
        clearTimeout(timeout);
        reject(reason);
      },
    );
  });
}
