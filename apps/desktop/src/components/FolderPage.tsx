import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@patkepa/kantzen-ui/primitives";
import { EmptyState } from "@patkepa/kantzen-ui";
import { flushSync } from "react-dom";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  createFolderRoute,
  decodeFolderPath,
  getDirectoryContents,
  getNoteDirectory,
  humanizePathSegment,
  isDirectoryPrefix,
  isSameDirectory,
} from "../lib/libraryPaths";
import type { LibraryFolder, Note, SectionSummary } from "../types";
import {
  LibraryViewToggle,
  useLibraryViewMode,
} from "./LibraryViewToggle";
import { LibrarySearch, LibraryToolbar } from "./LibraryToolbar";
import { LibraryBrowser } from "./library_browser";
import { StashList } from "./StashList";
import { StashComposer } from "./StashComposer";
import { ContextMenuTarget } from "../features/context_menu/CastleContextMenu";
import {
  createFolderContentsContextMenu,
  createFolderContextMenu,
  createNoteContextMenu,
} from "../features/context_menu/context_menu_models";
import { useCastlePlatform } from "../platform/castle_platform_provider";
import {
  PlaylistVideoGrid,
  PlaylistView,
} from "../features/playlists/PlaylistView";
import {
  createPlaylistVideos,
  isVideoOnlyPlaylist,
} from "../features/playlists/playlistPresentation";
import { createLibraryNoteSourceInput } from "../features/library/libraryNoteCreation";

interface FolderPageProps {
  folders: LibraryFolder[];
  notes: Note[];
  onTogglePinnedFolder: (route: string) => void;
  pinnedFolderRoutes: ReadonlySet<string>;
  sections: SectionSummary[];
}

