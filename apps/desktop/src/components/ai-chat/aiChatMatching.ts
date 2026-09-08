import type { Note } from "../../types";

export const localCommands = [
  {
    id: "attach-current",
    label: "/attach-current",
    description: "Add the note you are reading",
  },
  {
    id: "search",
    label: "/search",
    description: "Find a note to add with @",
  },
  {
    id: "summarize",
    label: "/summarize",
    description: "Prepare a summary prompt",
  },
  {
    id: "clear",
    label: "/clear",
    description: "Clear this local conversation",
  },
] as const;

export type LocalCommandId = (typeof localCommands)[number]["id"];

export function getMentionQuery(value: string) {
  const match = /@([^\s@]*)$/u.exec(value);
  return match ? match[1] : null;
}

export function getCommandQuery(value: string) {
  const match = /^\/([^\s]*)$/u.exec(value);
  return match ? match[1] : null;
}

export function findMatchingNotes(
  notes: readonly Note[],
  query: string | null,
  attachedNotes: readonly Note[],
) {
  if (query === null) return [];
  const normalizedQuery = query.toLocaleLowerCase();
  const attachedIds = new Set(attachedNotes.map((note) => note.id));

  return notes
    .filter((note) => !attachedIds.has(note.id))
    .map((note) => ({ note, score: fuzzyNoteScore(note, normalizedQuery) }))
    .filter((result) => result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.note.title.localeCompare(right.note.title),
    )
    .map((result) => result.note)
    .slice(0, 6);
}

export function findMatchingCommands(query: string | null) {
  if (query === null) return [];
  const normalizedQuery = query.toLocaleLowerCase();
  return localCommands.filter((command) =>
    `${command.label} ${command.description}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
}

export function formatNoteLocation(note: Note) {
  const folder = note.relativePath.split("/").slice(0, -1).join(" / ");
  const sectionPrefix = `${note.section} / `;
  const location = folder.startsWith(sectionPrefix)
    ? folder.slice(sectionPrefix.length)
    : folder;
  return location ? `${note.sectionLabel} / ${location}` : note.sectionLabel;
}

function fuzzyNoteScore(note: Note, query: string) {
  if (!query) return 1;
  const title = note.title.toLocaleLowerCase();
  const path = note.relativePath.toLocaleLowerCase();
  const section = `${note.section} ${note.sectionLabel}`.toLocaleLowerCase();
  const text = `${title} ${path} ${section}`;
  let cursor = 0;
  let score = 0;

  for (const character of query) {
    const matchIndex = text.indexOf(character, cursor);
    if (matchIndex < 0) return 0;
    score += matchIndex === cursor ? 4 : 1;
    cursor = matchIndex + 1;
  }

  if (title.startsWith(query)) score += 100;
  else if (path.startsWith(query)) score += 60;
  else if (section.startsWith(query)) score += 40;
  else if (text.includes(query)) score += 20;
  return score;
}
