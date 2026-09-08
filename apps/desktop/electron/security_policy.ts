import path from "node:path";
import type { WebPreferences } from "electron";

export const canvasPreviewPartition = "castle-canvas-previews";

export const castleContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' https://www.youtube.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https:",
  "media-src 'self' blob: https: http:",
  "frame-src https: http:",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function isAllowedExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function isAllowedCanvasPreviewUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function configureCanvasPreviewWebPreferences(
  webPreferences: WebPreferences,
  params: Record<string, string>,
) {
  if (
    params.partition !== canvasPreviewPartition ||
    !isAllowedCanvasPreviewUrl(params.src)
  ) {
    return false;
  }

  delete webPreferences.preload;
  webPreferences.allowRunningInsecureContent = false;
  webPreferences.contextIsolation = true;
  webPreferences.devTools = false;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  return true;
}

export function isTrustedRendererUrl(value: string, developmentUrl?: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "castle:" && url.host === "app") return true;
    if (!developmentUrl) return false;

    const developmentOrigin = new URL(developmentUrl).origin;
    return url.origin === developmentOrigin;
  } catch {
    return false;
  }
}

export function assertTrustedIpcSenderUrl(
  value: string | undefined,
  developmentUrl?: string,
) {
  if (!value || !isTrustedRendererUrl(value, developmentUrl)) {
    throw new Error("Castle rejected an IPC request from an untrusted renderer.");
  }
}

export function resolveCastleAssetPath(rendererRoot: string, requestUrl: string) {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "castle:" || url.host !== "app") return null;

  let requestPath: string;
  try {
    requestPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }

  const candidate = path.resolve(rendererRoot, requestPath || "index.html");
  const relative = path.relative(rendererRoot, candidate);
  const contained =
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);

  if (!contained) return null;
  return {
    candidate,
    hasExtension: path.extname(requestPath) !== "",
  };
}

export function resolvePackagedFilePath({
  contentRoot,
  fileExists,
  rendererRoot,
  requestUrl,
}: {
  contentRoot: string;
  fileExists: (filePath: string) => boolean;
  rendererRoot: string;
  requestUrl: string;
}) {
  let pathname: string;
  try {
    pathname = new URL(requestUrl).pathname;
  } catch {
    return null;
  }

  const isGeneratedContent = pathname.startsWith("/generated/");
  const isNoteAsset =
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/content-assets/");

  if (isGeneratedContent || isNoteAsset) {
    const contentAsset = resolveCastleAssetPath(contentRoot, requestUrl);
    if (contentAsset && fileExists(contentAsset.candidate)) {
      return contentAsset.candidate;
    }
    if (isGeneratedContent || pathname.startsWith("/content-assets/")) {
      return null;
    }
  }

  const rendererAsset = resolveCastleAssetPath(rendererRoot, requestUrl);
  if (!rendererAsset) return null;
  if (fileExists(rendererAsset.candidate)) return rendererAsset.candidate;
  if (rendererAsset.hasExtension) return null;

  const indexPath = path.join(rendererRoot, "index.html");
  return fileExists(indexPath) ? indexPath : null;
}

export function packagedAssetCacheControl({
  contentRoot,
  filePath,
  rendererRoot,
}: {
  contentRoot: string;
  filePath: string;
  rendererRoot: string;
}) {
  const rendererRelative = containedRelativePath(rendererRoot, filePath);
  if (rendererRelative?.startsWith("app-assets/")) {
    return "public, max-age=31536000, immutable";
  }

  const contentRelative = containedRelativePath(contentRoot, filePath);
  if (
    contentRelative &&
    /^generated\/(?:notes\/[a-f0-9]{64}\.json|avatars\/[a-f0-9]{64}\.webp)$/.test(
      contentRelative,
    )
  ) {
    return "public, max-age=31536000, immutable";
  }
  return "no-cache";
}

function containedRelativePath(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return relative.split(path.sep).join("/");
}
