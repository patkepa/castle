import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import { WorkspacePortal } from "@patkepa/kantzen-ui/app-shell";
import { Icon } from "@patkepa/kantzen-ui/primitives";
import { Link, useLocation } from "react-router-dom";
import {
  getNoteDirectory,
  isSameDirectory,
} from "../lib/libraryPaths";
import type { PreviousNoteJump } from "../lib/noteNavigationHistory";
import {
  useGeneratedResource,
  validateNoteContent,
} from "../lib/generatedData";
import { formatLocalDateKey } from "../lib/calendarDate";
import { calculateReadingProgress } from "../lib/readingProgress";
import type { CalendarEvent, Heading, Note } from "../types";
import { NoteMarkdown } from "./NoteMarkdown";
import { NoteSidebar } from "./note-sidebar/NoteSidebar";
import { ContextMenuTarget } from "../features/context_menu/CastleContextMenu";
import { createNoteContextMenu } from "../features/context_menu/context_menu_models";
import { useNoteEditorSession } from "../features/records/useNoteEditorSession";
import { builtInDocumentForFallbackNote } from "../lib/builtInDocuments";
import { NoteEditingSurface } from "./note_source_editor";
import {
  markdownBodyFromSource,
  markdownHeadings,
} from "@castle/content";

interface NotePageProps {
  events: CalendarEvent[];
  notes: Note[];
  notesByRoute: Map<string, Note>;
  onNavigateHistory: (historyIndex: number) => void;
  onTogglePin: (noteId: string) => void;
  pinnedNoteIds: ReadonlySet<string>;
  previousNoteJumps: Array<PreviousNoteJump & { note: Note }>;
}

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const eventTemporalStatusLabels = {
  past: "Past",
  today: "Today",
  upcoming: "Upcoming",
} as const;

type EventTemporalStatus = keyof typeof eventTemporalStatusLabels;
const emptyHeadings: Heading[] = [];

