import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCreateSourceInput,
  parseCreateFolderInput,
  parseDeleteSourceInput,
  parseDeleteFolderInput,
  parseMoveSourceInput,
  parseRestoreSourceInput,
  parseSaveSourceInput,
  parseSearchRequest,
  parseNoteContextRequest,
  parseOpenLibraryInput,
  parseEntityQuery,
  parseChatCancellation,
  parseChatRequest,
  parseManagedSheetPathInput,
  parseManagedCanvasPathInput,
  parseManagedCanvasWriteInput,
  parseCanvasMediaImportInput,
  parseCanvasMediaPathInput,
} from "../apps/desktop/electron/ipc_contract.ts";
import {
  parseCastleContentDelta,
  parseCastleSourceChange,
} from "../apps/desktop/src/platform/desktop_bridge.ts";

test("accepts only a bounded library path request", () => {
  assert.deepEqual(parseOpenLibraryInput({ path: "/vault/library" }), {
    path: "/vault/library",
  });
  assert.throws(
    () => parseOpenLibraryInput({ path: "/vault/library", shell: true }),
    /invalid library request/,
  );
  assert.throws(() => parseOpenLibraryInput({ path: "" }), /invalid library request/);
});

test("accepts only safe ODS paths relative to library/sheets", () => {
  assert.deepEqual(
    parseManagedSheetPathInput({ relativePath: "planning/roadmap_2026.ods" }),
    { relativePath: "planning/roadmap_2026.ods" },
  );
  assert.throws(
    () => parseManagedSheetPathInput({ relativePath: "../private.ods" }),
    /invalid sheet request/,
  );
  assert.throws(
    () => parseManagedSheetPathInput({ relativePath: "/tmp/private.ods" }),
    /invalid sheet request/,
  );
  assert.throws(
    () => parseManagedSheetPathInput({ relativePath: "notes.txt" }),
    /invalid sheet request/,
  );
});

test("accepts bounded canvas writes and rejects path traversal", () => {
  assert.deepEqual(
    parseManagedCanvasPathInput({ relativePath: "planning/summer.canvas" }),
    { relativePath: "planning/summer.canvas" },
  );
  assert.deepEqual(
    parseManagedCanvasWriteInput({
      relativePath: "summer.canvas",
      source: '{"nodes":[],"edges":[]}',
    }),
    {
      relativePath: "summer.canvas",
      source: '{"nodes":[],"edges":[]}',
    },
  );
  assert.throws(
    () => parseManagedCanvasPathInput({ relativePath: "../private.canvas" }),
    /invalid canvas request/,
  );
  assert.throws(
    () => parseManagedCanvasWriteInput({ relativePath: "notes.md", source: "{}" }),
    /invalid canvas request/,
  );
});

test("accepts supported Canvas media and rejects unsafe asset paths", () => {
  const data = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]).buffer;
  assert.deepEqual(
    parseCanvasMediaImportInput({
      name: "photo.png",
      mimeType: "image/png",
      data,
    }),
    { name: "photo.png", mimeType: "image/png", data },
  );
  assert.deepEqual(
    parseCanvasMediaPathInput({ relativePath: "assets/canvas/photo.pdf" }),
    { relativePath: "assets/canvas/photo.pdf" },
  );
  assert.throws(
    () => parseCanvasMediaImportInput({
      name: "script.svg",
      mimeType: "image/svg+xml",
      data,
    }),
    /unsupported canvas media import/,
  );
  assert.throws(
    () => parseCanvasMediaPathInput({ relativePath: "assets/../private.pdf" }),
    /invalid canvas media request/,
  );
});

test("accepts a bounded source-save request and drops unrelated fields", () => {
  assert.deepEqual(
    parseSaveSourceInput({
      noteId: "notes/example",
      sourceFile: "notes/example.md",
      markdown: "# Example\n",
      expectedRevision: "a".repeat(64),
      ignored: "value",
    }),
    {
      noteId: "notes/example",
      sourceFile: "notes/example.md",
      markdown: "# Example\n",
      expectedRevision: "a".repeat(64),
    },
  );
});

test("validates bounded knowledge queries and rejects unknown fields", () => {
  assert.deepEqual(
    parseSearchRequest({
      query: "Warszawa",
      mode: "hybrid",
      filters: { section: "wiki", tag: "Polska" },
      attachedNoteIds: ["notes/example"],
      limit: 20,
    }),
    {
      query: "Warszawa",
      mode: "hybrid",
      filters: { section: "wiki", tag: "Polska" },
      attachedNoteIds: ["notes/example"],
      limit: 20,
    },
  );
  assert.throws(
    () => parseSearchRequest({ query: "x", rawSql: "DROP TABLE notes" }),
    /invalid search request/,
  );
  assert.throws(
    () => parseSearchRequest({ query: "x", limit: 51 }),
    /invalid search request/,
  );
  assert.deepEqual(
    parseNoteContextRequest({ noteId: "notes/example", startLine: 2, endLine: 4 }),
    { noteId: "notes/example", startLine: 2, endLine: 4 },
  );
  assert.throws(
    () => parseNoteContextRequest({ noteId: "notes/example", maxBytes: 100_000 }),
    /invalid note-context request/,
  );
  assert.deepEqual(parseEntityQuery({ status: "todo", limit: 10 }), {
    status: "todo",
    limit: 10,
  });
  assert.throws(() => parseEntityQuery({ limit: 101 }), /invalid structured query/);
});

