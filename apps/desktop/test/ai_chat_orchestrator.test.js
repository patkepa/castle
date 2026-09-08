import assert from "node:assert/strict";
import test from "node:test";
import { CastleChatOrchestrator } from "../electron/ai/chat_orchestrator.ts";
import { FakeStreamingChatProvider } from "./support/fake_chat_provider.ts";

test("prioritizes explicitly attached notes before bounded search context", async () => {
  const reads = [];
  const gateway = gatewayWithNotes(reads, ["search_one", "search_two"]);
  const provider = new FakeStreamingChatProvider(["Grounded [C1], [C3], not [C99]."]);
  const events = await runChat(
    new CastleChatOrchestrator(gateway, provider),
    request({
      attachedNoteIds: ["attached", "current"],
      currentNoteId: "current",
    }),
  );

  assert.deepEqual(reads.slice(0, 4), ["attached", "current", "search_one", "search_two"]);
  const context = events.find((event) => event.type === "context");
  assert.deepEqual(context.citations.map((citation) => citation.noteId), [
    "attached",
    "current",
    "search_one",
    "search_two",
  ]);
  assert.equal(context.externalTransmission, false);
  assert.deepEqual(context.toolNames, ["read_note", "search_knowledge"]);
  assert.equal(context.toolCallCount, 5);
  const complete = events.at(-1);
  assert.equal(complete.type, "complete");
  assert.deepEqual(complete.citations.map((citation) => citation.handle), ["C1", "C3"]);
  assert.deepEqual(complete.unsupportedCitationHandles, ["C99"]);
});

test("caps retrieved sources and context before invoking a provider", async () => {
  const reads = [];
  const gateway = gatewayWithNotes(
    reads,
    Array.from({ length: 20 }, (_, index) => `search_${index}`),
    8_192,
  );
  let providedSources = [];
  const provider = {
    metadata: { kind: "local", name: "capture", model: "capture-v1" },
    async *stream(input) {
      providedSources = input.sources;
      yield "Bounded.";
    },
  };
  const attachedNoteIds = Array.from({ length: 10 }, (_, index) => `attached_${index}`);
  await runChat(
    new CastleChatOrchestrator(gateway, provider),
    request({ attachedNoteIds }),
  );

  assert.equal(providedSources.length, 4);
  assert.equal(
    providedSources.reduce((total, source) => total + source.text.length, 0),
    32_000,
  );
  assert.deepEqual(reads, attachedNoteIds.slice(0, 4));
});

test("does not exceed the context budget for the final searched excerpt", async () => {
  const requestedBytes = [];
  let providedSources = [];
  const gateway = {
    async search(input) {
      return {
        query: input.query,
        requestedMode: "hybrid",
        modeUsed: "lexical",
        semanticAvailable: false,
        degradedReasons: ["embeddings_unavailable"],
        generation: "generation_test",
        sourceFingerprint: "fingerprint_test",
        results: [searchResult("search_one")],
      };
    },
    async readNote(input) {
      requestedBytes.push(input.maxBytes);
      const length = input.noteId === "four"
        ? Math.min(input.maxBytes, 7_124)
        : input.maxBytes;
      return noteContext(input.noteId, length);
    },
  };
  const provider = {
    metadata: { kind: "local", name: "capture", model: "capture-v1" },
    async *stream(input) {
      providedSources = input.sources;
      yield "Bounded.";
    },
  };
  await runChat(
    new CastleChatOrchestrator(gateway, provider),
    request({ attachedNoteIds: ["one", "two", "three", "four"] }),
  );

  assert.deepEqual(requestedBytes, [8_192, 8_192, 8_192, 7_424, 300]);
  assert.equal(
    providedSources.reduce((total, source) => total + source.text.length, 0),
    32_000,
  );
});

test("does not search the library unless the request explicitly enables it", async () => {
  const reads = [];
  const gateway = {
    async search() {
      throw new Error("library search must stay disabled");
    },
    async readNote(input) {
      reads.push(input.noteId);
      return noteContext(input.noteId, 80);
    },
  };
  const events = await runChat(
    new CastleChatOrchestrator(
      gateway,
      new FakeStreamingChatProvider(["Attached [C1]."]),
    ),
    request({ attachedNoteIds: ["attached"], searchLibrary: false }),
  );

  assert.deepEqual(reads, ["attached"]);
  const context = events.find((event) => event.type === "context");
  assert.deepEqual(context.toolNames, ["read_note"]);
  assert.equal(context.toolCallCount, 1);
});

test("sends no files for a greeting when no context scope is selected", async () => {
  let providedSources = null;
  const gateway = {
    async search() {
      throw new Error("library search must stay disabled");
    },
    async readNote() {
      throw new Error("the open note must not be attached implicitly");
    },
  };
  const provider = {
    metadata: { kind: "local", name: "capture", model: "capture-v1" },
    async *stream(input) {
      providedSources = input.sources;
      yield "Hi!";
    },
  };
  const events = await runChat(
    new CastleChatOrchestrator(gateway, provider),
    request({
      question: "hi",
      currentNoteId: "currently_open",
      searchLibrary: false,
    }),
  );

  assert.deepEqual(providedSources, []);
  const context = events.find((event) => event.type === "context");
  assert.deepEqual(context.citations, []);
  assert.deepEqual(context.toolNames, []);
  assert.equal(context.toolCallCount, 0);
});

