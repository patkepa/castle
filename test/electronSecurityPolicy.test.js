import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  assertTrustedIpcSenderUrl,
  canvasPreviewPartition,
  castleContentSecurityPolicy,
  configureCanvasPreviewWebPreferences,
  isAllowedCanvasPreviewUrl,
  isAllowedExternalUrl,
  isTrustedRendererUrl,
  packagedAssetCacheControl,
  resolveCastleAssetPath,
  resolvePackagedFilePath,
} from "../apps/desktop/electron/security_policy.ts";

test("allows only the Castle renderer and the exact development origin", () => {
  assert.equal(isTrustedRendererUrl("castle://app/note/example"), true);
  assert.equal(isTrustedRendererUrl("castle://other/note/example"), false);
  assert.equal(
    isTrustedRendererUrl(
      "http://127.0.0.1:5173/note/example",
      "http://127.0.0.1:5173",
    ),
    true,
  );
  assert.equal(
    isTrustedRendererUrl(
      "http://127.0.0.1:5174/note/example",
      "http://127.0.0.1:5173",
    ),
    false,
  );
});

test("rejects IPC sender URLs outside the trusted renderer", () => {
  assert.doesNotThrow(() => assertTrustedIpcSenderUrl("castle://app/note/test"));
  assert.throws(
    () => assertTrustedIpcSenderUrl("https://attacker.example"),
    /untrusted renderer/,
  );
  assert.throws(() => assertTrustedIpcSenderUrl(undefined), /untrusted renderer/);
});

test("permits safe external destinations and rejects privileged schemes", () => {
  assert.equal(isAllowedExternalUrl("https://example.com"), true);
  assert.equal(isAllowedExternalUrl("mailto:hello@example.com"), true);
  assert.equal(isAllowedExternalUrl("http://example.com"), false);
  assert.equal(isAllowedExternalUrl("file:///private/example"), false);
  assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
});

test("allows isolated HTTP web previews and rejects privileged guest pages", () => {
  assert.equal(isAllowedCanvasPreviewUrl("https://example.com"), true);
  assert.equal(isAllowedCanvasPreviewUrl("http://localhost:4173"), true);
  assert.equal(isAllowedCanvasPreviewUrl("file:///private/example"), false);
  assert.equal(isAllowedCanvasPreviewUrl("javascript:alert(1)"), false);

  const preferences = {
    preload: "/tmp/untrusted-preload.cjs",
    nodeIntegration: true,
    sandbox: false,
    webSecurity: false,
  };
  assert.equal(
    configureCanvasPreviewWebPreferences(preferences, {
      partition: canvasPreviewPartition,
      src: "https://example.com",
    }),
    true,
  );
  assert.equal("preload" in preferences, false);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.webSecurity, true);
  assert.equal(
    configureCanvasPreviewWebPreferences({}, {
      partition: "persist:untrusted",
      src: "https://example.com",
    }),
    false,
  );
});

test("contains custom-protocol assets within the packaged renderer", () => {
  const rendererRoot = path.resolve("/application/renderer");
  assert.deepEqual(
    resolveCastleAssetPath(rendererRoot, "castle://app/assets/index.js"),
    {
      candidate: path.join(rendererRoot, "assets", "index.js"),
      hasExtension: true,
    },
  );
  assert.equal(
    resolveCastleAssetPath(rendererRoot, "castle://other/assets/index.js"),
    null,
  );
  assert.equal(
    resolveCastleAssetPath(
      rendererRoot,
      "castle://app/%2E%2E%2Fprivate%2Fsecret.txt",
    ),
    null,
  );
});

test("defines a restrictive packaged-renderer content security policy", () => {
  assert.match(castleContentSecurityPolicy, /default-src 'self'/);
  assert.match(castleContentSecurityPolicy, /object-src 'none'/);
  assert.match(castleContentSecurityPolicy, /script-src 'self'/);
  assert.match(
    castleContentSecurityPolicy,
    /script-src 'self' https:\/\/www\.youtube\.com/,
  );
  assert.match(castleContentSecurityPolicy, /media-src 'self' blob: https: http:/);
  assert.match(castleContentSecurityPolicy, /frame-src https: http:/);
  assert.doesNotMatch(castleContentSecurityPolicy, /unsafe-eval/);
});

test("prefers selected-library content without shadowing renderer chunks", () => {
  const rendererRoot = path.resolve("/application/renderer");
  const contentRoot = path.resolve("/application/content");
  const availableFiles = new Set([
    path.join(rendererRoot, "index.html"),
    path.join(rendererRoot, "assets", "index.js"),
    path.join(contentRoot, "assets", "avatar.png"),
    path.join(contentRoot, "generated", "catalog.json"),
  ]);
  const fileExists = (filePath) => availableFiles.has(filePath);

  assert.equal(
    resolvePackagedFilePath({
      contentRoot,
      fileExists,
      rendererRoot,
      requestUrl: "castle://app/generated/catalog.json",
    }),
    path.join(contentRoot, "generated", "catalog.json"),
  );
  assert.equal(
    resolvePackagedFilePath({
      contentRoot,
      fileExists,
      rendererRoot,
      requestUrl: "castle://app/assets/avatar.png",
    }),
    path.join(contentRoot, "assets", "avatar.png"),
  );
  assert.equal(
    resolvePackagedFilePath({
      contentRoot,
      fileExists,
      rendererRoot,
      requestUrl: "castle://app/assets/index.js",
    }),
    path.join(rendererRoot, "assets", "index.js"),
  );
  assert.equal(
    resolvePackagedFilePath({
      contentRoot,
      fileExists,
      rendererRoot,
      requestUrl: "castle://app/note/example",
    }),
    path.join(rendererRoot, "index.html"),
  );
});

test("caches only content-addressed packaged resources immutably", () => {
  const rendererRoot = path.resolve("/application/renderer");
  const contentRoot = path.resolve("/application/content");
  assert.equal(
    packagedAssetCacheControl({
      contentRoot,
      filePath: path.join(rendererRoot, "app-assets", "index-abc123.js"),
      rendererRoot,
    }),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    packagedAssetCacheControl({
      contentRoot,
      filePath: path.join(
        contentRoot,
        "generated",
        "avatars",
        `${"b".repeat(64)}.webp`,
      ),
      rendererRoot,
    }),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    packagedAssetCacheControl({
      contentRoot,
      filePath: path.join(
        contentRoot,
        "generated",
        "notes",
        `${"a".repeat(64)}.json`,
      ),
      rendererRoot,
    }),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    packagedAssetCacheControl({
      contentRoot,
      filePath: path.join(contentRoot, "generated", "catalog.json"),
      rendererRoot,
    }),
    "no-cache",
  );
});
