import type { Note, NoteContent } from "../types";
import { markdownBodyFromSource, markdownHeadings } from "./markdownSource";
import {
  builtInDocumentDefinitions,
  type BuiltInDocumentDefinition,
  type BuiltInDocumentKey,
} from "./builtInDocumentManifest";
import markdownHelp from "../builtins/markdown_help.md?raw";

export interface BuiltInMarkdownDocument {
  key: BuiltInDocumentKey;
  markdown: string;
  note: Note;
  noteContent: NoteContent;
  overrideSourceFile: string;
}

const builtInModifiedAt = "2026-08-03T00:00:00.000Z";

export const builtInDocuments = Object.freeze({
  markdown_help: createBuiltInDocument(
    builtInDocumentDefinitions.markdown_help,
    markdownHelp,
  ),
} satisfies Record<BuiltInDocumentKey, BuiltInMarkdownDocument>);

export const builtInDocumentList = Object.freeze(
  Object.values(builtInDocuments),
);

export function resolveBuiltInDocument(
  key: BuiltInDocumentKey,
  notes: readonly Note[],
) {
  const document = builtInDocuments[key];
  const override = notes.find(
    (note) => note.sourceFile === document.overrideSourceFile,
  );
  return { document, note: override ?? document.note, override };
}

export function createDocumentRouteMap(notes: readonly Note[]) {
  const notesByRoute = new Map(notes.map((note) => [note.route, note]));
  for (const document of builtInDocumentList) {
    if (!notesByRoute.has(document.note.route)) {
      notesByRoute.set(document.note.route, document.note);
    }
  }
  return notesByRoute;
}

export function builtInDocumentForFallbackNote(note: Note | undefined) {
  if (!note?.contentPath.startsWith("builtin:")) return undefined;
  return builtInDocumentList.find((document) => document.note.id === note.id);
}

function createBuiltInDocument(
  definition: BuiltInDocumentDefinition,
  markdown: string,
): BuiltInMarkdownDocument {
  const content = markdownBodyFromSource(markdown);
  const relativePath = definition.overrideSourceFile.slice("notes/".length);
  const words = content.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const note: Note = {
    aliases: [],
    avatarUrl: "",
    contentPath: definition.contentPath,
    excerpt: content.split(/\n\s*\n/)[0] ?? "",
    id: definition.id,
    modifiedAt: builtInModifiedAt,
    pinned: definition.pinned,
    readingMinutes: Math.max(1, Math.ceil(words.length / 220)),
    relativePath,
    route: definition.route,
    section: "notes",
    sectionLabel: "Notes",
    sourceFile: definition.overrideSourceFile,
    status: "",
    tags: ["castle", "built-in"],
    title: definition.title,
    wordCount: words.length,
  };
  return {
    key: definition.key,
    markdown,
    note,
    noteContent: {
      backlinkNoteIds: [],
      backlinks: [],
      content,
      headings: markdownHeadings(content),
      id: definition.id,
      outgoingNoteIds: [],
      relatedNoteIds: [],
    },
    overrideSourceFile: definition.overrideSourceFile,
  };
}
