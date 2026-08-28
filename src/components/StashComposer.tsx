import { Icon } from "@patkepa/kantzen-ui/primitives";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createStashSourceInput } from "../features/stash/stashCapture";
import { useCastlePlatform } from "../platform/castle_platform_provider";
import type { Note } from "../types";

export function StashComposer({ notes }: { notes: readonly Note[] }) {
  const platform = useCastlePlatform();
  const mutations = platform.contentMutations;
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const reservedSourceFiles = useRef(new Set<string>());
  const canCreate = Boolean(platform.capabilities.createContent && mutations);

  if (!canCreate || !mutations) return null;

  const save = async () => {
    if (saving || !draft.trim()) return;
    const existingSourceFiles = new Set([
      ...notes.map((note) => note.sourceFile),
      ...reservedSourceFiles.current,
    ]);
    const input = createStashSourceInput(draft, existingSourceFiles);
    reservedSourceFiles.current.add(input.sourceFile);
    setSaving(true);
    setError("");
    setAnnouncement("");
    try {
      await mutations.createSource(input);
      setDraft("");
      setAnnouncement("Added to stash.");
    } catch (reason) {
      setError(stashMutationError(reason));
    } finally {
      setSaving(false);
    }
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    void save();
  };

  return (
    <section className="stash-composer" aria-labelledby="stash-composer-title">
      <header className="stash-composer-header">
        <div>
          <span>Quick capture</span>
          <h2 id="stash-composer-title">Add to stash</h2>
        </div>
        <Icon icon="inbox" size={18} aria-hidden="true" />
      </header>
      <form onSubmit={handleSubmit}>
        <div className="stash-composer-input-row">
          <textarea
            aria-label="New stash item"
            disabled={saving}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setError("");
              setAnnouncement("");
            }}
            onKeyDown={handleKeyDown}
            placeholder="Capture a thought, paste a link, or add Markdown…"
            rows={3}
            value={draft}
          />
          <button
            aria-label="Add item"
            disabled={saving || !draft.trim()}
            title="Add item"
            type="submit"
          >
            <Icon icon={saving ? "refresh" : "small-plus"} size={14} aria-hidden="true" />
            <span>{saving ? "Adding…" : "Add item"}</span>
          </button>
        </div>
        <footer className="stash-composer-footer">
          <span>Markdown supported</span>
          <span className="stash-composer-shortcut">⌘/Ctrl + Enter to add</span>
        </footer>
      </form>
      {error ? (
        <div className="stash-composer-message stash-composer-message--error" role="alert">
          <Icon icon="warning-sign" size={14} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      <div className="stash-composer-status" role="status" aria-live="polite">
        {announcement}
      </div>
    </section>
  );
}

function stashMutationError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return (
    message
      .replace(/^Error invoking remote method '[^']+':\s*/i, "")
      .replace(/^Error:\s*/i, "") || "Castle could not add this stash item."
  );
}