export function FolderPage({
  folders,
  notes,
  onTogglePinnedFolder,
  pinnedFolderRoutes,
  sections,
}: FolderPageProps) {
  const { sectionId, "*": folderPath = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [libraryViewMode, setLibraryViewMode] = useLibraryViewMode();
  const [folderViewOverride, setFolderViewOverride] = useState<{
    folderKey: string;
    mode: "list" | "grid";
  } | null>(null);
  const [pendingViewMode, setPendingViewMode] = useState<{
    folderKey: string;
    mode: "list" | "grid" | "playlist";
  } | null>(null);
  const [requestedPlaylistVideo, setRequestedPlaylistVideo] = useState<{
    folderKey: string;
    videoId: string;
  } | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(null);
  const reservedSourceFiles = useRef(new Set<string>());
  const platform = useCastlePlatform();
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const isStash = sectionId === "stash";
  const isStashRoot = isStash && folderPath.length === 0;
  const folderKey = `${sectionId ?? ""}/${folderPath}`;
  const section = sections.find((candidate) => candidate.id === sectionId);
  const directory = useMemo(
    () => decodeFolderPath(folderPath),
    [folderPath],
  );
  const sectionNotes = useMemo(
    () => notes.filter((note) => note.section === sectionId),
    [notes, sectionId],
  );
  const sectionFolders = useMemo(
    () => folders.filter((folder) => folder.sectionId === sectionId),
    [folders, sectionId],
  );
  const directoryContents = useMemo(
    () => getDirectoryContents(sectionNotes, directory, sectionFolders),
    [directory, sectionFolders, sectionNotes],
  );
  const filteredFolders = useMemo(
    () =>
      directoryContents.folders.filter((folder) =>
        humanizePathSegment(folder.name)
          .toLocaleLowerCase()
          .includes(deferredQuery),
      ),
    [deferredQuery, directoryContents.folders],
  );
  const filteredNotes = useMemo(
    () =>
      directoryContents.notes.filter(
        (note) =>
          !deferredQuery || catalogSearchText(note).includes(deferredQuery),
      ),
    [deferredQuery, directoryContents.notes],
  );
  const playlistVideos = useMemo(
    () => createPlaylistVideos(directoryContents.notes),
    [directoryContents.notes],
  );
  const filteredPlaylistVideos = useMemo(
    () => createPlaylistVideos(filteredNotes),
    [filteredNotes],
  );
  const filteredPlaylistVideoIds = useMemo(
    () => new Set(filteredPlaylistVideos.map((video) => video.id)),
    [filteredPlaylistVideos],
  );

  useEffect(() => {
    const currentSourceFiles = new Set(notes.map((note) => note.sourceFile));
    for (const sourceFile of reservedSourceFiles.current) {
      if (currentSourceFiles.has(sourceFile)) {
        reservedSourceFiles.current.delete(sourceFile);
      }
    }
  }, [notes]);
  const playlistAvailable = !isStash && playlistVideos.length > 0;
  const isVideoOnlyFolder = playlistAvailable && isVideoOnlyPlaylist(
    directoryContents.notes,
    directoryContents.folders.length,
  );
  const overriddenViewMode = folderViewOverride?.folderKey === folderKey
    ? folderViewOverride.mode
    : null;
  const playlistRequested = searchParams.get("view") === "playlist";
  const requestedVideoId = searchParams.get("video") ?? undefined;
  const immediateViewMode = pendingViewMode?.folderKey === folderKey
    ? pendingViewMode.mode
    : null;
  const viewMode = isStash
    ? "list"
    : immediateViewMode ?? (playlistRequested && playlistAvailable
      ? "playlist"
      : overriddenViewMode ?? (isVideoOnlyFolder ? "grid" : libraryViewMode));
  const setPlaylistLocation = useCallback((videoId?: string, replace = false) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", "playlist");
      if (videoId) next.set("video", videoId);
      else next.delete("video");
      return next;
    }, { replace });
  }, [setSearchParams]);
  const clearPlaylistLocation = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("view");
      next.delete("video");
      return next;
    });
  }, [setSearchParams]);
  const handleActivePlaylistVideoChange = useCallback((videoId: string) => {
    setPlaylistLocation(videoId, true);
  }, [setPlaylistLocation]);
  const consumeInitialPlaylistAutoplay = useCallback(() => {
    setRequestedPlaylistVideo(null);
  }, []);

  useEffect(() => {
    if (!pendingViewMode || pendingViewMode.folderKey !== folderKey) return;
    const locationMatches = pendingViewMode.mode === "playlist"
      ? playlistRequested
      : !playlistRequested;
    if (locationMatches) setPendingViewMode(null);
  }, [folderKey, pendingViewMode, playlistRequested]);

  if (!section) {
    return <MissingFolder title="Folder not found" />;
  }

  const folderExists =
    directory.length === 0 ||
    sectionFolders.some((folder) => isSameDirectory(folder.directory, directory)) ||
    sectionNotes.some((note) =>
      isDirectoryPrefix(directory, getNoteDirectory(note)),
    );

  if (!folderExists) {
    return <MissingFolder title="Folder not found" />;
  }

  const currentLabel =
    directory.length > 0
      ? humanizePathSegment(directory[directory.length - 1])
      : section.label;
  const parentDirectory = directory.slice(0, -1);
  const parentRoute =
    directory.length > 0
      ? createFolderRoute(section.id, parentDirectory)
      : "/library";
  const parentLabel =
    directory.length > 1
      ? humanizePathSegment(parentDirectory[parentDirectory.length - 1])
      : directory.length === 1
        ? section.label
        : "Library";
  const resultCount = viewMode === "playlist"
    ? playlistVideos.length
    : filteredFolders.length + filteredNotes.length;
  const isFiltered = Boolean(deferredQuery);
  const canCreateContent = Boolean(
    platform.capabilities.createContent && platform.contentMutations,
  );
  const canRemoveFolder = Boolean(
    platform.capabilities.deleteContent && platform.contentMutations,
  );

  const openCreateFolder = (parentDirectory = directory) => {
    if (!canCreateContent) return;
    setFolderDialog({ mode: "create", kind: "folder", parentDirectory });
  };
  const openCreateNote = (parentDirectory = directory) => {
    if (!canCreateContent) return;
    setFolderDialog({ mode: "create", kind: "note", parentDirectory });
  };
  const createFolder = async (name: string, parentDirectory: string[]) => {
    const mutations = platform.contentMutations;
    if (!mutations || !platform.capabilities.createContent) {
      throw new Error("Creating folders is unavailable.");
    }
    await mutations.createFolder({
      sourceDirectory: [section.id, ...parentDirectory, name].join("/"),
    });
    setFolderDialog(null);
  };
  const createNote = async (title: string, parentDirectory: string[]) => {
    const mutations = platform.contentMutations;
    if (!mutations || !platform.capabilities.createContent) {
      throw new Error("Creating notes is unavailable.");
    }
    const input = createLibraryNoteSourceInput(
      title,
      section.id,
      parentDirectory,
      new Set([
        ...notes.map((note) => note.sourceFile),
        ...reservedSourceFiles.current,
      ]),
    );
    reservedSourceFiles.current.add(input.sourceFile);
    try {
      await mutations.createSource(input);
      setFolderDialog(null);
    } catch (reason) {
      reservedSourceFiles.current.delete(input.sourceFile);
      throw reason;
    }
  };
  const removeFolder = async (sourceDirectory: string, recursive: boolean) => {
    const mutations = platform.contentMutations;
    if (!mutations || !platform.capabilities.deleteContent) {
      throw new Error("Removing folders is unavailable.");
    }
    await mutations.deleteFolder({ sourceDirectory, recursive });
    setFolderDialog(null);
  };
  const folderContentsMenu = canCreateContent
    ? createFolderContentsContextMenu({
        label: currentLabel,
        onCreateFolder: () => openCreateFolder(),
        onCreateNote: () => openCreateNote(),
      })
    : undefined;
  const changeViewMode = (mode: Parameters<typeof setLibraryViewMode>[0] | "playlist") => {
    if (mode === "playlist") {
      setPendingViewMode({ folderKey, mode });
      setRequestedPlaylistVideo(null);
      setPlaylistLocation();
    } else {
      flushSync(() => {
        setPendingViewMode({ folderKey, mode });
        setFolderViewOverride({ folderKey, mode });
      });
      setLibraryViewMode(mode);
      clearPlaylistLocation();
    }
  };
  const openPlaylistVideo = (videoId: string) => {
    setRequestedPlaylistVideo({ folderKey, videoId });
    setPlaylistLocation(videoId);
  };

  return (
    <>
      <LibraryToolbar>
        <Link
          className="note-toolbar-icon note-toolbar-back"
          to={parentRoute}
          aria-label={`Back to ${parentLabel}`}
          title={`Back to ${parentLabel}`}
        >
          <Icon icon="arrow-left" aria-hidden="true" />
        </Link>
        <LibrarySearch
          value={query}
          onChange={setQuery}
          placeholder={`Filter ${currentLabel.toLocaleLowerCase()}`}
        />
        {isStash ? null : (
          <LibraryViewToggle
            playlistAvailable={playlistAvailable}
            value={viewMode}
            onChange={changeViewMode}
          />
        )}
      </LibraryToolbar>

      <main className="file-browser">
        <header className="file-browser-header">
          <div className="file-browser-heading">
            <h1>{currentLabel}</h1>
            <p>
              {directoryContents.folders.length}{" "}
              {directoryContents.folders.length === 1 ? "folder" : "folders"}{" "}
              and {directoryContents.notes.length}{" "}
              {directoryContents.notes.length === 1 ? "note" : "notes"}
            </p>
          </div>
        </header>

        {isStashRoot ? <StashComposer notes={sectionNotes} /> : null}

        <ContextMenuTarget menu={folderContentsMenu}>
          <div className="file-browser-content">
            {resultCount > 0 ? (
              viewMode === "playlist" ? (
                <PlaylistView
                  collectionKey={folderKey}
                  collectionTitle={currentLabel}
                  filterLabel={query.trim()}
                  filteredVideoIds={
                    deferredQuery ? filteredPlaylistVideoIds : undefined
                  }
                  initialAutoPlay={
                    requestedPlaylistVideo?.folderKey === folderKey &&
                    requestedPlaylistVideo.videoId === requestedVideoId
                  }
                  initialVideoId={
                    requestedVideoId ?? (
                      requestedPlaylistVideo?.folderKey === folderKey
                        ? requestedPlaylistVideo.videoId
                        : undefined
                    )
                  }
                  notes={notes}
                  onActiveVideoChange={handleActivePlaylistVideoChange}
                  onInitialAutoPlayConsumed={consumeInitialPlaylistAutoplay}
                  videos={playlistVideos}
                />
              ) : viewMode === "grid" && isVideoOnlyFolder ? (
                <PlaylistVideoGrid
                  onPlay={openPlaylistVideo}
                  videos={filteredPlaylistVideos}
                />
              ) : (
                <LibraryBrowser
                  className={
                    viewMode === "list"
                      ? `file-browser-list${isStash ? " file-browser-list--stash" : ""}`
                      : "file-browser-grid"
                  }
                  keyboardNavigation={!isStash}
                  viewMode={viewMode}
                >
                  {filteredFolders.map((folder) => (
                    <FolderTile
                      key={folder.name}
                      label={humanizePathSegment(folder.name)}
                      noteCount={folder.notes.length}
                      entryCount={folder.entryCount}
                      to={createFolderRoute(section.id, [...directory, folder.name])}
                      isPinned={pinnedFolderRoutes.has(
                        createFolderRoute(section.id, [...directory, folder.name]),
                      )}
                      onCreateNote={() => openCreateNote([...directory, folder.name])}
                      onTogglePin={onTogglePinnedFolder}
                      onRemove={
                        canRemoveFolder
                          ? () =>
                              setFolderDialog({
                                mode: "remove",
                                label: humanizePathSegment(folder.name),
                                sourceDirectory: [section.id, ...directory, folder.name].join("/"),
                                entryCount: folder.entryCount,
                              })
                          : undefined
                      }
                    />
                  ))}
                  {isStash ? (
                    <StashList
                      key={`${sectionId}:${folderPath}:${deferredQuery}`}
                      notes={filteredNotes}
                    />
                  ) : (
                    filteredNotes.map((note) => (
                      <NoteTile key={note.id} note={note} />
                    ))
                  )}
                </LibraryBrowser>
              )
            ) : (
              <EmptyState
                icon={isFiltered ? "search" : "folder-open"}
                title={isFiltered ? "No matching items" : "This folder is empty"}
                description={
                  isFiltered
                    ? viewMode === "playlist"
                      ? "Try a different video title, tag, or phrase."
                      : "Try a different folder name, note title, tag, or phrase."
                    : "Markdown files added here will appear automatically."
                }
                className="file-browser-empty"
              />
            )}
          </div>
        </ContextMenuTarget>
      </main>
      {folderDialog ? (
        <LibraryEntryDialog
          dialog={folderDialog}
          onCancel={() => setFolderDialog(null)}
          onCreate={createFolder}
          onCreateNote={createNote}
          onRemove={removeFolder}
        />
      ) : null}
    </>
  );
}

