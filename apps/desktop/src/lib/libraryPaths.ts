import type { LibraryFolder, Note, SectionSummary } from "../types";

export interface PinnedFolder {
  label: string;
  route: string;
}

export function getNoteDirectory(note: Note) {
  return note.relativePath.split("/").slice(0, -1);
}

export function createFolderRoute(
  sectionId: string,
  directory: string[] = [],
) {
  return `/browse/${[sectionId, ...directory]
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

export function decodeFolderPath(value = "") {
  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

export function isSameDirectory(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

export function isDirectoryPrefix(prefix: string[], directory: string[]) {
  return (
    directory.length >= prefix.length &&
    prefix.every((segment, index) => segment === directory[index])
  );
}

export function humanizePathSegment(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

export function getDirectoryContents(
  notes: Note[],
  directory: string[],
  libraryFolders: readonly LibraryFolder[] = [],
) {
  const folders = new Map<string, { notes: Note[]; entryCount: number }>();
  const directNotes: Note[] = [];

  for (const note of notes) {
    const noteDirectory = getNoteDirectory(note);
    if (!isDirectoryPrefix(directory, noteDirectory)) continue;

    if (noteDirectory.length === directory.length) {
      directNotes.push(note);
      continue;
    }

    const childFolder = noteDirectory[directory.length];
    const folder = folders.get(childFolder) ?? { notes: [], entryCount: 0 };
    folder.notes.push(note);
    folders.set(childFolder, folder);
  }

  for (const folder of libraryFolders) {
    if (
      folder.directory.length !== directory.length + 1 ||
      !isDirectoryPrefix(directory, folder.directory)
    ) {
      continue;
    }
    const name = folder.directory[directory.length];
    const existing = folders.get(name);
    folders.set(name, {
      notes: existing?.notes ?? [],
      entryCount: folder.entryCount,
    });
  }

  return {
    folders: Array.from(folders, ([name, folder]) => ({
      name,
      notes: folder.notes,
      entryCount: folder.entryCount,
    })).sort((left, right) => left.name.localeCompare(right.name)),
    notes: directNotes.sort((left, right) =>
      left.title.localeCompare(right.title),
    ),
  };
}

export function getPinnedFolder(
  route: string,
  sections: SectionSummary[],
  notes: Note[],
  folders: readonly LibraryFolder[] = [],
): PinnedFolder | null {
  const routeParts = route.split("/").filter(Boolean);
  if (routeParts[0] !== "browse" || !routeParts[1]) return null;

  const sectionId = decodeRouteSegment(routeParts[1]);
  const directory = routeParts.slice(2).map(decodeRouteSegment);
  const section = sections.find((candidate) => candidate.id === sectionId);
  if (!section) return null;

  const folderExists =
    directory.length === 0 ||
    folders.some(
      (folder) =>
        folder.sectionId === sectionId &&
        isSameDirectory(folder.directory, directory),
    ) ||
    notes.some(
      (note) =>
        note.section === sectionId &&
        isDirectoryPrefix(directory, getNoteDirectory(note)),
    );
  if (!folderExists) return null;

  return {
    label:
      directory.length === 0
        ? section.label
        : `${section.label} / ${directory.map(humanizePathSegment).join(" / ")}`,
    route,
  };
}

function decodeRouteSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
