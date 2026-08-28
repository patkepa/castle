import { Icon } from "@patkepa/kantzen-ui/primitives";
import type { Note } from "../types";

export { markdownBodyFromSource } from "../lib/markdownSource";

export function NoteEditingSurface({
  draft,
  error,
  note,
  onChange,
  onReload,
}: {
  draft: string;
  error: string;
  note: Note;
  onChange: (markdown: string) => void;
  onReload: () => void;
}) {
  return (
    <section
      className="note-editing-surface"
      aria-label={`Edit ${note.title}`}
    >
      {error ? (
        <div className="note-editing-error" role="alert">
          <Icon icon="warning-sign" aria-hidden="true" />
          <div>
            <strong>Castle could not save this note</strong>
            <p>{error}</p>
          </div>
          <button onClick={onReload} type="button">
            Reload source
          </button>
        </div>
      ) : null}

      <textarea
        aria-label="Markdown source"
        autoCapitalize="off"
        autoCorrect="off"
        autoFocus
        onChange={(event) => onChange(event.currentTarget.value)}
        rows={Math.max(24, draft.split(/\r\n|\r|\n/).length + 1)}
        spellCheck={false}
        value={draft}
      />
    </section>
  );
}