test("rejects malformed source-save requests", () => {
  assert.throws(() => parseSaveSourceInput(null), /invalid save request/);
  assert.throws(
    () =>
      parseSaveSourceInput({
        noteId: "notes/example",
        sourceFile: "notes/example.md",
        markdown: "# Example\n",
        expectedRevision: "not-a-revision",
      }),
    /invalid save request/,
  );
  assert.throws(
    () =>
      parseSaveSourceInput({
        noteId: "notes/example",
        sourceFile: "notes/example.md",
        markdown: "x".repeat(8 * 1024 * 1024 + 1),
        expectedRevision: "a".repeat(64),
      }),
    /invalid save request/,
  );
});

test("accepts bounded chat requests and rejects capability-shaped input", () => {
  const request = {
    requestId: "request_12345678",
    question: "What changed in the Castle project?",
    currentNoteId: "project_castle",
    attachedNoteIds: ["task_castle_search"],
    searchLibrary: true,
  };
  assert.deepEqual(parseChatRequest(request), request);
  assert.deepEqual(parseChatCancellation({ requestId: request.requestId }), {
    requestId: request.requestId,
  });
  assert.throws(
    () => parseChatRequest({ ...request, shell: "open library" }),
    /invalid chat request/,
  );
  assert.throws(
    () => parseChatRequest({ ...request, attachedNoteIds: ["../secret"] }),
    /invalid chat request/,
  );
  assert.throws(
    () => parseChatRequest({ ...request, attachedNoteIds: ["same", "same"] }),
    /invalid chat request/,
  );
  assert.throws(
    () => parseChatRequest({ ...request, searchLibrary: undefined }),
    /invalid chat request/,
  );
  assert.throws(
    () => parseChatCancellation({ requestId: "?" }),
    /invalid chat cancellation/,
  );
});

test("accepts bounded source create, move, delete, and restore requests", () => {
  assert.deepEqual(
    parseCreateSourceInput({
      noteId: "task_example",
      sourceFile: "tasks/example.md",
      markdown: "# Example\n",
    }),
    {
      noteId: "task_example",
      sourceFile: "tasks/example.md",
      markdown: "# Example\n",
    },
  );
  assert.deepEqual(
    parseMoveSourceInput({
      noteId: "notes/example",
      sourceFile: "notes/example.md",
      destinationSourceFile: "wiki/example.md",
      expectedRevision: "b".repeat(64),
    }),
    {
      noteId: "notes/example",
      sourceFile: "notes/example.md",
      destinationSourceFile: "wiki/example.md",
      expectedRevision: "b".repeat(64),
    },
  );
  assert.deepEqual(
    parseDeleteSourceInput({
      noteId: "task_example",
      sourceFile: "tasks/example.md",
      expectedRevision: "a".repeat(64),
    }),
    {
      noteId: "task_example",
      sourceFile: "tasks/example.md",
      expectedRevision: "a".repeat(64),
    },
  );
  assert.deepEqual(
    parseRestoreSourceInput({
      noteId: "task_example",
      sourceFile: "tasks/example.md",
      trashId: "1720000000000-42-0/tasks/example.md",
      ignored: "value",
    }),
    {
      noteId: "task_example",
      sourceFile: "tasks/example.md",
      trashId: "1720000000000-42-0/tasks/example.md",
    },
  );
  assert.throws(() => parseCreateSourceInput({}), /invalid create request/);
  assert.throws(() => parseMoveSourceInput({}), /invalid move request/);
  assert.throws(() => parseDeleteSourceInput({}), /invalid delete request/);
  assert.throws(() => parseRestoreSourceInput({}), /invalid restore request/);
});

test("accepts only supported nested Library folders and explicit recursive removal", () => {
  assert.deepEqual(
    parseCreateFolderInput({ sourceDirectory: "notes/project_notes" }),
    { sourceDirectory: "notes/project_notes" },
  );
  assert.deepEqual(
    parseDeleteFolderInput({ sourceDirectory: "notes/project_notes", recursive: true }),
    { sourceDirectory: "notes/project_notes", recursive: true },
  );
  assert.throws(
    () => parseCreateFolderInput({ sourceDirectory: "notes/../private" }),
    /invalid folder create request/,
  );
  assert.throws(
    () => parseDeleteFolderInput({ sourceDirectory: "notes/project_notes" }),
    /invalid folder removal request/,
  );
});

test("validates source-generation change events", () => {
  const change = {
    sourceGeneration: 42,
    operation: "saveSource",
    noteId: "notes/example",
    sourceFile: "notes/example.md",
    revision: "a".repeat(64),
    trashId: "",
  };
  assert.deepEqual(parseCastleSourceChange(change), change);
  assert.deepEqual(parseCastleSourceChange({ ...change, operation: "moveSource" }), {
    ...change,
    operation: "moveSource",
  });
  assert.throws(
    () => parseCastleSourceChange({ ...change, sourceGeneration: 0 }),
    /invalid source-change event/,
  );
  assert.throws(
    () => parseCastleSourceChange({ ...change, operation: "runShell" }),
    /invalid source-change event/,
  );
});

test("validates incremental content publication deltas", () => {
  const entityDelta = { upserted: [], removedIds: [] };
  const delta = {
    contractVersion: 2,
    generatedAt: "2026-08-03T00:00:00.000Z",
    sections: [],
    folders: [],
    notes: entityDelta,
    tasks: { ...entityDelta, orderedIds: ["task_one"] },
    projects: entityDelta,
    calendarEvents: entityDelta,
    shortcutCollections: [],
    mutableResourcePaths: ["/generated/search-index.json"],
  };
  assert.deepEqual(parseCastleContentDelta(delta), delta);
  assert.throws(
    () => parseCastleContentDelta({ ...delta, mutableResourcePaths: [42] }),
    /invalid content-delta event/,
  );
});