export function NotePage({
  events,
  notes,
  notesByRoute,
  onNavigateHistory,
  onTogglePin,
  pinnedNoteIds,
  previousNoteJumps,
}: NotePageProps) {
  const location = useLocation();
  const noteBodyRef = useRef<HTMLDivElement>(null);
  const route = location.pathname.replace(/\/$/, "");
  const note = notesByRoute.get(route);
  const builtInDocument = builtInDocumentForFallbackNote(note);
  const [activeHeading, setActiveHeading] = useState("");
  const [noteSidebarOpen, setNoteSidebarOpen] = useState(
    () => !window.matchMedia("(max-width: 760px)").matches,
  );
  const generatedNoteContent = useGeneratedResource(
    builtInDocument ? null : note?.contentPath ?? null,
    validateNoteContent,
    "Note content",
  );
  const noteContent = builtInDocument?.noteContent ?? generatedNoteContent.data;
  const loadError = builtInDocument ? null : generatedNoteContent.error;
  const reload = generatedNoteContent.reload;
  const [optimisticSource, setOptimisticSource] = useState<{
    markdown: string;
    previousContentPath: string;
    route: string;
  } | null>(null);
  const handleSourceSaved = useCallback(
    (markdown: string) => {
      setOptimisticSource({
        markdown,
        previousContentPath: note?.contentPath ?? "",
        route,
      });
    },
    [note?.contentPath, route],
  );
  const {
    canEdit,
    close: closeEditor,
    dirty: editorDirty,
    document: editorDocument,
    draft: editorDraft,
    error: editorError,
    finish: finishEditing,
    load: loadEditorSource,
    open: editorOpen,
    reload: reloadEditorSource,
    setDraft: setEditorDraft,
    status: editorStatus,
  } = useNoteEditorSession(
    note,
    route,
    builtInDocument,
    handleSourceSaved,
  );
  const optimisticMarkdown = useMemo(
    () =>
      !editorOpen && optimisticSource?.route === route
        ? markdownBodyFromSource(optimisticSource.markdown)
        : null,
    [editorOpen, optimisticSource, route],
  );
  const displayedMarkdown = optimisticMarkdown ?? noteContent?.content ?? "";
  const headings = useMemo(
    () =>
      optimisticMarkdown === null
        ? noteContent?.headings ?? emptyHeadings
        : markdownHeadings(optimisticMarkdown),
    [noteContent?.headings, optimisticMarkdown],
  );
  const folderNotes = useMemo(
    () =>
      note
        ? notes
            .filter(
              (candidate) =>
                candidate.section === note.section &&
                isSameDirectory(
                  getNoteDirectory(candidate),
                  getNoteDirectory(note),
                ),
            )
            .sort((left, right) => left.title.localeCompare(right.title))
        : [],
    [note, notes],
  );
  const noteIndex = note
    ? folderNotes.findIndex((candidate) => candidate.id === note.id)
    : -1;
  const previous = noteIndex > 0 ? folderNotes[noteIndex - 1] : undefined;
  const next =
    noteIndex >= 0 && noteIndex < folderNotes.length - 1
      ? folderNotes[noteIndex + 1]
      : undefined;
  const handleHeadingClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, headingId: string) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      if (!scrollToHeading(headingId)) return;

      event.preventDefault();
      event.currentTarget.closest("details")?.removeAttribute("open");
      const nextHash = `#${encodeURIComponent(headingId)}`;
      if (window.location.hash !== nextHash) {
        window.history.pushState(null, "", nextHash);
      }
      setActiveHeading(headingId);
    },
    [],
  );
  const handleSidebarHeadingClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, headingId: string) => {
      handleHeadingClick(event, headingId);
      if (
        event.defaultPrevented &&
        window.matchMedia("(max-width: 760px)").matches
      ) {
        setNoteSidebarOpen(false);
      }
    },
    [handleHeadingClick],
  );
  const notesById = useMemo(
    () => new Map(notes.map((candidate) => [candidate.id, candidate])),
    [notes],
  );
  const backlinks = useMemo(
    () =>
      noteContent
        ? noteContent.backlinks.flatMap((backlink) => {
            const sourceNote = notesById.get(backlink.sourceNoteId);
            return sourceNote
              ? [{ note: sourceNote, occurrences: backlink.occurrences }]
              : [];
          })
        : [],
    [noteContent, notesById],
  );
  const relatedEvents = useMemo(() => {
    if (!note || note.section !== "people") return [];

    return events
      .filter((event) =>
        event.people.some((person) => person.noteId === note.id),
      )
      .sort(
        (left, right) =>
          right.date.localeCompare(left.date) ||
          right.startTime.localeCompare(left.startTime) ||
          right.title.localeCompare(left.title),
      )
      .slice(0, 5);
  }, [events, note]);

  useEffect(() => {
    const scrollContainer = document.querySelector(".page-content");
    if (scrollContainer instanceof HTMLElement) scrollContainer.scrollTop = 0;
  }, [route]);

  useEffect(() => setOptimisticSource(null), [route]);

  useEffect(() => {
    if (
      !optimisticSource ||
      builtInDocument ||
      !note?.contentPath ||
      note.contentPath === optimisticSource.previousContentPath ||
      generatedNoteContent.resolvedPath !== note.contentPath
    ) {
      return;
    }
    setOptimisticSource(null);
  }, [
    builtInDocument,
    generatedNoteContent.resolvedPath,
    note?.contentPath,
    optimisticSource,
  ]);

  useEffect(() => {
    const narrowViewport = window.matchMedia("(max-width: 760px)");
    const syncSidebar = () => setNoteSidebarOpen(!narrowViewport.matches);

    narrowViewport.addEventListener("change", syncSidebar);
    return () => narrowViewport.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(max-width: 760px)").matches) {
      setNoteSidebarOpen(false);
    }
  }, [route]);

  useEffect(() => {
    if (
      !noteSidebarOpen ||
      !window.matchMedia("(max-width: 760px)").matches
    ) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setNoteSidebarOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [noteSidebarOpen]);

  useEffect(() => {
    if ((!noteContent && optimisticMarkdown === null) || !location.hash) return;

    const fragmentId = decodeHash(location.hash);
    const animationFrame = window.requestAnimationFrame(() => {
      if (!scrollToFragment(fragmentId)) return;
      if (headings.some((heading) => heading.id === fragmentId)) {
        setActiveHeading(fragmentId);
      }
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [headings, location.hash, noteContent, optimisticMarkdown]);

  useEffect(() => {
    if (headings.length === 0) return;

    const headingElements = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((heading): heading is HTMLElement => Boolean(heading));

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (left, right) =>
              left.boundingClientRect.top - right.boundingClientRect.top,
          );
        if (visible[0]?.target.id) setActiveHeading(visible[0].target.id);
      },
      { rootMargin: "-72px 0px -72% 0px", threshold: [0, 1] },
    );

    headingElements.forEach((heading) => observer.observe(heading));
    setActiveHeading(headings[0]?.id ?? "");
    return () => observer.disconnect();
  }, [headings]);

  if (!note) {
    return (
      <div className="missing-note">
        <Icon icon="document" size={32} />
        <h1>Note not found</h1>
        <p>The note may have moved or its source file may no longer exist.</p>
        <Link to="/">Return to the library</Link>
      </div>
    );
  }

  return (
    <>
      <WorkspacePortal slot="topbar">
        <NoteToolbar
          canEdit={canEdit}
          editorDirty={editorDirty}
          editorError={editorError}
          editorStatus={editorStatus}
          editing={editorOpen}
          hasConnections={backlinks.length > 0}
          isPinned={pinnedNoteIds.has(note.id)}
          next={next}
          note={note}
          noteBodyRef={noteBodyRef}
          noteMarkdown={displayedMarkdown}
          noteReady={Boolean(noteContent) || optimisticMarkdown !== null}
          noteSidebarOpen={noteSidebarOpen}
          onToggleNoteSidebar={() => setNoteSidebarOpen((open) => !open)}
          onNavigateHistory={onNavigateHistory}
          onTogglePin={() => onTogglePin(note.id)}
          onEdit={() => void loadEditorSource()}
          onFinishEdit={finishEditing}
          previous={previous}
          previousNoteJumps={previousNoteJumps}
        />
      </WorkspacePortal>

      <WorkspacePortal slot="main-overlay">
        <NoteSidebar
          activeHeading={activeHeading}
          backlinks={backlinks}
          headings={headings}
          note={note}
          open={noteSidebarOpen}
          onClose={() => setNoteSidebarOpen(false)}
          onHeadingClick={handleSidebarHeadingClick}
        />
      </WorkspacePortal>

      <div className="reading-layout">
        <main className="reading-main">
          <ContextMenuTarget
            menu={
              builtInDocument
                ? undefined
                : createNoteContextMenu(note, "Note", {
                    onEdit:
                      canEdit && !editorOpen
                        ? () => void loadEditorSource()
                        : undefined,
                  })
            }
          >
            <article
              className="markdown-article"
              onClick={(event) => {
                if (
                  event.detail !== 3 ||
                  editorOpen ||
                  !canEdit ||
                  (event.target as Element).closest(
                    "a, button, input, textarea, select, summary",
                  )
                ) {
                  return;
                }
                event.preventDefault();
                void loadEditorSource();
              }}
              tabIndex={0}
            >
              <header className="article-header">
                <h1>{note.title}</h1>
                <div className="article-metadata">
                  {builtInDocument ? (
                    <span>Built into Castle</span>
                  ) : (
                    <time dateTime={note.modifiedAt}>
                      Updated {formatDate(note.modifiedAt)}
                    </time>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>
                    {note.wordCount > 0
                      ? `${note.wordCount.toLocaleString()} words · ${note.readingMinutes} min read`
                      : "Empty note"}
                  </span>
                  {note.status ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="article-status">{note.status}</span>
                    </>
                  ) : null}
                </div>
                {note.tags.length > 0 ? (
                  <div className="article-tags" aria-label="Tags">
                    {note.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                ) : null}
              </header>

              {editorOpen ? (
                editorDocument ? (
                  <NoteEditingSurface
                    draft={editorDraft}
                    error={editorError}
                    note={note}
                    onChange={setEditorDraft}
                    onReload={reloadEditorSource}
                  />
                ) : (
                  <div className="article-empty article-error">
                    <Icon
                      icon={
                        editorStatus === "loading" ? "refresh" : "warning-sign"
                      }
                      size={22}
                    />
                    <div>
                      <p>
                        {editorStatus === "loading"
                          ? "Opening the original Markdown…"
                          : editorError ||
                            "The source file could not be opened."}
                      </p>
                      <div className="article-error-actions">
                        {editorStatus !== "loading" ? (
                          <button
                            type="button"
                            onClick={() => void loadEditorSource()}
                          >
                            Try again
                          </button>
                        ) : null}
                        <button type="button" onClick={closeEditor}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )
              ) : !noteContent && optimisticMarkdown === null && !loadError ? (
                <div className="article-loading" role="status">
                  <span />
                  <span />
                  <span />
                  <p>Loading note…</p>
                </div>
              ) : loadError && optimisticMarkdown === null ? (
                <div className="article-empty article-error">
                  <Icon icon="warning-sign" size={22} />
                  <div>
                    <p>The note content could not be loaded.</p>
                    <button type="button" onClick={reload}>
                      Try again
                    </button>
                  </div>
                </div>
              ) : displayedMarkdown ? (
                <div className="article-body" ref={noteBodyRef}>
                  <NoteMarkdown
                    content={displayedMarkdown}
                    note={note}
                    notes={notes}
                    headings={headings}
                  />
                </div>
              ) : (
                <div className="article-empty">
                  <Icon icon="document" size={22} />
                  <p>This note does not have any body content yet.</p>
                </div>
              )}
            </article>
          </ContextMenuTarget>

          {editorOpen ? null : <RelatedEvents events={relatedEvents} />}
        </main>
      </div>
    </>
  );
}

function NoteToolbar({
  canEdit,
  editorDirty,
  editorError,
  editorStatus,
  editing,
  hasConnections,
  isPinned,
  next,
  note,
  noteBodyRef,
  noteMarkdown,
  noteReady,
  noteSidebarOpen,
  onNavigateHistory,
  onTogglePin,
  onEdit,
  onFinishEdit,
  onToggleNoteSidebar,
  previous,
  previousNoteJumps,
}: {
  canEdit: boolean;
  editorDirty: boolean;
  editorError: string;
  editorStatus: "idle" | "loading" | "ready" | "saving";
  editing: boolean;
  hasConnections: boolean;
  isPinned: boolean;
  next?: Note;
  note: Note;
  noteBodyRef: RefObject<HTMLDivElement>;
  noteMarkdown: string;
  noteReady: boolean;
  noteSidebarOpen: boolean;
  onNavigateHistory: (historyIndex: number) => void;
  onTogglePin: () => void;
  onEdit: () => void;
  onFinishEdit: () => void;
  onToggleNoteSidebar: () => void;
  previous?: Note;
  previousNoteJumps: Array<PreviousNoteJump & { note: Note }>;
}) {
  const [copied, setCopied] = useState<"link" | "note" | "markdown" | null>(
    null,
  );
  const copyMenuRef = useRef<HTMLDetailsElement>(null);
  const copyResetTimer = useRef<number | undefined>(undefined);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    const scrollContainer = document.querySelector<HTMLElement>(".page-content");
    if (!toolbar || !scrollContainer) return;

    let animationFrame = 0;
    const updateProgress = () => {
      if (animationFrame) return;

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        const progress = calculateReadingProgress(scrollContainer);

        toolbar.toggleAttribute("data-scrollable", progress !== null);
        toolbar.style.setProperty(
          "--reading-progress",
          String(progress ?? 0),
        );
      });
    };

    updateProgress();
    scrollContainer.addEventListener("scroll", updateProgress, {
      passive: true,
    });

    const resizeObserver = new ResizeObserver(updateProgress);
    resizeObserver.observe(scrollContainer);
    const readingLayout = scrollContainer.querySelector(".reading-layout");
    if (readingLayout) resizeObserver.observe(readingLayout);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      scrollContainer.removeEventListener("scroll", updateProgress);
      toolbar.removeAttribute("data-scrollable");
      toolbar.style.removeProperty("--reading-progress");
    };
  }, [note.route, noteReady]);

  useEffect(() => {
    setCopied(null);
    copyMenuRef.current?.removeAttribute("open");
    return () => window.clearTimeout(copyResetTimer.current);
  }, [note.route]);

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      const menu = copyMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) {
        menu.removeAttribute("open");
      }
    };

    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, []);

  const copy = async (kind: "link" | "note" | "markdown") => {
    const renderedBody = noteBodyRef.current?.innerText.trim() ?? "";
    const value =
      kind === "link"
        ? window.location.href
        : kind === "markdown"
          ? noteMarkdown
          : [note.title, renderedBody].filter(Boolean).join("\n\n");

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }

    copyMenuRef.current?.removeAttribute("open");
    window.clearTimeout(copyResetTimer.current);
    setCopied(kind);
    copyResetTimer.current = window.setTimeout(() => setCopied(null), 1800);
  };

  return (
    <div
      className="note-toolbar"
      ref={toolbarRef}
      role="toolbar"
      aria-label="Note actions"
    >
      <nav
        aria-disabled={editing}
        aria-label="Note navigation"
        className="note-toolbar-navigation"
        onClickCapture={(event) => {
          if (editing) event.preventDefault();
        }}
      >
        <NoteHistoryMenu
          jumps={previousNoteJumps}
          onNavigate={onNavigateHistory}
        />
        {previous ? (
          <Link
            className="note-toolbar-icon"
            to={previous.route}
            aria-label={`Previous note: ${previous.title}`}
            title={`Previous: ${previous.title}`}
          >
            <Icon icon="chevron-left" aria-hidden="true" />
          </Link>
        ) : (
          <span className="note-toolbar-icon disabled" aria-hidden="true">
            <Icon icon="chevron-left" />
          </span>
        )}
        {next ? (
          <Link
            className="note-toolbar-icon"
            to={next.route}
            aria-label={`Next note: ${next.title}`}
            title={`Next: ${next.title}`}
          >
            <Icon icon="chevron-right" aria-hidden="true" />
          </Link>
        ) : (
          <span className="note-toolbar-icon disabled" aria-hidden="true">
            <Icon icon="chevron-right" />
          </span>
        )}
      </nav>

      <div className="note-toolbar-actions">
        <button
          aria-label={isPinned ? "Unpin note" : "Pin note"}
          aria-pressed={isPinned}
          className={`note-toolbar-sidebar-toggle note-toolbar-pin${
            isPinned ? " is-pinned" : ""
          }`}
          onClick={onTogglePin}
          title={isPinned ? "Remove from Pinned" : "Add to Pinned"}
          type="button"
        >
          <Icon icon="pin" aria-hidden="true" />
          <span className="note-toolbar-action-label">
            {isPinned ? "Pinned" : "Pin"}
          </span>
        </button>
        {canEdit && editing ? (
          <>
            <span
              className="note-toolbar-save-status"
              data-state={editorError ? "error" : editorStatus}
              title={editorError || undefined}
            >
              {editorError
                ? "Save failed"
                : editorStatus === "loading"
                  ? "Opening…"
                  : editorStatus === "saving"
                    ? "Saving…"
                    : editorDirty
                      ? "Auto-saving…"
                      : "Saved"}
            </span>
            <button
              aria-label="View rendered note"
              className="note-toolbar-sidebar-toggle note-toolbar-view"
              disabled={editorStatus === "loading"}
              onClick={onFinishEdit}
              title="View note"
              type="button"
            >
              <Icon icon="eye-open" aria-hidden="true" />
              <span className="note-toolbar-action-label">View</span>
            </button>
          </>
        ) : canEdit ? (
          <button
            className="note-toolbar-sidebar-toggle note-toolbar-edit"
            onClick={onEdit}
            title="Edit note"
            type="button"
          >
            <Icon icon="edit" aria-hidden="true" />
            <span className="note-toolbar-action-label">Edit</span>
          </button>
        ) : null}
        {editing ? null : (
          <details
            className={
              copied
                ? "note-toolbar-copy-menu copied"
                : "note-toolbar-copy-menu"
            }
            ref={copyMenuRef}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              copyMenuRef.current?.removeAttribute("open");
              copyMenuRef.current?.querySelector("summary")?.focus();
            }}
          >
            <summary
              aria-label={copied ? "Copied" : "Copy note options"}
              title={copied ? "Copied" : "Copy"}
            >
              <Icon icon={copied ? "tick" : "clipboard"} aria-hidden="true" />
              <span className="note-toolbar-action-label">
                {copied ? "Copied" : "Copy"}
              </span>
              <Icon
                className="note-toolbar-caret"
                icon="caret-down"
                aria-hidden="true"
              />
            </summary>
            <div className="note-toolbar-copy-options" role="menu">
              <button type="button" role="menuitem" onClick={() => copy("link")}>
                <Icon icon="link" aria-hidden="true" />
                <span>Copy link</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!noteReady}
                onClick={() => copy("note")}
              >
                <Icon icon="document" aria-hidden="true" />
                <span>Copy note</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!noteReady}
                onClick={() => copy("markdown")}
              >
                <Icon icon="markdown" aria-hidden="true" />
                <span>Copy Markdown</span>
              </button>
            </div>
          </details>
        )}

        <button
          aria-controls="note-context-sidebar"
          aria-expanded={noteSidebarOpen}
          aria-label={`${noteSidebarOpen ? "Close" : "Open"} note details`}
          className={`note-toolbar-sidebar-toggle${
            note.sidebar ? " has-note-module" : ""
          }${hasConnections ? " has-connections" : ""}`}
          title={`${noteSidebarOpen ? "Close" : "Open"} note details`}
          type="button"
          onClick={onToggleNoteSidebar}
        >
          <Icon icon="panel-stats" aria-hidden="true" />
          <span className="note-toolbar-action-label">Details</span>
        </button>
      </div>
    </div>
  );
}