export function FolderTile({
  label,
  noteCount,
  entryCount,
  detail,
  to,
  icon = "folder-close",
  isPinned = false,
  onCreateNote,
  onTogglePin,
  onRemove,
}: {
  label: string;
  noteCount: number;
  entryCount?: number;
  detail?: string;
  to: string;
  icon?: SectionSummary["icon"];
  isPinned?: boolean;
  onCreateNote?: () => void;
  onTogglePin?: (route: string) => void;
  onRemove?: () => void;
}) {
  return (
    <ContextMenuTarget
      menu={createFolderContextMenu({
        label,
        route: to,
        isPinned,
        onCreateNote,
        onTogglePin: onTogglePin ? () => onTogglePin(to) : undefined,
        onRemove,
      })}
    >
      <Link
        aria-keyshortcuts="Space"
        className="file-tile file-tile--folder"
        data-library-folder="true"
        data-library-item="true"
        to={to}
      >
        <span className="file-tile-icon" aria-hidden="true">
          <Icon icon={icon as Parameters<typeof Icon>[0]["icon"]} size={18} />
        </span>
        <span className="file-tile-primary">
          <strong>{label}</strong>
        </span>
        <span className="file-tile-detail">
          {detail ?? (
            <>
              {noteCount} {noteCount === 1 ? "note" : "notes"}
              {noteCount === 0 && entryCount && entryCount > 0
                ? ` · ${entryCount} ${entryCount === 1 ? "item" : "items"}`
                : ""}
            </>
          )}
        </span>
        <Icon className="file-tile-arrow" icon="chevron-right" aria-hidden="true" />
      </Link>
    </ContextMenuTarget>
  );
}

