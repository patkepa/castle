import {
  createFolderRoute,
  getNoteDirectory,
  humanizePathSegment,
} from "./libraryPaths";
import type { Note, SearchIndexEntry, SectionSummary } from "../types";

export interface PreparedSearchEntry extends SearchIndexEntry {
  normalizedText: string;
}

export interface RankedNote {
  note: Note;
  reason: string;
  snippet: string;
  score: number;
}

export type SearchableNote = Pick<
  Note,
  | "id"
  | "title"
  | "aliases"
  | "tags"
  | "relativePath"
  | "excerpt"
  | "modifiedAt"
>;

export interface RankedSearchResult {
  id: string;
  reason: string;
  snippet: string;
  score: number;
}

export interface SearchFolder {
  id: string;
  label: string;
  section: string;
  sectionLabel: string;
  directory: string[];
  route: string;
  noteCount: number;
}

export interface RankedFolder {
  folder: SearchFolder;
  score: number;
}

export interface SearchPage {
  id: string;
  label: string;
  description: string;
  keywords: readonly string[];
  route: string;
}

export interface RankedPage<Page extends SearchPage = SearchPage> {
  page: Page;
  score: number;
}

export interface MatchSegment {
  text: string;
  matched: boolean;
}

export const MAX_SEARCH_RESULTS = 12;

export function prepareSearchEntries(
  entries: readonly SearchIndexEntry[],
): PreparedSearchEntry[] {
  return entries.map((entry) => ({
    ...entry,
    normalizedText: normalizeSearch(entry.text),
  }));
}

export function createSearchFolders(
  notes: readonly Note[],
  sections: readonly SectionSummary[],
): SearchFolder[] {
  const sectionLabels = new Map(
    sections.map((section) => [section.id, section.label]),
  );
  const folders = new Map<string, SearchFolder>();

  for (const section of sections) {
    const route = createFolderRoute(section.id);
    folders.set(route, {
      id: route,
      label: section.label,
      section: section.id,
      sectionLabel: section.label,
      directory: [],
      route,
      noteCount: 0,
    });
  }

  for (const note of notes) {
    const sectionLabel = sectionLabels.get(note.section) ?? note.sectionLabel;
    addFolderNote(folders, note.section, sectionLabel, []);

    const noteDirectory = getNoteDirectory(note);
    for (let depth = 1; depth <= noteDirectory.length; depth += 1) {
      addFolderNote(
        folders,
        note.section,
        sectionLabel,
        noteDirectory.slice(0, depth),
      );
    }
  }

  return Array.from(folders.values());
}

export function rankFolders(
  query: string,
  folders: readonly SearchFolder[],
): RankedFolder[] {
  const normalizedQuery = normalizeSearch(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const ranked: RankedFolder[] = [];
  for (const folder of folders) {
    const label = normalizeSearch(folder.label);
    const path = normalizeSearch(
      [
        folder.sectionLabel,
        ...folder.directory.map(humanizePathSegment),
      ].join(" "),
    );
    if (!tokens.every((token) => path.includes(token))) continue;

    let score = tokens.length * 25 + 320;
    if (label === normalizedQuery) score += 1_000;
    else if (label.startsWith(normalizedQuery)) score += 750;
    else if (tokens.every((token) => label.includes(token))) score += 600;

    ranked.push({ folder, score });
  }

  return ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.folder.directory.length - right.folder.directory.length ||
      left.folder.label.localeCompare(right.folder.label),
  );
}

export function rankPages<Page extends SearchPage>(
  query: string,
  pages: readonly Page[],
): RankedPage<Page>[] {
  const normalizedQuery = normalizeSearch(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const ranked: RankedPage<Page>[] = [];
  for (const page of pages) {
    const label = normalizeSearch(page.label);
    const searchableText = normalizeSearch(
      [page.label, page.description, ...page.keywords].join(" "),
    );
    if (!tokens.every((token) => searchableText.includes(token))) continue;

    let score = tokens.length * 25;
    if (label === normalizedQuery) score += 1_000;
    else if (label.startsWith(normalizedQuery)) score += 750;
    else if (tokens.every((token) => label.includes(token))) score += 600;
    else score += 400;

    ranked.push({ page, score });
  }

  return ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.page.label.localeCompare(right.page.label),
  );
}

export function rankNotes(
  query: string,
  entries: readonly PreparedSearchEntry[],
  notesById: ReadonlyMap<string, Note>,
): RankedNote[] {
  return rankSearchResults(query, entries, notesById).flatMap((result) => {
    const note = notesById.get(result.id);
    return note ? [{ ...result, note }] : [];
  });
}

