import type { Heading, Note } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

export {
  resolveMarkdownAsset as resolveAssetPath,
  resolveMarkdownLink as resolveNoteLink,
} from "@castle/content";

export function NoteMarkdown({
  content,
  headings,
  note,
  notes,
}: {
  content: string;
  headings?: readonly Heading[];
  note: Note;
  notes: readonly Note[];
}) {
  return (
    <MarkdownRenderer
      content={content}
      document={note}
      headings={headings}
      notes={notes}
    />
  );
}