function NoteHistoryMenu({
  jumps,
  onNavigate,
}: {
  jumps: Array<PreviousNoteJump & { note: Note }>;
  onNavigate: (historyIndex: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const suppressFocusOpen = useRef(false);
  const previousJump = jumps[0];

  const openMenu = () => {
    if (suppressFocusOpen.current) return;
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    if (previousJump) setOpen(true);
  };
  const openMenuAfterHover = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    if (!previousJump) return;

    openTimer.current = window.setTimeout(() => setOpen(true), 500);
  };
  const closeMenuSoon = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  const navigateToJump = (historyIndex: number) => {
    setOpen(false);
    onNavigate(historyIndex);
  };

  useEffect(() => {
    return () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <div
      className={`note-history-menu${open ? " open" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onFocus={openMenu}
      onMouseEnter={openMenuAfterHover}
      onMouseLeave={closeMenuSoon}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        suppressFocusOpen.current = true;
        setOpen(false);
        event.currentTarget.querySelector<HTMLButtonElement>(
          ".note-toolbar-back",
        )?.focus();
        queueMicrotask(() => {
          suppressFocusOpen.current = false;
        });
      }}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          previousJump
            ? `Back to previous note: ${previousJump.note.title}`
            : "No previous note"
        }
        className="note-toolbar-icon note-toolbar-back"
        disabled={!previousJump}
        onClick={() => {
          if (previousJump) navigateToJump(previousJump.historyIndex);
        }}
        title={
          previousJump
            ? `Back to ${previousJump.note.title}`
            : "No previous note"
        }
        type="button"
      >
        <Icon icon="arrow-left" aria-hidden="true" />
      </button>

      {open && previousJump ? (
        <div
          aria-label="Previous note jumps"
          className="view-settings-popover note-history-popover"
          role="menu"
        >
          <header className="view-settings-header">
            <span>Note history</span>
            <small>Recent jumps</small>
          </header>
          <section aria-labelledby="note-history-heading">
            <h2 id="note-history-heading">Previous notes</h2>
            {jumps.map((jump, index) => (
              <button
                className="view-settings-toggle note-history-item"
                key={`${jump.historyIndex}-${jump.route}`}
                onClick={() => navigateToJump(jump.historyIndex)}
                role="menuitem"
                type="button"
              >
                <Icon
                  icon={index === 0 ? "arrow-left" : "document"}
                  aria-hidden="true"
                />
                <span className="view-settings-toggle-copy">
                  <strong>{jump.note.title}</strong>
                  <small>{jump.note.sectionLabel}</small>
                </span>
              </button>
            ))}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function RelatedEvents({ events }: { events: CalendarEvent[] }) {
  if (events.length === 0) return null;
  const today = formatLocalDateKey(new Date());

  return (
    <section
      className="person-related-events"
      aria-labelledby="related-events-title"
    >
      <div className="note-connections-heading">
        <span>Calendar</span>
        <h2 id="related-events-title">Related events</h2>
      </div>
      <ul>
        {events.map((event) => {
          const temporalStatus = getEventTemporalStatus(event.date, today);

          return (
            <li key={event.id}>
              <Link to={`/calendar?date=${event.date}`}>
                <time dateTime={`${event.date}T${event.startTime}`}>
                  <span>{formatCalendarEventDate(event.date)}</span>
                  <small>{formatCalendarEventTime(event)}</small>
                </time>
                <span>
                  <span className="person-related-event-heading">
                    <strong>{event.title}</strong>
                    <span
                      className={[
                        "person-related-event-status",
                        `person-related-event-status--${temporalStatus}`,
                      ].join(" ")}
                    >
                      {eventTemporalStatusLabels[temporalStatus]}
                    </span>
                  </span>
                  <small>{event.description || event.kind}</small>
                </span>
                <Icon icon="arrow-right" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function scrollToHeading(headingId: string) {
  return scrollToFragment(headingId);
}

function scrollToFragment(fragmentId: string) {
  const target = document.getElementById(fragmentId);
  if (!target) return false;

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  target.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: target.matches(".backlink-occurrence") ? "center" : "start",
  });
  if (target instanceof HTMLElement && target.matches(".backlink-occurrence")) {
    target.focus({ preventScroll: true });
  }
  return true;
}

function decodeHash(hash: string) {
  try {
    return decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return hash.replace(/^#/, "");
  }
}

function formatDate(value: string) {
  return shortDateFormatter.format(new Date(value));
}

function formatCalendarEventDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return shortDateFormatter.format(new Date(year, month - 1, day));
}

function formatCalendarEventTime(event: CalendarEvent) {
  return event.endTime
    ? `${event.startTime}–${event.endTime}${event.endDate ? ` · ends ${event.endDate}` : ""}`
    : event.startTime;
}

function getEventTemporalStatus(
  eventDate: string,
  today: string,
): EventTemporalStatus {
  if (eventDate < today) return "past";
  if (eventDate > today) return "upcoming";
  return "today";
}
