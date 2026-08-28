import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Icon } from "@patkepa/kantzen-ui/primitives";
import { Link } from "react-router-dom";
import type {
  CalendarEvent,
  GraphNode,
  Note,
  RelationshipGraphData,
} from "../../types";
import {
  useGeneratedResource,
  validateNoteContent,
} from "../../lib/generatedData";
import { NoteMarkdown } from "../../components/NoteMarkdown";
import { useCastlePlatform } from "../../platform/castle_platform_provider";
import {
  createPersonEditorDraft,
  PersonEditor,
  personFormValuesFromDraft,
  type PersonEditorDraft,
} from "./PersonEditor";
import {
  readPersonMarkdown,
  type PersonFormValues,
} from "./personMarkdown";

const profileDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function PersonDetailPanel({
  graph,
  notes,
  node,
  note,
  nodesById,
  connections,
  events,
  onSelectNode,
  onPersonSaved,
  onEditorStateChange,
}: {
  graph: RelationshipGraphData;
  notes: Note[];
  node: GraphNode | null;
  note?: Note;
  nodesById: Map<string, GraphNode>;
  connections: Set<string>;
  events: CalendarEvent[];
  onSelectNode: (nodeId: string) => void;
  onPersonSaved: () => void;
  onEditorStateChange?: (state: {
    active: boolean;
    dirty: boolean;
    saving: boolean;
  }) => void;
}) {
  const platform = useCastlePlatform();
  const mutations = platform.contentMutations;
  const {
    data: noteContent,
    error: loadError,
    reload: reloadNoteContent,
  } = useGeneratedResource(
    note?.contentPath ?? null,
    validateNoteContent,
    "Person note",
  );
  const [editorStatus, setEditorStatus] = useState<
    "idle" | "loading" | "ready" | "saving"
  >("idle");
  const [editorDraft, setEditorDraft] = useState<PersonEditorDraft | null>(null);
  const [initialEditorDraft, setInitialEditorDraft] = useState("");
  const [editorError, setEditorError] = useState("");
  const editorRequest = useRef(0);
  const editorActive = editorStatus !== "idle";
  const editorDirty = Boolean(
    editorDraft && JSON.stringify(editorDraft) !== initialEditorDraft,
  );
  const canEdit = Boolean(
    note && platform.capabilities.editContent && mutations,
  );

  const resetEditor = useCallback(() => {
    editorRequest.current += 1;
    setEditorStatus("idle");
    setEditorDraft(null);
    setInitialEditorDraft("");
    setEditorError("");
  }, []);

  const openEditor = useCallback(async () => {
    if (
      !note ||
      !mutations ||
      editorStatus === "loading" ||
      editorStatus === "saving"
    ) {
      return;
    }
    const request = ++editorRequest.current;
    setEditorStatus("loading");
    setEditorError("");
    try {
      const document = await mutations.readSource(note.id);
      if (request !== editorRequest.current) return;
      const draft = createPersonEditorDraft(
        readPersonMarkdown(document.markdown),
      );
      setEditorDraft(draft);
      setInitialEditorDraft(JSON.stringify(draft));
      setEditorStatus("ready");
    } catch (reason) {
      if (request !== editorRequest.current) return;
      setEditorStatus("ready");
      setEditorError(personMutationError(reason));
    }
  }, [editorStatus, mutations, note]);

  const closeEditor = useCallback(() => {
    if (
      editorDirty &&
      !window.confirm("Discard the unsaved changes to this person?")
    ) {
      return;
    }
    resetEditor();
  }, [editorDirty, resetEditor]);

  const savePerson = useCallback(async (values: PersonFormValues) => {
    if (
      !mutations ||
      !note ||
      editorStatus === "saving"
    ) {
      return;
    }
    const request = editorRequest.current;
    setEditorStatus("saving");
    setEditorError("");
    try {
      await mutations.updatePerson({
        noteId: note.id,
        fields: values,
      });
      if (request !== editorRequest.current) return;
      resetEditor();
      reloadNoteContent();
      onPersonSaved();
    } catch (reason) {
      if (request !== editorRequest.current) return;
      setEditorStatus("ready");
      setEditorError(personMutationError(reason));
    }
  }, [
    editorStatus,
    mutations,
    note,
    onPersonSaved,
    reloadNoteContent,
    resetEditor,
  ]);

  useEffect(() => resetEditor(), [note?.id, resetEditor]);

  useEffect(
    () => () => {
      editorRequest.current += 1;
    },
    [],
  );

  useEffect(() => {
    onEditorStateChange?.({
      active: editorActive,
      dirty: editorDirty,
      saving: editorStatus === "saving",
    });
    return () =>
      onEditorStateChange?.({ active: false, dirty: false, saving: false });
  }, [editorActive, editorDirty, editorStatus, onEditorStateChange]);

  useEffect(() => {
    if (!editorDirty) return;
    const preventAccidentalClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalClose);
    return () =>
      window.removeEventListener("beforeunload", preventAccidentalClose);
  }, [editorDirty]);

  useEffect(() => {
    if (!editorActive) return;
    const handleEditorShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (editorDraft && editorDirty) {
          void savePerson(personFormValuesFromDraft(editorDraft));
        }
      } else if (event.key === "Escape" && editorStatus !== "saving") {
        event.preventDefault();
        closeEditor();
      }
    };
    window.addEventListener("keydown", handleEditorShortcut);
    return () => window.removeEventListener("keydown", handleEditorShortcut);
  }, [
    closeEditor,
    editorActive,
    editorDraft,
    editorDirty,
    editorStatus,
    savePerson,
  ]);

  if (!node || node.type !== "person") {
    return (
      <section className="person-detail-panel person-detail-empty">
        <Icon icon="person" size={28} />
        <h2>Select a person</h2>
        <p>Choose someone from the list or graph to see their full profile.</p>
      </section>
    );
  }

  if (editorActive) {
    return (
      <PersonEditor
        node={node}
        draft={editorDraft}
        dirty={editorDirty}
        error={editorError}
        loading={editorStatus === "loading"}
        saving={editorStatus === "saving"}
        onCancel={closeEditor}
        onChange={setEditorDraft}
        onDismissError={() => setEditorError("")}
        onRetry={() => void openEditor()}
        onSave={(values) => void savePerson(values)}
      />
    );
  }

  const connectedPeople = [...connections]
    .map((nodeId) => nodesById.get(nodeId))
    .filter(
      (candidate): candidate is GraphNode => candidate?.type === "person",
    )
    .sort((left, right) => left.label.localeCompare(right.label));
  const relatedEvents = note
    ? events
        .filter((event) =>
          event.people.some((person) => person.noteId === note.id),
        )
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, 4)
    : [];
  const noteLinks = graph.edges.reduce(
    (count, edge) =>
      count +
      Number(
        edge.type === "note-link" &&
          (edge.source === node.id || edge.target === node.id),
      ),
    0,
  );
  const overview =
    note?.excerpt && note.excerpt !== "Open this note to read more."
      ? note.excerpt
      : "";

  return (
    <section className="person-detail-panel" aria-label={`${node.label} profile`}>
      <header className="person-profile-header">
        <PersonAvatar node={node} />
        <div className="person-profile-heading">
          <h2>{node.label}</h2>
          <p>
            <span
              className="person-profile-category-marker"
              style={{ "--person-color": node.color } as CSSProperties}
              aria-hidden="true"
            />
            <span>{node.alignmentLabel || "Unknown alignment"}</span>
            {node.status ? <span aria-hidden="true">·</span> : null}
            {node.status ? (
              <span>{node.status}</span>
            ) : null}
          </p>
        </div>
        <div className="person-profile-actions">
          {canEdit ? (
            <button
              type="button"
              className="person-profile-edit"
              onClick={() => void openEditor()}
            >
              <Icon icon="edit" size={13} />
              <span>Edit</span>
            </button>
          ) : null}
          {node.href ? (
            <Link className="person-profile-open-note" to={node.href}>
              <Icon icon="document" size={14} />
              <span>Open note</span>
              <Icon icon="arrow-top-right" size={13} />
            </Link>
          ) : null}
        </div>
      </header>

      <div className="person-profile-scroll">
        {overview ? (
          <section className="person-profile-section person-profile-overview">
            <span className="person-profile-kicker">Overview</span>
            <p>{overview}</p>
          </section>
        ) : null}

        <section className="person-profile-section person-profile-details">
          <span className="person-profile-kicker">Details</span>
          <dl>
            <div>
              <dt>Relationship</dt>
              <dd>{node.relationLabel || "Unknown"}</dd>
            </div>
            <div>
              <dt>Alignment</dt>
              <dd>
                <i
                  style={{ "--person-color": node.color } as CSSProperties}
                  aria-hidden="true"
                />
                {node.alignmentLabel || "Unknown"}
              </dd>
            </div>
            <div>
              <dt>Known from</dt>
              <dd>{node.knownFromLabel || "Unknown"}</dd>
            </div>
            {node.departmentLabel ? (
              <div>
                <dt>Department</dt>
                <dd>{node.departmentLabel}</dd>
              </div>
            ) : null}
            {node.locations && node.locations.length > 0 ? (
              <div>
                <dt>Locations</dt>
                <dd className="person-profile-location person-profile-locations">
                  {node.locations.map((location) => (
                    <a
                      href={location.mapsUrl}
                      key={location.id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon icon="map-marker" size={12} aria-hidden="true" />
                      <span>
                        <strong>{location.label}</strong>
                        {location.address}
                      </span>
                    </a>
                  ))}
                </dd>
              </div>
            ) : node.location ? (
              <div>
                <dt>Location</dt>
                <dd className="person-profile-location">
                  {node.mapsUrl ? (
                    <a href={node.mapsUrl} target="_blank" rel="noreferrer">
                      <Icon icon="map-marker" size={12} aria-hidden="true" />
                      <span>{node.location}</span>
                    </a>
                  ) : (
                    node.location
                  )}
                </dd>
              </div>
            ) : null}
            {node.status ? (
              <div>
                <dt>Status</dt>
                <dd>{node.status}</dd>
              </div>
            ) : null}
            <div>
              <dt>Connections</dt>
              <dd>{connections.size}</dd>
            </div>
            <div>
              <dt>Note links</dt>
              <dd>{noteLinks}</dd>
            </div>
            {note ? (
              <div>
                <dt>Updated</dt>
                <dd>{profileDateFormatter.format(new Date(note.modifiedAt))}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="person-profile-section person-profile-note">
          <span className="person-profile-kicker">Notes</span>
          {!note ? (
            <p className="person-profile-muted">No note is linked to this person.</p>
          ) : loadError ? (
            <p className="person-profile-error">
              This person’s note could not be loaded.
            </p>
          ) : !noteContent ? (
            <div className="person-profile-loading" role="status">
              <span />
              <span />
              <span />
              <span className="sr-only">Loading person note</span>
            </div>
          ) : noteContent.content ? (
            <NoteMarkdown
              content={noteContent.content}
              note={note}
              notes={notes}
              headings={noteContent.headings}
            />
          ) : (
            <p className="person-profile-muted">This note is empty.</p>
          )}
        </section>

        {connectedPeople.length > 0 ? (
          <section className="person-profile-section person-profile-connections">
            <span className="person-profile-kicker">Connected people</span>
            <div>
              {connectedPeople.map((person) => {
                const directRelation = graph.edges.find(
                  (edge) =>
                    edge.type === "person-relation" &&
                    ((edge.source === node.id && edge.target === person.id) ||
                      (edge.target === node.id && edge.source === person.id)),
                );
                return (
                  <button
                    type="button"
                    key={person.id}
                    onClick={() => onSelectNode(person.id)}
                  >
                    <i
                      style={{ "--person-color": person.color } as CSSProperties}
                      aria-hidden="true"
                    />
                    <span className="person-profile-connection-copy">
                      <span>{person.label}</span>
                      {directRelation?.relationLabel ? (
                        <small style={{ color: directRelation.color }}>
                          {[directRelation.relationship, directRelation.relationLabel]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      ) : null}
                    </span>
                    <Icon icon="arrow-right" size={12} />
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {relatedEvents.length > 0 ? (
          <section className="person-profile-section person-profile-events">
            <span className="person-profile-kicker">Calendar</span>
            <div>
              {relatedEvents.map((event) => (
                <Link key={event.id} to={`/calendar?date=${event.date}`}>
                  <span>{event.title}</span>
                  <time dateTime={`${event.date}T${event.startTime}`}>
                    {event.date}
                  </time>
                  <Icon icon="arrow-right" size={12} />
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}

function personMutationError(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message;
  return "The person could not be saved.";
}

function PersonAvatar({ node }: { node: GraphNode }) {
  const initials = node.label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("");

  return (
    <div
      className="person-profile-avatar"
      style={{ "--person-color": node.color } as CSSProperties}
      aria-hidden="true"
    >
      {node.avatarUrl ? <img src={node.avatarUrl} alt="" /> : initials || "?"}
    </div>
  );
}
