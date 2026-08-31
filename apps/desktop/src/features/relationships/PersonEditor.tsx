import { Icon } from "@patkepa/kantzen-ui/primitives";
import {
  type FormEvent,
  type ReactNode,
} from "react";
import type { GraphNode } from "../../types";
import {
  personAlignmentOptions,
  personRelationOptions,
  type PersonFormValues,
  type PersonRelation,
  type PersonStatus,
} from "./personMarkdown";

export interface PersonEditorDraft
  extends Omit<
    PersonFormValues,
    "knownFrom" | "departments" | "tags"
  > {
  knownFrom: string;
  departments: string;
  tags: string;
}

export function createPersonEditorDraft(
  values: PersonFormValues,
): PersonEditorDraft {
  return {
    ...values,
    knownFrom: values.knownFrom.join(", "),
    departments: values.departments.join(", "),
    tags: values.tags.join(", "),
  };
}

export function personFormValuesFromDraft(
  draft: PersonEditorDraft,
): PersonFormValues {
  return {
    ...draft,
    knownFrom: splitList(draft.knownFrom),
    departments: splitList(draft.departments),
    tags: splitList(draft.tags),
  };
}

export function PersonEditor({
  node,
  draft,
  dirty,
  error,
  loading,
  saving,
  onCancel,
  onChange,
  onDismissError,
  onRetry,
  onSave,
}: {
  node: GraphNode;
  draft: PersonEditorDraft | null;
  dirty: boolean;
  error: string;
  loading: boolean;
  saving: boolean;
  onCancel: () => void;
  onChange: (draft: PersonEditorDraft) => void;
  onDismissError: () => void;
  onRetry: () => void;
  onSave: (values: PersonFormValues) => void;
}) {
  const disabled = loading || saving || !draft;
  const valid = Boolean(
    draft?.name.trim() &&
      draft.alignments.length > 0 &&
      splitList(draft.knownFrom).length > 0,
  );
  const update = <Key extends keyof PersonEditorDraft>(
    key: Key,
    value: PersonEditorDraft[Key],
  ) => {
    if (draft) onChange({ ...draft, [key]: value });
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft && valid && !disabled) onSave(personFormValuesFromDraft(draft));
  };

  return (
    <section
      className="person-detail-panel person-editor"
      aria-label={`Edit ${node.label}`}
    >
      <form onSubmit={handleSubmit}>
        <header className="person-editor-header">
          <div className="person-editor-title">
            <Icon icon="edit" size={16} aria-hidden="true" />
            <div>
              <span>Editing profile</span>
              <h2>{node.label}</h2>
            </div>
          </div>
          <div className="person-editor-actions">
            <button
              type="button"
              className="person-editor-cancel"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="person-editor-save"
              disabled={disabled || !dirty || !valid}
            >
              <Icon
                icon={saving ? "refresh" : "floppy-disk"}
                size={13}
                aria-hidden="true"
              />
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </header>

        <div className="person-editor-scroll">
          {error ? (
            <div className="person-editor-error" role="alert">
              <Icon icon="warning-sign" size={14} aria-hidden="true" />
              <div>
                <strong>Castle could not save this person</strong>
                <p>{error}</p>
              </div>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={onDismissError}
              >
                <Icon icon="cross" size={13} aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {loading ? (
            <div className="person-editor-loading" role="status">
              <Icon icon="refresh" size={18} aria-hidden="true" />
              <span>Opening the original Markdown…</span>
            </div>
          ) : !draft ? (
            <div className="person-editor-loading person-editor-loading--error">
              <Icon icon="document" size={18} aria-hidden="true" />
              <span>The original Markdown could not be opened.</span>
              <button type="button" onClick={onRetry}>Try again</button>
            </div>
          ) : (
            <>
              <EditorSection
                title="Identity"
                description="The primary details used throughout Castle."
              >
                <EditorField label="Name" required wide>
                  <input
                    autoFocus
                    disabled={saving}
                    required
                    value={draft.name}
                    onChange={(event) => update("name", event.currentTarget.value)}
                  />
                </EditorField>
                <EditorField label="Nickname">
                  <input
                    disabled={saving}
                    value={draft.nickname}
                    onChange={(event) =>
                      update("nickname", event.currentTarget.value)
                    }
                  />
                </EditorField>
                <EditorField label="Status">
                  <select
                    disabled={saving}
                    value={draft.status}
                    onChange={(event) =>
                      update("status", event.currentTarget.value as PersonStatus)
                    }
                  >
                    <option value="active">Active</option>
                    <option value="former">Former</option>
                  </select>
                </EditorField>
                <EditorField label="Birthday">
                  <input
                    disabled={saving}
                    type="date"
                    value={draft.birthday}
                    onChange={(event) =>
                      update("birthday", event.currentTarget.value)
                    }
                  />
                </EditorField>
                <EditorField label="Birthplace">
                  <input
                    disabled={saving}
                    value={draft.birthplace}
                    onChange={(event) =>
                      update("birthplace", event.currentTarget.value)
                    }
                  />
                </EditorField>
                <EditorField label="Nationality">
                  <input
                    disabled={saving}
                    value={draft.nationality}
                    onChange={(event) =>
                      update("nationality", event.currentTarget.value)
                    }
                  />
                </EditorField>
              </EditorSection>

              <EditorSection
                title="Relationship"
                description="How this person is organized in relationship views."
              >
                <EditorField label="Sentiment">
                  <select
                    disabled={saving}
                    value={draft.relation}
                    onChange={(event) =>
                      update(
                        "relation",
                        event.currentTarget.value as PersonRelation,
                      )
                    }
                  >
                    {personRelationOptions.map((relation) => (
                      <option key={relation} value={relation}>
                        {humanize(relation)}
                      </option>
                    ))}
                  </select>
                </EditorField>
                <EditorField label="Known from" required>
                  <input
                    disabled={saving}
                    placeholder="family, example_collective/engineering"
                    value={draft.knownFrom}
                    onChange={(event) =>
                      update("knownFrom", event.currentTarget.value)
                    }
                  />
                </EditorField>
                <fieldset className="person-editor-alignments">
                  <legend>Alignment</legend>
                  <div>
                    {personAlignmentOptions.map((alignment) => {
                      const checked = draft.alignments.includes(alignment);
                      return (
                        <label key={alignment} className={checked ? "is-checked" : ""}>
                          <input
                            checked={checked}
                            disabled={saving}
                            type="checkbox"
                            onChange={(event) =>
                              update(
                                "alignments",
                                changeSelection(
                                  draft.alignments,
                                  alignment,
                                  event.currentTarget.checked,
                                ),
                              )
                            }
                          />
                          <span>{humanize(alignment)}</span>
                        </label>
                      );
                    })}
                  </div>
                  {draft.alignments.length === 0 ? (
                    <small>Choose at least one alignment.</small>
                  ) : null}
                </fieldset>
                <EditorField label="How we met">
                  <input
                    disabled={saving}
                    value={draft.met}
                    onChange={(event) => update("met", event.currentTarget.value)}
                  />
                </EditorField>
                <EditorField label="Met through">
                  <input
                    disabled={saving}
                    value={draft.metThrough}
                    onChange={(event) =>
                      update("metThrough", event.currentTarget.value)
                    }
                  />
                </EditorField>
              </EditorSection>

              <EditorSection
                title="Context"
                description="Location, work, and presentation metadata."
              >
                <EditorField label="Primary location" wide>
                  <input
                    disabled={saving}
                    placeholder="unknown"
                    value={draft.location}
                    onChange={(event) =>
                      update("location", event.currentTarget.value)
                    }
                  />
                </EditorField>
                <EditorField label="Company">
                  <input
                    disabled={saving}
                    value={draft.company}
                    onChange={(event) =>
                      update("company", event.currentTarget.value)
                    }
                  />
                </EditorField>
                <EditorField label="Departments">
                  <input
                    disabled={saving}
                    placeholder="Firmware, Platform"
                    value={draft.departments}
                    onChange={(event) =>
                      update("departments", event.currentTarget.value)
                    }
                  />
                </EditorField>
                <EditorField label="Avatar path" wide>
                  <input
                    disabled={saving}
                    placeholder="/assets/avatars/name.jpg"
                    value={draft.avatar}
                    onChange={(event) =>
                      update("avatar", event.currentTarget.value)
                    }
                  />
                </EditorField>
                <EditorField label="Tags" wide>
                  <input
                    disabled={saving}
                    placeholder="relationship, important"
                    value={draft.tags}
                    onChange={(event) => update("tags", event.currentTarget.value)}
                  />
                </EditorField>
              </EditorSection>

              <EditorSection
                title="Profile notes"
                description="Edit the Markdown body without leaving split view."
              >
                <label className="person-editor-notes">
                  <span>Markdown</span>
                  <textarea
                    disabled={saving}
                    spellCheck={false}
                    value={draft.body}
                    onChange={(event) => update("body", event.currentTarget.value)}
                  />
                </label>
              </EditorSection>
            </>
          )}
        </div>
      </form>
    </section>
  );
}

function EditorSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="person-editor-section">
      <header>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      <div className="person-editor-grid">{children}</div>
    </section>
  );
}

function EditorField({
  label,
  required = false,
  wide = false,
  children,
}: {
  label: string;
  required?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`person-editor-field${wide ? " is-wide" : ""}`}>
      <span>
        {label}
        {required ? <i aria-hidden="true">Required</i> : null}
      </span>
      {children}
    </label>
  );
}

function splitList(value: string) {
  return [...new Set(
    value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function changeSelection(
  selection: string[],
  value: string,
  selected: boolean,
) {
  return selected
    ? [...new Set([...selection, value])]
    : selection.filter((item) => item !== value);
}

function humanize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}
