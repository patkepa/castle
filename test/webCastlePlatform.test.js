import assert from "node:assert/strict";
import test from "node:test";
import { webCastlePlatform } from "../apps/desktop/src/platform/web_castle_platform.ts";
import {
  loadDesktopCastlePlatform,
  resolveCastlePlatform,
} from "../apps/desktop/src/platform/runtime_castle_platform.ts";
import {
  parseCastleContentServiceStatus,
  parseCastleLibrarySelectionResult,
} from "../apps/desktop/src/platform/desktop_bridge.ts";

test("the web Castle platform cannot mutate library content", () => {
  assert.equal(webCastlePlatform.runtime, "web");
  assert.equal(webCastlePlatform.contentMutations, null);
  assert.deepEqual(webCastlePlatform.capabilities, {
    editContent: false,
    createContent: false,
    moveContent: false,
    deleteContent: false,
  });
});

test("web capabilities cannot be changed at runtime", () => {
  assert.equal(Object.isFrozen(webCastlePlatform), true);
  assert.equal(Object.isFrozen(webCastlePlatform.capabilities), true);
  assert.equal(
    Reflect.set(webCastlePlatform.capabilities, "editContent", true),
    false,
  );
  assert.equal(webCastlePlatform.capabilities.editContent, false);
});

test("desktop operations stay unavailable until the main process enables them", async () => {
  assert.equal(resolveCastlePlatform(), webCastlePlatform);
  const sourceDocument = {
    noteId: "notes/example",
    sourceFile: "notes/example.md",
    markdown: "# Example\n",
    revision: "a".repeat(64),
  };
  const bridge = {
    runtime: "desktop",
    operatingSystem: "darwin",
    getFullScreenState: async () => false,
    onFullScreenStateChange: () => () => {},
    onContentServiceStatusChange: () => () => {},
    getInfo: async () => ({
      runtime: "desktop",
      operatingSystem: "darwin",
      library: {
        name: "Castle",
        path: "/vault/library",
        available: true,
        active: true,
      },
      libraries: [
        {
          name: "Castle",
          path: "/vault/library",
          available: true,
          active: true,
        },
      ],
      capabilities: {
        editContent: true,
        createContent: true,
        moveContent: true,
        deleteContent: true,
      },
      contentServiceStatus: {
        state: "ready",
        message: "Castle content is current.",
        generatedAt: "2026-08-02T00:00:00.000Z",
      },
    }),
    chooseLibrary: async () => ({ status: "cancelled" }),
    openLibrary: async () => ({ status: "cancelled" }),
    resolveVideoPoster: async () => "https://cdn.example.com/poster.jpg",
    readSource: async () => sourceDocument,
    saveSource: async () => ({
      noteId: sourceDocument.noteId,
      sourceFile: sourceDocument.sourceFile,
      revision: "b".repeat(64),
      generatedAt: "2026-08-02T00:00:00.000Z",
    }),
    createSource: async () => ({
      noteId: "task_created",
      sourceFile: "tasks/created.md",
      revision: "c".repeat(64),
      generatedAt: "2026-08-02T00:00:00.000Z",
    }),
    moveSource: async () => ({
      noteId: sourceDocument.noteId,
      previousSourceFile: sourceDocument.sourceFile,
      sourceFile: "wiki/example.md",
      route: "/note/wiki/example",
      revision: "e".repeat(64),
      generatedAt: "2026-08-02T00:00:00.000Z",
    }),
    deleteSource: async () => ({
      noteId: sourceDocument.noteId,
      sourceFile: sourceDocument.sourceFile,
      generatedAt: "2026-08-02T00:00:00.000Z",
      trashId: "1720000000000-42-0/notes/example.md",
    }),
    restoreSource: async () => ({
      noteId: sourceDocument.noteId,
      sourceFile: sourceDocument.sourceFile,
      revision: "d".repeat(64),
      generatedAt: "2026-08-02T00:00:00.000Z",
    }),
    retryContentService: async () => ({
      state: "ready",
      message: "Castle content is current.",
      generatedAt: "2026-08-02T00:00:00.000Z",
    }),
    restartApp: async () => {},
  };
  const unavailablePlatform = resolveCastlePlatform(bridge);

  assert.equal(unavailablePlatform.runtime, "desktop");
  assert.equal(unavailablePlatform.capabilities.editContent, false);
  assert.equal(unavailablePlatform.contentMutations, null);

  const desktopPlatform = await loadDesktopCastlePlatform(bridge);

  assert.equal(desktopPlatform.runtime, "desktop");
  assert.equal(desktopPlatform.capabilities.editContent, true);
  assert.equal(desktopPlatform.capabilities.createContent, true);
  assert.equal(desktopPlatform.capabilities.moveContent, true);
  assert.equal(desktopPlatform.capabilities.deleteContent, true);
  assert.equal(
    await desktopPlatform.mediaPreviews.resolveVideoPoster(
      "https://video.example.com/watch/123",
    ),
    "https://cdn.example.com/poster.jpg",
  );
  assert.ok(desktopPlatform.contentMutations);
  assert.equal(
    await desktopPlatform.contentMutations.readSource(sourceDocument.noteId),
    sourceDocument,
  );
  assert.equal(
    (
      await desktopPlatform.contentMutations.restoreSource({
        noteId: sourceDocument.noteId,
        sourceFile: sourceDocument.sourceFile,
        trashId: "1720000000000-42-0/notes/example.md",
      })
    ).revision,
    "d".repeat(64),
  );
});

test("validates desktop content-service status events", () => {
  assert.deepEqual(
    parseCastleContentServiceStatus({
      state: "stale",
      message: "Invalid task frontmatter",
      generatedAt: "2026-08-02T00:00:00.000Z",
      ignored: true,
    }),
    {
      state: "stale",
      message: "Invalid task frontmatter",
      generatedAt: "2026-08-02T00:00:00.000Z",
    },
  );
  assert.throws(
    () => parseCastleContentServiceStatus({ state: "broken" }),
    /invalid content-service status/,
  );
});

test("validates desktop library-selection results", () => {
  assert.deepEqual(parseCastleLibrarySelectionResult({ status: "cancelled" }), {
    status: "cancelled",
  });
  assert.deepEqual(
    parseCastleLibrarySelectionResult({
      status: "selected",
      library: {
        name: "Journal",
        path: "/vault/journal/library",
        available: true,
        active: true,
      },
    }),
    {
      status: "selected",
      library: {
        name: "Journal",
        path: "/vault/journal/library",
        available: true,
        active: true,
      },
    },
  );
  assert.throws(
    () => parseCastleLibrarySelectionResult({ status: "selected" }),
    /invalid library-selection result/,
  );
});
