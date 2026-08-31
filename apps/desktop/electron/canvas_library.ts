import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { CastleManagedCanvas } from "../src/platform/desktop_bridge";

const maximumCanvasBytes = 8 * 1024 * 1024;
const maximumCanvasCount = 500;
const maximumFolderDepth = 8;

export async function listManagedCanvases(
  libraryRoot: string,
): Promise<CastleManagedCanvas[]> {
  const canvasRoot = path.join(libraryRoot, "canvas");
  try {
    const rootStats = await stat(canvasRoot);
    if (!rootStats.isDirectory()) return [];
  } catch {
    return [];
  }

  const canvases: CastleManagedCanvas[] = [];
  await collectCanvases(canvasRoot, "", 0, canvases);
  return canvases.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, undefined, {
      sensitivity: "base",
    }),
  );
}

export async function readManagedCanvas(
  libraryRoot: string,
  relativePath: string,
) {
  const { candidate, candidateStats } = await resolveManagedCanvas(
    libraryRoot,
    relativePath,
  );
  if (candidateStats.size > maximumCanvasBytes) {
    throw new Error("This canvas is larger than Castle's 8 MB limit.");
  }
  return readFile(candidate, "utf8");
}

export async function createManagedCanvas(
  libraryRoot: string,
  relativePath: string,
  source: string,
): Promise<CastleManagedCanvas> {
  assertCanvasSourceSize(source);
  JSON.parse(source);

  const canvasRoot = path.join(libraryRoot, "canvas");
  await mkdir(canvasRoot, { recursive: true });
  const canonicalRoot = await realpath(canvasRoot);
  const candidate = path.resolve(canonicalRoot, ...relativePath.split("/"));
  assertInsideRoot(canonicalRoot, candidate);
  const canonicalParent = await realpath(path.dirname(candidate));
  assertInsideRoot(canonicalRoot, canonicalParent, true);
  if (path.extname(candidate).toLocaleLowerCase() !== ".canvas") {
    throw new Error("Castle can only create .canvas files in library/canvas/.");
  }
  await writeFile(candidate, source, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return describeCanvas(candidate, relativePath);
}

export async function saveManagedCanvas(
  libraryRoot: string,
  relativePath: string,
  source: string,
): Promise<CastleManagedCanvas> {
  assertCanvasSourceSize(source);
  JSON.parse(source);
  const { candidate, candidateStats } = await resolveManagedCanvas(
    libraryRoot,
    relativePath,
  );
  const temporaryPath = path.join(
    path.dirname(candidate),
    `.castle-canvas-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, source, {
      encoding: "utf8",
      mode: candidateStats.mode,
    });
    await chmod(temporaryPath, candidateStats.mode);
    await rename(temporaryPath, candidate);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  return describeCanvas(candidate, relativePath);
}

async function resolveManagedCanvas(libraryRoot: string, relativePath: string) {
  const canvasRoot = path.join(libraryRoot, "canvas");
  const canonicalRoot = await realpath(canvasRoot);
  const requestedPath = path.resolve(canonicalRoot, ...relativePath.split("/"));
  assertInsideRoot(canonicalRoot, requestedPath);
  const candidate = await realpath(requestedPath);
  assertInsideRoot(canonicalRoot, candidate);

  const [candidateStats, candidateLinkStats] = await Promise.all([
    stat(candidate),
    lstat(requestedPath),
  ]);
  if (
    !candidateStats.isFile() ||
    candidateLinkStats.isSymbolicLink() ||
    path.extname(candidate).toLocaleLowerCase() !== ".canvas"
  ) {
    throw new Error("Castle can only open .canvas files from library/canvas/.");
  }
  return { candidate, candidateStats };
}

function assertInsideRoot(root: string, candidate: string, allowRoot = false) {
  const relativeCandidate = path.relative(root, candidate);
  if (
    (!allowRoot && relativeCandidate === "") ||
    relativeCandidate === ".." ||
    relativeCandidate.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeCandidate)
  ) {
    throw new Error("Castle rejected a canvas outside library/canvas/.");
  }
}

function assertCanvasSourceSize(source: string) {
  if (
    source.length === 0 ||
    Buffer.byteLength(source, "utf8") > maximumCanvasBytes
  ) {
    throw new Error("Castle can only save JSON Canvas files up to 8 MB.");
  }
}

async function describeCanvas(candidate: string, relativePath: string) {
  const metadata = await stat(candidate);
  return {
    relativePath,
    name: path.basename(relativePath),
    size: metadata.size,
    modifiedAt: metadata.mtime.toISOString(),
  };
}

async function collectCanvases(
  canvasRoot: string,
  relativeDirectory: string,
  depth: number,
  canvases: CastleManagedCanvas[],
) {
  if (depth > maximumFolderDepth || canvases.length >= maximumCanvasCount) return;
  const directory = path.join(
    canvasRoot,
    ...relativeDirectory.split("/").filter(Boolean),
  );
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  )) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const relativePath = [relativeDirectory, entry.name]
      .filter(Boolean)
      .join("/");
    if (entry.isDirectory()) {
      await collectCanvases(canvasRoot, relativePath, depth + 1, canvases);
    } else if (
      entry.isFile() &&
      path.extname(entry.name).toLocaleLowerCase() === ".canvas"
    ) {
      canvases.push(await describeCanvas(path.join(directory, entry.name), relativePath));
    }
    if (canvases.length >= maximumCanvasCount) return;
  }
}
