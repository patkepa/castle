import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "@patkepa/kantzen-ui/primitives";
import { Command } from "@patkepa/kantzen-ui/command-palette";
import {
  createSearchFolders,
  getMatchSegments,
  MAX_SEARCH_RESULTS,
  rankFolders,
  rankPages,
  type RankedSearchResult,
  type RankedNote,
  type SearchableNote,
  type SearchFolder,
} from "../lib/noteSearch";
import {
  APP_SEARCH_PAGES,
  type AppSearchPage,
} from "../lib/appSearchPages";
import type { Note, SectionSummary } from "../types";
import { useCastlePlatform } from "../platform/castle_platform_provider";
import type { CastleKnowledgeQueries } from "../platform/knowledge_queries";
import { recordSearchShadowComparison } from "../lib/searchShadowDiagnostics";
import {
  rankCastleActions,
  readRecentCastleActionIds,
  recordRecentCastleAction,
  type CastlePaletteAction,
} from "../features/castle_actions/castleActionModels";

interface NoteSearchPaletteProps {
  actions: readonly CastlePaletteAction[];
  notes: Note[];
  sections: SectionSummary[];
  recentNotes: Note[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectNote: (note: Note) => void;
  onSelectRoute: (route: string) => void;
}

export function NoteSearchPalette({
  actions,
  notes,
  sections,
  recentNotes,
  open,
  onOpenChange,
  onSelectNote,
  onSelectRoute,
}: NoteSearchPaletteProps) {
  const platform = useCastlePlatform();
  const [query, setQuery] = useState("");
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [recentActionIds, setRecentActionIds] = useState(
    readRecentCastleActionIds,
  );
  const activeAction = activeActionId
    ? actions.find((action) => action.id === activeActionId) ?? null
    : null;
  const searchQuery = activeAction ? "" : query;
  const deferredQuery = useDeferredValue(searchQuery.trim());
  const rankedPageResults = useMemo(
    () => rankPages(searchQuery, APP_SEARCH_PAGES),
    [searchQuery],
  );
  const notesById = useMemo(
    () => new Map(notes.map((note) => [note.id, note])),
    [notes],
  );
  const workerSearch = useWorkerNoteSearch(
    deferredQuery,
    notes,
    notesById,
  );
  const desktopSearch = useDesktopNoteSearch(
    deferredQuery,
    notesById,
    platform.knowledgeQueries,
  );
  const lastComparedQuery = useRef<string | null>(null);
  useEffect(() => {
    if (!deferredQuery) {
      lastComparedQuery.current = null;
      return;
    }
    if (
      !platform.knowledgeQueries ||
      desktopSearch.completedQuery !== deferredQuery ||
      workerSearch.completedQuery !== deferredQuery ||
      lastComparedQuery.current === deferredQuery
    ) {
      return;
    }
    recordSearchShadowComparison({
      desktopResultIds: desktopSearch.rankedResults.map(({ note }) => note.id),
      browserResultIds: workerSearch.rankedResults.map(({ note }) => note.id),
      desktopFailed: Boolean(desktopSearch.error),
      browserFailed: Boolean(workerSearch.error),
    });
    lastComparedQuery.current = deferredQuery;
  }, [
    deferredQuery,
    desktopSearch.completedQuery,
    desktopSearch.error,
    desktopSearch.rankedResults,
    platform.knowledgeQueries,
    workerSearch.completedQuery,
    workerSearch.error,
    workerSearch.rankedResults,
  ]);
  const { backendLabel, error, loading, rankedResults } =
    platform.knowledgeQueries && !desktopSearch.error
      ? desktopSearch
      : workerSearch;
  const searchFolders = useMemo(
    () => createSearchFolders(notes, sections),
    [notes, sections],
  );
  const topLevelFolders = useMemo(
    () => searchFolders.filter((folder) => folder.directory.length === 0),
    [searchFolders],
  );

  useEffect(() => {
    if (open) return;
    setQuery("");
    setActiveActionId(null);
    setActionError("");
  }, [open]);

  const rankedActions = useMemo(
    () => rankCastleActions(searchQuery, actions),
    [actions, searchQuery],
  );
  const recentActions = useMemo(() => {
    if (searchQuery.trim()) return [];
    const actionsById = new Map(actions.map((action) => [action.id, action]));
    return recentActionIds.flatMap((actionId) => {
      const action = actionsById.get(actionId);
      return action ? [action] : [];
    });
  }, [actions, recentActionIds, searchQuery]);
  const recentActionIdSet = useMemo(
    () => new Set(recentActions.map((action) => action.id)),
    [recentActions],
  );
  const suggestedActions = searchQuery.trim()
    ? rankedActions
    : rankedActions.filter((action) => !recentActionIdSet.has(action.id));

  const runAction = async (action: CastlePaletteAction, input = "") => {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError("");
    try {
      await action.execute(input.trim());
      setRecentActionIds((current) =>
        recordRecentCastleAction(action.id, current)
      );
      onOpenChange(false);
    } catch (reason) {
      setActionError(actionFailureMessage(reason));
    } finally {
      setActionBusy(false);
    }
  };

  const selectAction = (action: CastlePaletteAction) => {
    setActionError("");
    if (action.input) {
      setActiveActionId(action.id);
      setQuery("");
      setActionError("");
      return;
    }
    void runAction(action);
  };

  const rankedFolderResults = useMemo(
    () =>
      deferredQuery ? rankFolders(deferredQuery, searchFolders) : [],
    [deferredQuery, searchFolders],
  );
  const displayFolders = deferredQuery
    ? rankedFolderResults
        .slice(0, MAX_SEARCH_RESULTS)
        .map(({ folder }) => folder)
    : topLevelFolders;
  const remainingResultSlots = Math.max(
    0,
    MAX_SEARCH_RESULTS - displayFolders.length,
  );
  const displayNotes = deferredQuery
    ? rankedResults.slice(0, remainingResultSlots)
    : recentNotes.slice(0, 6).map<RankedNote>((note) => ({
        note,
        reason: "Recently updated",
        snippet: note.excerpt,
        score: 0,
      }));
  const matchCount = displayFolders.length + displayNotes.length;
  const totalMatchCount =
    rankedPageResults.length + matchCount + rankedActions.length;
  const isWaitingForIndex =
    Boolean(deferredQuery) && loading;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Castle Actions"
      loop
      shouldFilter={false}
    >
      <div className="cmdk-input-wrapper">
        {activeAction ? (
          <button
            aria-label="Back to Castle Actions"
            className="palette-action-back"
            disabled={actionBusy}
            onClick={() => {
              setActiveActionId(null);
              setQuery("");
              setActionError("");
            }}
            type="button"
          >
            <Icon icon="arrow-left" size={14} />
          </button>
        ) : (
          <Icon icon="search" size={16} />
        )}
        <Command.Input
          value={query}
          onValueChange={(value) => {
            setQuery(value);
            setActionError("");
          }}
          placeholder={
            activeAction?.input?.placeholder ??
            "Search Castle or run an action..."
          }
          aria-label={activeAction?.input?.label ?? "Search Castle Actions"}
        />
        <kbd className="cmdk-kbd">ESC</kbd>
      </div>
      <Command.List aria-busy={isWaitingForIndex}>
        {activeAction?.input ? (
          <Command.Group heading={activeAction.label}>
            <Command.Item
              disabled={actionBusy || !query.trim()}
              onSelect={() => void runAction(activeAction, query)}
              value={`action-submit:${activeAction.id}`}
            >
              <span className="palette-note-icon" aria-hidden="true">
                <Icon icon={activeAction.icon} size={14} />
              </span>
              <span className="palette-note-copy">
                <strong>
                  {actionBusy ? "Working…" : activeAction.input.submitLabel}
                </strong>
                <span>{activeAction.description}</span>
              </span>
            </Command.Item>
            {actionError ? (
              <div className="palette-action-error" role="alert">
                <Icon icon="warning-sign" size={13} />
                {actionError}
              </div>
            ) : null}
          </Command.Group>
        ) : (
          <>
        {recentActions.length > 0 ? (
          <Command.Group heading="Recently used">
            {recentActions.map((action) => (
              <ActionResult
                action={action}
                key={`recent:${action.id}`}
                onSelect={selectAction}
              />
            ))}
          </Command.Group>
        ) : null}
        {suggestedActions.length > 0 ? (
          <Command.Group heading={deferredQuery ? "Castle Actions" : "Actions"}>
            {suggestedActions.map((action) => (
              <ActionResult
                action={action}
                key={action.id}
                onSelect={selectAction}
              />
            ))}
          </Command.Group>
        ) : null}
        {actionError ? (
          <div className="palette-action-error" role="alert">
            <Icon icon="warning-sign" size={13} />
            {actionError}
          </div>
        ) : null}
        {deferredQuery && !isWaitingForIndex && !error && backendLabel ? (
          <div className="palette-search-source" role="status">
            {backendLabel}
          </div>
        ) : null}
        {rankedPageResults.length > 0 ? (
          <Command.Group heading="Quick navigation">
            {rankedPageResults.map(({ page }) => (
              <PageResult
                key={page.id}
                page={page}
                query={query.trim()}
                onSelect={onSelectRoute}
              />
            ))}
          </Command.Group>
        ) : null}
        {isWaitingForIndex ? (
          <div className="palette-state" role="status">
            <Icon icon="refresh" />
            Loading content results…
          </div>
        ) : error ? (
          <div className="palette-state palette-state--error" role="alert">
            <Icon icon="warning-sign" />
            Content search could not be loaded. Quick navigation is still
            available, along with Castle Actions.
          </div>
        ) : (
          <>
            {totalMatchCount === 0 ? (
              <div className="palette-state">
                <Icon icon="search" />
                No matching actions, pages, folders, or notes.
              </div>
            ) : null}
            {!deferredQuery || matchCount > 0 ? (
              <Command.Group
                heading={
                  deferredQuery ? contentMatchHeading(matchCount) : "Folders"
                }
              >
                {displayFolders.map((folder) => (
                  <FolderResult
                    key={folder.id}
                    folder={folder}
                    query={deferredQuery}
                    onSelect={onSelectRoute}
                  />
                ))}
                {deferredQuery
                  ? displayNotes.map(({ note, snippet }) => (
                      <NoteResult
                        key={note.id}
                        note={note}
                        query={deferredQuery}
                        snippet={snippet}
                        onSelect={onSelectNote}
                      />
                    ))
                  : null}
              </Command.Group>
            ) : null}
            {!deferredQuery && displayNotes.length > 0 ? (
              <Command.Group heading="Recently updated">
                {displayNotes.map(({ note, snippet }) => (
                  <NoteResult
                    key={note.id}
                    note={note}
                    query=""
                    snippet={snippet}
                    onSelect={onSelectNote}
                  />
                ))}
              </Command.Group>
            ) : null}
          </>
        )}
          </>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

function ActionResult({
  action,
  onSelect,
}: {
  action: CastlePaletteAction;
  onSelect: (action: CastlePaletteAction) => void;
}) {
  return (
    <Command.Item
      onSelect={() => onSelect(action)}
      value={`action:${action.id}`}
    >
      <span className="palette-note-icon palette-action-icon" aria-hidden="true">
        <Icon icon={action.icon} size={14} />
      </span>
      <span className="palette-note-copy">
        <strong>{action.label}</strong>
        <span>{action.description}</span>
      </span>
      {action.input ? (
        <Icon className="palette-action-chevron" icon="chevron-right" size={12} />
      ) : null}
    </Command.Item>
  );
}

function useDesktopNoteSearch(
  query: string,
  notesById: ReadonlyMap<string, Note>,
  knowledgeQueries: CastleKnowledgeQueries | null,
) {
  const latestRequestId = useRef(0);
  const [state, setState] = useState<{
    backendLabel: string | null;
    completedQuery: string | null;
    error: Error | null;
    loading: boolean;
    rankedResults: RankedNote[];
  }>({
    backendLabel: null,
    completedQuery: null,
    error: null,
    loading: false,
    rankedResults: [],
  });

  useEffect(() => {
    const requestId = ++latestRequestId.current;
    if (!query || !knowledgeQueries) {
      setState({
        backendLabel: null,
        completedQuery: null,
        error: null,
        loading: false,
        rankedResults: [],
      });
      return;
    }
    setState((current) => ({
      ...current,
      completedQuery: null,
      error: null,
      loading: true,
    }));
    knowledgeQueries
      .search({ query, mode: "lexical", limit: MAX_SEARCH_RESULTS })
      .then((response) => {
        if (requestId !== latestRequestId.current) return;
        const rankedResults = response.results.flatMap<RankedNote>((result) => {
          const note = notesById.get(result.noteId);
          return note
            ? [
                {
                  note,
                  reason: humanizeSearchReason(result.explanationCodes[0]),
                  snippet: result.excerpt,
                  score: result.finalScore,
                },
              ]
            : [];
        });
        setState({
          backendLabel: `Desktop index · ${response.modeUsed}`,
          completedQuery: query,
          error: null,
          loading: false,
          rankedResults,
        });
      })
      .catch((reason: unknown) => {
        if (requestId !== latestRequestId.current) return;
        setState({
          backendLabel: null,
          completedQuery: query,
          error: reason instanceof Error ? reason : new Error(String(reason)),
          loading: false,
          rankedResults: [],
        });
      });
  }, [knowledgeQueries, notesById, query]);

  return state;
}

function humanizeSearchReason(reason: string | undefined) {
  if (!reason) return "Note content";
  return reason
    .split("_")
    .map((word, index) =>
      index === 0 ? `${word.slice(0, 1).toUpperCase()}${word.slice(1)}` : word,
    )
    .join(" ");
}

function useWorkerNoteSearch(
  query: string,
  notes: readonly Note[],
  notesById: ReadonlyMap<string, Note>,
) {
  const workerRef = useRef<Worker | null>(null);
  const workerNotesRef = useRef<readonly Note[] | null>(null);
  const latestRequestId = useRef(0);
  const latestQuery = useRef("");
  const [state, setState] = useState<{
    completedQuery: string | null;
    error: Error | null;
    loading: boolean;
    results: RankedSearchResult[];
  }>({ completedQuery: null, error: null, loading: false, results: [] });

  useEffect(() => {
    if (!query) {
      latestRequestId.current += 1;
      setState({ completedQuery: null, error: null, loading: false, results: [] });
      return;
    }

    let worker = workerRef.current;
    if (!worker) {
      worker = new Worker(new URL("../workers/noteSearchWorker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<
        | { type: "result"; requestId: number; results: RankedSearchResult[] }
        | { type: "error"; requestId: number; message: string }
      >) => {
        if (event.data.requestId !== latestRequestId.current) return;
        if (event.data.type === "error") {
          setState({
            completedQuery: latestQuery.current,
            error: new Error(event.data.message),
            loading: false,
            results: [],
          });
        } else {
          setState({
            completedQuery: latestQuery.current,
            error: null,
            loading: false,
            results: event.data.results,
          });
        }
      };
      worker.onerror = () => {
        setState({
          completedQuery: latestQuery.current,
          error: new Error("Search worker stopped unexpectedly."),
          loading: false,
          results: [],
        });
      };
    }

    if (workerNotesRef.current !== notes) {
      const searchableNotes: SearchableNote[] = notes.map((note) => ({
        id: note.id,
        title: note.title,
        aliases: note.aliases,
        tags: note.tags,
        relativePath: note.relativePath,
        excerpt: note.excerpt,
        modifiedAt: note.modifiedAt,
      }));
      worker.postMessage({ type: "initialize", notes: searchableNotes });
      workerNotesRef.current = notes;
    }

    const requestId = ++latestRequestId.current;
    latestQuery.current = query;
    setState((current) => ({
      ...current,
      completedQuery: null,
      error: null,
      loading: true,
    }));
    worker.postMessage({ type: "search", query, requestId });
  }, [notes, query]);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  const rankedResults = useMemo<RankedNote[]>(
    () =>
      state.results.flatMap((result) => {
        const note = notesById.get(result.id);
        return note ? [{ ...result, note }] : [];
      }),
    [notesById, state.results],
  );
  return {
    ...state,
    backendLabel:
      query && !state.loading && !state.error ? "Browser search fallback" : null,
    rankedResults,
  };
}

function PageResult({
  page,
  query,
  onSelect,
}: {
  page: AppSearchPage;
  query: string;
  onSelect: (route: string) => void;
}) {
  return (
    <Command.Item
      value={`page:${page.id}`}
      onSelect={() => onSelect(page.route)}
    >
      <span className="palette-note-icon" aria-hidden="true">
        <Icon icon={page.icon} size={14} />
      </span>
      <span className="palette-note-copy">
        <strong>Go to {highlightMatches(page.label, query)}</strong>
        <span>{page.description}</span>
      </span>
    </Command.Item>
  );
}

function FolderResult({
  folder,
  query,
  onSelect,
}: {
  folder: SearchFolder;
  query: string;
  onSelect: (route: string) => void;
}) {
  const parentPath = [
    folder.directory.length > 0 ? folder.sectionLabel : "Library",
    ...folder.directory.slice(0, -1).map(humanize),
  ].join(" / ");

  return (
    <Command.Item
      value={`folder:${folder.id}`}
      onSelect={() => onSelect(folder.route)}
    >
      <span className="palette-note-icon" aria-hidden="true">
        <Icon
          icon={
            folder.directory.length === 0
              ? sectionIcon(folder.section)
              : "folder-close"
          }
          size={14}
        />
      </span>
      <span className="palette-note-copy">
        <strong>{highlightMatches(folder.label, query)}</strong>
        <span>
          {parentPath} · {folder.noteCount}{" "}
          {folder.noteCount === 1 ? "note" : "notes"}
        </span>
      </span>
    </Command.Item>
  );
}

function NoteResult({
  note,
  query,
  snippet,
  onSelect,
}: {
  note: Note;
  query: string;
  snippet: string;
  onSelect: (note: Note) => void;
}) {
  return (
    <Command.Item value={`note:${note.id}`} onSelect={() => onSelect(note)}>
      <span className="palette-note-icon" aria-hidden="true">
        <Icon icon={sectionIcon(note.section)} size={14} />
      </span>
      <span className="palette-note-copy">
        <span className="palette-note-title-row">
          <strong>{highlightMatches(note.title, query)}</strong>
        </span>
        <span>
          {note.sectionLabel} / {humanizePath(note.relativePath)}
        </span>
        {query ? <span className="palette-note-snippet">{snippet}</span> : null}
      </span>
    </Command.Item>
  );
}

function highlightMatches(value: string, query: string) {
  return getMatchSegments(value, query).map((segment, index) =>
    segment.matched ? (
      <mark className="palette-match" key={index}>
        {segment.text}
      </mark>
    ) : (
      segment.text
    ),
  );
}

function contentMatchHeading(count: number) {
  return `${count} content ${count === 1 ? "match" : "matches"}`;
}

function sectionIcon(section: string): IconName {
  if (section === "personal") return "person";
  if (section === "people") return "people";
  if (section === "wiki") return "book";
  if (section === "journal") return "manual";
  if (section === "events") return "timeline-events";
  if (section === "stash") return "inbox";
  if (section === "projects") return "projects";
  if (section === "tasks") return "tick-circle";
  return "document";
}

function humanizePath(value: string) {
  return value
    .replace(/\.mdx?$/i, "")
    .split("/")
    .map(humanize)
    .join(" / ");
}

function humanize(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function actionFailureMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/iu, "")
    .replace(/^Error:\s*/iu, "") || "Castle could not run that action.";
}
