import type { CastleManagedSheet } from "../../platform/desktop_bridge";
import { fetchGeneratedSheetCatalog } from "./generated_sheet_library";

export interface LibrarySheet extends CastleManagedSheet {
  contentPath?: string;
  readOnly: boolean;
}

export async function loadLibrarySheets(): Promise<LibrarySheet[]> {
  const bridge = window.castleDesktop;
  if (bridge) {
    return (await bridge.listManagedSheets()).map((sheet) => ({
      ...sheet,
      readOnly: false,
    }));
  }

  return (await fetchGeneratedSheetCatalog()).map((sheet) => ({
    ...sheet,
    readOnly: true,
  }));
}

export function createSheetRoute(relativePath: string) {
  return `/sheet/${encodePath(relativePath)}`;
}

export function createSheetFolderRoute(directory: readonly string[] = []) {
  return directory.length > 0
    ? `/browse/sheets/${directory.map(encodeURIComponent).join("/")}`
    : "/browse/sheets";
}

export function decodeSheetRoutePath(value = "") {
  return value
    .split("/")
    .filter(Boolean)
    .map(decodeSegment)
    .join("/");
}

export function getSheetDirectory(relativePath: string) {
  return relativePath.split("/").slice(0, -1);
}

export function getSheetDirectoryContents(
  sheets: readonly LibrarySheet[],
  directory: readonly string[],
) {
  const folders = new Map<string, number>();
  const files: LibrarySheet[] = [];

  for (const sheet of sheets) {
    const sheetDirectory = getSheetDirectory(sheet.relativePath);
    if (!isDirectoryPrefix(directory, sheetDirectory)) continue;

    if (sheetDirectory.length === directory.length) {
      files.push(sheet);
      continue;
    }

    const child = sheetDirectory[directory.length];
    folders.set(child, (folders.get(child) ?? 0) + 1);
  }

  return {
    files: [...files].sort((left, right) => left.name.localeCompare(right.name)),
    folders: Array.from(folders, ([name, sheetCount]) => ({ name, sheetCount }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isDirectoryPrefix(prefix: readonly string[], directory: readonly string[]) {
  return prefix.length <= directory.length &&
    prefix.every((segment, index) => segment === directory[index]);
}