test("emits cancellation without completing a streaming request", async () => {
  const gateway = gatewayWithNotes([], ["search_one"]);
  const provider = {
    metadata: { kind: "local", name: "slow", model: "slow-v1" },
    async *stream(input) {
      yield "First";
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (input.signal.aborted) throw new DOMException("cancelled", "AbortError");
      yield "Second";
    },
  };
  const orchestrator = new CastleChatOrchestrator(gateway, provider);
  const events = await new Promise((resolve, reject) => {
    const collected = [];
    const timeout = setTimeout(() => reject(new Error("chat did not cancel")), 1_000);
    orchestrator.start(request(), (event) => {
      collected.push(event);
      if (event.type === "delta") orchestrator.cancel(event.requestId);
      if (event.type === "status" && event.status === "cancelled") {
        clearTimeout(timeout);
        resolve(collected);
      }
    });
  });

  assert.equal(events.filter((event) => event.type === "delta").length, 1);
  assert.equal(events.some((event) => event.type === "complete"), false);
});

test("blocks an external provider before transmitting unapproved context", async () => {
  const reads = [];
  const gateway = gatewayWithNotes(reads, ["search_one"]);
  let providerCalled = false;
  const provider = {
    metadata: { kind: "external", name: "remote", model: "remote-v1" },
    async *stream() {
      providerCalled = true;
      yield "This must not run.";
    },
  };
  const events = await runChat(new CastleChatOrchestrator(gateway, provider), request());

  assert.equal(providerCalled, false);
  assert.deepEqual(reads, []);
  assert.equal(
    events.some(
      (event) => event.type === "context" && event.externalTransmission,
    ),
    false,
  );
  assert.equal(events.some((event) => event.type === "status" && event.status === "awaiting_approval"), true);
  assert.equal(events.at(-1).status, "cancelled");
  assert.match(events.at(-1).message, /wasn’t sent/u);
});

test("asks for approval before retrieval and then invokes the external provider", async () => {
  const reads = [];
  const gateway = gatewayWithNotes(reads, ["search_one"]);
  let providerCalled = false;
  let preview;
  const provider = {
    metadata: { kind: "external", name: "Codex", model: "default" },
    async *stream() {
      providerCalled = true;
      yield "Supported [C1].";
    },
  };
  const events = await runChat(
    new CastleChatOrchestrator(gateway, provider, async (value) => {
      assert.deepEqual(reads, []);
      preview = value;
      return true;
    }),
    request(),
  );

  assert.equal(providerCalled, true);
  assert.equal(preview.provider.name, "Codex");
  assert.equal(preview.maximumSources, 8);
  assert.equal(preview.maximumContextCharacters, 32_000);
  assert.equal(preview.request.searchLibrary, true);
  assert.equal(
    events.some(
      (event) => event.type === "context" && event.externalTransmission,
    ),
    true,
  );
  assert.equal(events.at(-1).type, "complete");
});

test("times out a stalled provider and emits a recoverable error", async () => {
  const gateway = gatewayWithNotes([], ["search_one"]);
  const provider = {
    metadata: { kind: "local", name: "stalled", model: "stalled-v1" },
    async *stream() {
      await new Promise(() => {});
      yield "unreachable";
    },
  };
  const events = await runChat(
    new CastleChatOrchestrator(gateway, provider, undefined, {
      providerChunkTimeoutMilliseconds: 10,
    }),
    request(),
  );

  assert.equal(events.at(-1).type, "error");
  assert.match(events.at(-1).message, /provider timed out/);
  assert.equal(events.at(-1).recoverable, true);
});

function request(overrides = {}) {
  return {
    requestId: `request_${Math.random().toString(36).slice(2)}`,
    question: "What is relevant?",
    attachedNoteIds: [],
    searchLibrary: true,
    ...overrides,
  };
}

function gatewayWithNotes(reads, searchNoteIds, noteLength = 80) {
  return {
    async search(input) {
      assert.equal(input.mode, "hybrid");
      return {
        query: input.query,
        requestedMode: "hybrid",
        modeUsed: "lexical",
        semanticAvailable: false,
        degradedReasons: ["embeddings_unavailable"],
        generation: "generation_test",
        sourceFingerprint: "fingerprint_test",
        results: searchNoteIds.map(searchResult),
      };
    },
    async readNote(input) {
      reads.push(input.noteId);
      return noteContext(input.noteId, Math.min(noteLength, input.maxBytes));
    },
  };
}

function searchResult(noteId) {
  return {
    noteId,
    recordId: null,
    title: `Title ${noteId}`,
    route: `/notes/${noteId}`,
    sourceFile: `notes/${noteId}.md`,
    headingPath: "",
    startLine: 1,
    endLine: 4,
    excerpt: "excerpt",
    lexicalScore: 1,
    semanticScore: null,
    structuredScore: 0,
    finalScore: 1,
    explanationCodes: ["lexical_match"],
    sourceRevision: "revision",
    indexGeneration: "generation_test",
  };
}

function noteContext(noteId, length) {
  return {
    noteId,
    title: `Title ${noteId}`,
    route: `/notes/${noteId}`,
    sourceFile: `notes/${noteId}.md`,
    startLine: 1,
    endLine: 4,
    markdown: "x".repeat(length),
    truncated: false,
    sourceRevision: "revision",
    indexGeneration: "generation_test",
  };
}

function runChat(orchestrator, chatRequest) {
  return new Promise((resolve, reject) => {
    const events = [];
    const timeout = setTimeout(() => reject(new Error("chat did not finish")), 1_000);
    orchestrator.start(chatRequest, (event) => {
      events.push(event);
      if (
        event.type === "complete" ||
        event.type === "error" ||
        (event.type === "status" && event.status === "cancelled")
      ) {
        clearTimeout(timeout);
        resolve(events);
      }
    });
  });
}
