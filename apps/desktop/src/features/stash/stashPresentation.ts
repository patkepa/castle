import { formatLocalDateKey } from "../../lib/calendarDate";
import type { Note } from "../../types";
export { getYouTubeVideoId } from "../../lib/youtube";

const stashDayFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export interface StashDayGroup {
  id: string;
  label: string;
  notes: Note[];
}

export type StashPreviewBlock =
  | { kind: "links"; links: string[] }
  | { kind: "text"; text: string };

export function groupStashNotes(notes: readonly Note[]): StashDayGroup[] {
  const groups = new Map<string, StashDayGroup>();
  const orderedNotes = [...notes].sort(
    (left, right) => stashTimestamp(right) - stashTimestamp(left),
  );

  for (const note of orderedNotes) {
    const date = stashDate(note);
    const id = formatLocalDateKey(date);
    const group = groups.get(id) ?? {
      id,
      label: stashDayFormatter.format(date),
      notes: [],
    };
    group.notes.push(note);
    groups.set(id, group);
  }

  return [...groups.values()];
}

export function getExternalWebUrl(content: string): string | null {
  const candidate = content.trim();
  if (!candidate || /\s/.test(candidate)) return null;

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? candidate
      : null;
  } catch {
    return null;
  }
}

export function getStashPreviewBlocks(content: string): StashPreviewBlock[] {
  const blocks: StashPreviewBlock[] = [];
  let links: string[] = [];
  let textLines: string[] = [];

  const flushLinks = () => {
    if (links.length === 0) return;
    blocks.push({ kind: "links", links });
    links = [];
  };
  const flushText = () => {
    const text = textLines.join("\n").trim();
    if (text) blocks.push({ kind: "text", text });
    textLines = [];
  };

  for (const line of content.split(/\r?\n/u)) {
    const link = getExternalWebUrl(line);
    if (link) {
      flushText();
      links.push(link);
      continue;
    }

    flushLinks();
    textLines.push(line);
  }

  flushLinks();
  flushText();
  return blocks;
}

function stashDate(note: Note) {
  const timestamp = stashTimestamp(note);
  return new Date(timestamp);
}

function stashTimestamp(note: Note) {
  const timestamp = Date.parse(note.createdAt || note.modifiedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
