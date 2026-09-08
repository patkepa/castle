import { chmod, lstat, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { CastleManagedSheet } from "../src/platform/desktop_bridge";

const maximumSheetBytes = 50 * 1024 * 1024;
const maximumSheetCount = 500;
const maximumFolderDepth = 8;

export async function listManagedSheets(
  libraryRoot: string,
): Promise<CastleManagedSheet[]> {
  const sheetsRoot = path.join(libraryRoot, "sheets");
  try {
    const rootStats = await stat(sheetsRoot);
    if (!rootStats.isDirectory()) return [];
  } catch {
    return [];
  }

  const sheets: CastleManagedSheet[] = [];
  await collectSheets(sheetsRoot, "", 0, sheets);
  return sheets.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, undefined, {
      sensitivity: "base",
    }),
  );
}

export async function readManagedSheet(
  libraryRoot: string,
  relativePath: string,
): Promise<ArrayBuffer> {
  const sheetsRoot = path.join(libraryRoot, "sheets");
  const [canonicalRoot, candidate] = await Promise.all([
    realpath(sheetsRoot),
    realpath(path.join(sheetsRoot, ...relativePath.split("/"))),
  ]);
  const relativeCandidate = path.relative(canonicalRoot, candidate);
  if (
    relativeCandidate === "" ||
    relativeCandidate === ".." ||
    relativeCandidate.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeCandidate)
  ) {
    throw new Error("Castle rejected a sheet outside library/sheets/.");
  }

  const [candidateStats, candidateLinkStats] = await Promise.all([
    stat(candidate),
    lstat(path.join(sheetsRoot, ...relativePath.split("/"))),
  ]);
  if (
    !candidateStats.isFile() ||
    candidateLinkStats.isSymbolicLink() ||
    path.extname(candidate).toLocaleLowerCase() !== ".ods"
  ) {
    throw new Error("Castle can only open ODS files from library/sheets/.");
  }
  if (candidateStats.size > maximumSheetBytes) {
    throw new Error("This spreadsheet is larger than the 50 MB preview limit.");
  }

  const bytes = await readFile(candidate);
  return Uint8Array.from(bytes).buffer;
}

export async function saveManagedSheet(
  libraryRoot: string,
  relativePath: string,
  archive: ArrayBuffer,
): Promise<CastleManagedSheet> {
  if (archive.byteLength === 0 || archive.byteLength > maximumSheetBytes) {
    throw new Error("Castle can only save ODS files up to 50 MB.");
  }
  const { candidate, candidateStats } = await resolveManagedSheet(
    libraryRoot,
    relativePath,
  );
  const temporaryPath = path.join(
    path.dirname(candidate),
    `.castle-sheet-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, new Uint8Array(archive), { mode: candidateStats.mode });
    await chmod(temporaryPath, candidateStats.mode);
    await rename(temporaryPath, candidate);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  const metadata = await stat(candidate);
  return {
    relativePath,
    name: path.basename(relativePath),
    size: metadata.size,
    modifiedAt: metadata.mtime.toISOString(),
  };
}

async function resolveManagedSheet(libraryRoot: string, relativePath: string) {
  const sheetsRoot = path.join(libraryRoot, "sheets");
  const [canonicalRoot, candidate] = await Promise.all([
    realpath(sheetsRoot),
    realpath(path.join(sheetsRoot, ...relativePath.split("/"))),
  ]);
  const relativeCandidate = path.relative(canonicalRoot, candidate);
  if (
    relativeCandidate === "" ||
    relativeCandidate === ".." ||
    relativeCandidate.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeCandidate)
  ) {
    throw new Error("Castle rejected a sheet outside library/sheets/.");
  }

  const [candidateStats, candidateLinkStats] = await Promise.all([
    stat(candidate),
    lstat(path.join(sheetsRoot, ...relativePath.split("/"))),
  ]);
  if (
    !candidateStats.isFile() ||
    candidateLinkStats.isSymbolicLink() ||
    path.extname(candidate).toLocaleLowerCase() !== ".ods"
  ) {
    throw new Error("Castle can only open ODS files from library/sheets/.");
  }
  return { candidate, candidateStats };
}

async function collectSheets(
  sheetsRoot: string,
  relativeDirectory: string,
  depth: number,
  sheets: CastleManagedSheet[],
) {
  if (depth > maximumFolderDepth || sheets.length >= maximumSheetCount) return;
  const directory = path.join(
    sheetsRoot,
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
      await collectSheets(sheetsRoot, relativePath, depth + 1, sheets);
    } else if (
      entry.isFile() &&
      path.extname(entry.name).toLocaleLowerCase() === ".ods"
    ) {
      const metadata = await stat(path.join(directory, entry.name));
      sheets.push({
        relativePath,
        name: entry.name,
        size: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
      });
    }
    if (sheets.length >= maximumSheetCount) return;
  }
}
