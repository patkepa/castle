export type SidebarNoteView = "recent" | "pinned";

const sidebarNoteViewStorageKey = "castle.sidebar-note-view.v1";
const pinnedNoteIdsStorageKey = "castle.pinned-note-ids.v1";

export function parseSidebarNoteView(value: string | null): SidebarNoteView {
  return value === "pinned" ? "pinned" : "recent";
}

export function parsePinnedNoteIds(value: string | null): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];

    return [
      ...new Set(
        parsed.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      ),
    ];
  } catch {
    return [];
  }
}

export function readSidebarNoteView(): SidebarNoteView {
  try {
    return parseSidebarNoteView(
      window.localStorage.getItem(sidebarNoteViewStorageKey),
    );
  } catch {
    return "recent";
  }
}

export function writeSidebarNoteView(view: SidebarNoteView) {
  try {
    window.localStorage.setItem(sidebarNoteViewStorageKey, view);
  } catch {
    // The selected view still updates when storage is unavailable.
  }
}

export function readPinnedNoteIds(): string[] {
  try {
    return parsePinnedNoteIds(
      window.localStorage.getItem(pinnedNoteIdsStorageKey),
    );
  } catch {
    return [];
  }
}

export function writePinnedNoteIds(noteIds: readonly string[]) {
  try {
    window.localStorage.setItem(
      pinnedNoteIdsStorageKey,
      JSON.stringify([...new Set(noteIds)]),
    );
  } catch {
    // Pins still update for the current session when storage is unavailable.
  }
}

export function reorderPinnedNoteIds(
  noteIds: readonly string[],
  movedNoteId: string,
  targetNoteId: string,
): string[] {
  const movedIndex = noteIds.indexOf(movedNoteId);
  const targetIndex = noteIds.indexOf(targetNoteId);
  if (
    movedIndex === -1 ||
    targetIndex === -1 ||
    movedIndex === targetIndex
  ) {
    return [...noteIds];
  }

  const reordered = [...noteIds];
  const [moved] = reordered.splice(movedIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  return reordered;
}

export function movePinnedNoteBy(
  noteIds: readonly string[],
  noteId: string,
  offset: -1 | 1,
): string[] {
  const currentIndex = noteIds.indexOf(noteId);
  const nextIndex = currentIndex + offset;
  if (currentIndex === -1 || nextIndex < 0 || nextIndex >= noteIds.length) {
    return [...noteIds];
  }

  const reordered = [...noteIds];
  [reordered[currentIndex], reordered[nextIndex]] = [
    reordered[nextIndex],
    reordered[currentIndex],
  ];
  return reordered;
}