type FolderDialogState =
  | {
      mode: "create";
      kind: "folder" | "note";
      parentDirectory: string[];
    }
  | {
      mode: "remove";
      label: string;
      sourceDirectory: string;
      entryCount: number;
    };

function LibraryEntryDialog({
  dialog,
  onCancel,
  onCreate,
  onCreateNote,
  onRemove,
}: {
  dialog: FolderDialogState;
  onCancel: () => void;
  onCreate: (name: string, parentDirectory: string[]) => Promise<void>;
  onCreateNote: (title: string, parentDirectory: string[]) => Promise<void>;
  onRemove: (sourceDirectory: string, recursive: boolean) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isRemoving = dialog.mode === "remove";
  const isCreatingNote = !isRemoving && dialog.kind === "note";
  const containsContent = isRemoving && dialog.entryCount > 0;

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);

  const submit = async () => {
    setError("");
    if (!isRemoving) {
      const entryName = name.trim();
      if (!isCreatingNote && !isValidFolderName(entryName)) {
        setError("Use lowercase snake_case, without spaces or path separators.");
        return;
      }
      setBusy(true);
      try {
        if (isCreatingNote) {
          await onCreateNote(entryName, dialog.parentDirectory);
        } else {
          await onCreate(entryName, dialog.parentDirectory);
        }
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      await onRemove(dialog.sourceDirectory, containsContent);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      aria-label={
        isRemoving ? "Remove folder" : isCreatingNote ? "Create note" : "Create folder"
      }
      className={`library-folder-dialog${isRemoving ? " library-folder-dialog--danger" : ""}`}
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header>
          <Icon icon={isRemoving ? "trash" : "new-object"} size={16} aria-hidden="true" />
          <div>
            <h2>
              {isRemoving
                ? `Remove “${dialog.label}”?`
                : isCreatingNote
                  ? "Create note"
                  : "Create folder"}
            </h2>
            <p>
              {isRemoving
                ? containsContent
                  ? `This folder contains ${dialog.entryCount} direct ${dialog.entryCount === 1 ? "item" : "items"}. The folder and all nested content will move to Castle Trash.`
                  : "This empty folder will be removed."
                : isCreatingNote
                  ? "Castle creates a Markdown note here and derives a portable snake_case filename from its title."
                  : "Folders use lowercase snake_case so they stay portable and easy to link."}
            </p>
          </div>
        </header>
        {!isRemoving ? (
          <label>
            <span>{isCreatingNote ? "Note title" : "Folder name"}</span>
            <input
              autoFocus
              disabled={busy}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder={isCreatingNote ? "Project notes" : "project_notes"}
              value={name}
            />
          </label>
        ) : null}
        {error ? <p className="library-folder-dialog-error" role="alert">{error}</p> : null}
        <footer>
          <button disabled={busy} onClick={onCancel} type="button">Cancel</button>
          <button
            className={isRemoving ? "is-danger" : undefined}
            disabled={busy || (!isRemoving && !name.trim())}
            type="submit"
          >
            {busy
              ? isRemoving
                ? "Removing…"
                : isCreatingNote
                  ? "Creating note…"
                  : "Creating folder…"
              : isRemoving
                ? containsContent ? "Move to Trash" : "Remove folder"
                : isCreatingNote ? "Create note" : "Create folder"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function isValidFolderName(value: string) {
  return /^[\p{Ll}\p{N}]+(?:_[\p{Ll}\p{N}]+)*$/u.test(value);
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "Couldn’t update the library.";
}

function NoteTile({ note }: { note: Note }) {
  return (
    <ContextMenuTarget menu={createNoteContextMenu(note)}>
      <Link
        aria-keyshortcuts="Space"
        className="file-tile file-tile--note"
        data-library-item="true"
        to={note.route}
      >
        <span className="file-tile-icon" aria-hidden="true">
          <Icon icon="document" size={18} />
        </span>
        <span className="file-tile-primary">
          <strong>{note.title}</strong>
        </span>
        <Icon className="file-tile-arrow" icon="chevron-right" aria-hidden="true" />
      </Link>
    </ContextMenuTarget>
  );
}

function MissingFolder({ title }: { title: string }) {
  return (
    <div className="missing-note">
      <Icon icon="folder-close" size={32} />
      <h1>{title}</h1>
      <p>The folder may have moved or no longer contains any notes.</p>
      <Link to="/">Return to the library</Link>
    </div>
  );
}

function catalogSearchText(note: Note) {
  return [
    note.title,
    note.relativePath,
    note.tags.join(" "),
    note.aliases.join(" "),
    note.status,
    note.excerpt,
    note.preview ?? "",
  ]
    .join(" ")
    .toLocaleLowerCase();
}