export function rankSearchResults(
  query: string,
  entries: readonly PreparedSearchEntry[],
  notesById: ReadonlyMap<string, SearchableNote>,
): RankedSearchResult[] {
  const normalizedQuery = normalizeSearch(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const ranked: RankedSearchResult[] = [];
  for (const entry of entries) {
    if (!tokens.every((token) => entry.normalizedText.includes(token))) continue;
    const note = notesById.get(entry.id);
    if (!note) continue;

    const title = normalizeSearch(note.title);
    const aliases = normalizeSearch(note.aliases.join(" "));
    const tags = normalizeSearch(note.tags.join(" "));
    const path = normalizeSearch(note.relativePath);
    let score = tokens.length * 25;
    let reason = "Note content";

    if (title === normalizedQuery) {
      score += 1_000;
      reason = "Exact title";
    } else if (title.startsWith(normalizedQuery)) {
      score += 750;
      reason = "Title";
    } else if (tokens.every((token) => title.includes(token))) {
      score += 600;
      reason = "Title";
    } else if (aliases && tokens.every((token) => aliases.includes(token))) {
      score += 520;
      reason = "Alias";
    } else if (tags && tokens.every((token) => tags.includes(token))) {
      score += 420;
      reason = "Tag";
    } else if (tokens.every((token) => path.includes(token))) {
      score += 320;
      reason = "Path";
    } else {
      const occurrenceCount = tokens.reduce(
        (total, token) =>
          total + countOccurrences(entry.normalizedText, token),
        0,
      );
      const earliestMatch = Math.min(
        ...tokens.map((token) => entry.normalizedText.indexOf(token)),
      );
      score +=
        Math.min(occurrenceCount, 25) * 6 +
        Math.max(0, 60 - Math.floor(earliestMatch / 100));
    }

    ranked.push({
      id: note.id,
      reason,
      snippet:
        reason === "Note content"
          ? matchedSnippet(entry.text, tokens[0])
          : note.excerpt,
      score,
    });
  }

  return ranked
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(notesById.get(right.id)?.modifiedAt ?? "") -
          Date.parse(notesById.get(left.id)?.modifiedAt ?? "") ||
        (notesById.get(left.id)?.title ?? "").localeCompare(
          notesById.get(right.id)?.title ?? "",
        ),
    )
    .slice(0, MAX_SEARCH_RESULTS);
}

export function getMatchSegments(value: string, query: string): MatchSegment[] {
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || value.length === 0) {
    return [{ text: value, matched: false }];
  }

  const characters = Array.from(value);
  const normalizedToOriginal: number[] = [];
  let normalizedValue = "";

  characters.forEach((character, originalIndex) => {
    const normalizedCharacter = normalizeSearchCharacter(character).replace(
      /\s/gu,
      " ",
    );
    normalizedValue += normalizedCharacter;
    normalizedToOriginal.push(
      ...Array.from(
        { length: normalizedCharacter.length },
        () => originalIndex,
      ),
    );
  });

  const matchedCharacters = new Set<number>();
  for (const token of tokens) {
    let offset = 0;
    while ((offset = normalizedValue.indexOf(token, offset)) >= 0) {
      for (let index = offset; index < offset + token.length; index += 1) {
        const originalIndex = normalizedToOriginal[index];
        if (originalIndex !== undefined) matchedCharacters.add(originalIndex);
      }
      offset += token.length;
    }
  }

  if (matchedCharacters.size === 0) {
    return [{ text: value, matched: false }];
  }

  const segments: MatchSegment[] = [];
  for (const [index, character] of characters.entries()) {
    const matched = matchedCharacters.has(index);
    const previous = segments.at(-1);
    if (previous?.matched === matched) previous.text += character;
    else segments.push({ text: character, matched });
  }
  return segments;
}

function addFolderNote(
  folders: Map<string, SearchFolder>,
  section: string,
  sectionLabel: string,
  directory: string[],
) {
  const route = createFolderRoute(section, directory);
  const folder = folders.get(route);
  if (folder) {
    folder.noteCount += 1;
    return;
  }

  folders.set(route, {
    id: route,
    label: humanizePathSegment(directory.at(-1) ?? sectionLabel),
    section,
    sectionLabel,
    directory,
    route,
    noteCount: 1,
  });
}

function countOccurrences(value: string, token: string) {
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(token, offset)) >= 0) {
    count += 1;
    offset += token.length;
  }
  return count;
}

export function matchedSnippet(text: string, token: string) {
  const normalized = normalizeSearch(text);
  const index = normalized.indexOf(token);
  if (index < 0) return text.slice(0, 150);
  const start = Math.max(0, index - 58);
  const end = Math.min(text.length, index + token.length + 92);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${
    end < text.length ? "…" : ""
  }`;
}

export function normalizeSearch(value: string) {
  return normalizeSearchCharacter(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchCharacter(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[łøđð]/gu, (character) => {
      if (character === "ł") return "l";
      if (character === "ø") return "o";
      return "d";
    })
    .replace(/þ/gu, "th")
    .replace(/æ/gu, "ae")
    .replace(/œ/gu, "oe")
    .replace(/ß/gu, "ss");
}
