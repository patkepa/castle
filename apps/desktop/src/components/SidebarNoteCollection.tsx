import { WorkspacePortal } from "@patkepa/kantzen-ui/app-shell";
import {
  Icon,
  Menu,
  MenuDivider,
  MenuItem,
  PopoverNext,
} from "@patkepa/kantzen-ui/primitives";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { PinnedFolder } from "../lib/libraryPaths";
import type { SidebarNoteView } from "../lib/sidebarNotePreferences";
import type { Note } from "../types";

interface SidebarNoteCollectionProps {
  onMovePinnedNote: (noteId: string, offset: -1 | 1) => void;
  onRemovePinnedFolder: (route: string) => void;
  onRemovePinnedNote: (noteId: string) => void;
  onReorderPinnedNote: (movedNoteId: string, targetNoteId: string) => void;
  onViewChange: (view: SidebarNoteView) => void;
  pinnedFolders: PinnedFolder[];
  pinnedNotes: Note[];
  recentNotes: Note[];
  view: SidebarNoteView;
}

const viewLabels: Record<SidebarNoteView, string> = {
  recent: "Recently updated",
  pinned: "Pinned",
};

export function SidebarNoteCollection(props: SidebarNoteCollectionProps) {
  return (
    <WorkspacePortal slot="sidebar-nav-end">
      <SidebarNoteCollectionContent {...props} />
    </WorkspacePortal>
  );
}

export function SidebarNoteCollectionContent({
  onMovePinnedNote,
  onRemovePinnedFolder,
  onRemovePinnedNote,
  onReorderPinnedNote,
  onViewChange,
  pinnedFolders,
  pinnedNotes,
  recentNotes,
  view,
}: SidebarNoteCollectionProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [draggedNoteId, setDraggedNoteId] = useState("");
  const hasItems =
    view === "recent"
      ? recentNotes.length > 0
      : pinnedFolders.length > 0 || pinnedNotes.length > 0;

  const selectView = (nextView: SidebarNoteView) => {
    if (nextView !== view) onViewChange(nextView);
  };

  return (
    <div className="nav-group sidebar-note-collection">
      <div className="nav-group-label sidebar-note-collection-heading">
        <PopoverNext
          arrow={false}
          className="breadcrumb-popover-target"
          content={
            <Menu className="breadcrumb-menu">
              <MenuDivider title="Sidebar view" />
              <MenuItem
                active={view === "recent"}
                className={
                  view === "recent" ? "breadcrumb-menu-item--current" : undefined
                }
                icon="time"
                text="Recently updated"
                onClick={() => selectView("recent")}
              />
              <MenuItem
                active={view === "pinned"}
                className={
                  view === "pinned" ? "breadcrumb-menu-item--current" : undefined
                }
                icon="pin"
                text="Pinned"
                onClick={() => selectView("pinned")}
              />
            </Menu>
          }
          inheritDarkTheme
          placement="bottom-start"
          popoverClassName="breadcrumb-popover"
          portalClassName="breadcrumb-popover-portal"
          transitionDuration={0}
        >
          <button
            aria-label={`Change sidebar view. Current view: ${viewLabels[view]}`}
            className="breadcrumb-trigger breadcrumb-trigger--current sidebar-note-collection-trigger"
            type="button"
          >
            <span>{viewLabels[view]}</span>
            <Icon
              aria-hidden="true"
              className="breadcrumb-trigger-caret"
              icon="chevron-down"
              size={10}
            />
          </button>
        </PopoverNext>
      </div>

      {hasItems ? (
        view === "recent" ? (
          <Menu className="sidebar-menu sidebar-note-collection-menu">
            {recentNotes.map((note) => (
              <MenuItem
                active={location.pathname === note.route}
                className={
                  location.pathname === note.route
                    ? "sidebar-item-active"
                    : undefined
                }
                data-focus-region-initial={
                  location.pathname === note.route ? "true" : undefined
                }
                data-href={note.route}
                data-label={note.title}
                data-sidebar-nav-item="true"
                icon="document"
                key={note.id}
                text={note.title}
                onClick={() => navigate(note.route)}
              />
            ))}
          </Menu>
        ) : (
          <div
            aria-describedby="pinned-note-reorder-help"
            aria-label="Pinned items"
            className="sidebar-pinned-notes"
            role="list"
          >
            <span className="sr-only" id="pinned-note-reorder-help">
              Drag notes to rearrange them, or focus a note and press Alt with
              the Up or Down Arrow.
            </span>
            {pinnedFolders.map((folder) => (
              <PinnedFolderRow
                active={location.pathname === folder.route}
                folder={folder}
                key={folder.route}
                onOpen={() => navigate(folder.route)}
                onRequestRemove={() => onRemovePinnedFolder(folder.route)}
              />
            ))}
            {pinnedNotes.map((note) => (
              <PinnedNoteRow
                active={location.pathname === note.route}
                dragging={draggedNoteId === note.id}
                key={note.id}
                note={note}
                onDragEnd={() => setDraggedNoteId("")}
                onDragOver={(event) => {
                  if (!draggedNoteId || draggedNoteId === note.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  onReorderPinnedNote(draggedNoteId, note.id);
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", note.id);
                  setDraggedNoteId(note.id);
                }}
                onKeyDown={(event) => {
                  if (!event.altKey) return;
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    event.stopPropagation();
                    onMovePinnedNote(note.id, -1);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    event.stopPropagation();
                    onMovePinnedNote(note.id, 1);
                  }
                }}
                onOpen={() => navigate(note.route)}
                onRequestRemove={() => onRemovePinnedNote(note.id)}
              />
            ))}
          </div>
        )
      ) : (
        <div className="sidebar-note-collection-empty">
          <Icon icon={view === "pinned" ? "pin" : "document"} aria-hidden="true" />
          <p>
            {view === "pinned"
              ? "Open a note, or use a folder’s menu in Library, to pin it here."
              : "No recently updated notes."}
          </p>
        </div>
      )}

    </div>
  );
}

function PinnedFolderRow({
  active,
  folder,
  onOpen,
  onRequestRemove,
}: {
  active: boolean;
  folder: PinnedFolder;
  onOpen: () => void;
  onRequestRemove: () => void;
}) {
  return (
    <div
      className={`sidebar-pinned-note${active ? " sidebar-item-active" : ""}`}
      role="listitem"
    >
      <button
        aria-current={active ? "page" : undefined}
        className="sidebar-pinned-note-link"
        data-focus-region-initial={active ? "true" : undefined}
        data-href={folder.route}
        data-label={folder.label}
        data-sidebar-nav-item="true"
        onClick={onOpen}
        title={folder.label}
        type="button"
      >
        <Icon icon="folder-close" aria-hidden="true" />
        <span>{folder.label}</span>
      </button>
      <button
        aria-label={`Remove ${folder.label} from Pinned`}
        className="sidebar-pinned-note-remove"
        onClick={onRequestRemove}
        title="Remove pin"
        type="button"
      >
        <Icon icon="cross" aria-hidden="true" />
      </button>
    </div>
  );
}

function PinnedNoteRow({
  active,
  dragging,
  note,
  onDragEnd,
  onDragOver,
  onDragStart,
  onKeyDown,
  onOpen,
  onRequestRemove,
}: {
  active: boolean;
  dragging: boolean;
  note: Note;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onOpen: () => void;
  onRequestRemove: () => void;
}) {
  return (
    <div
      className={`sidebar-pinned-note${active ? " sidebar-item-active" : ""}${
        dragging ? " is-dragging" : ""
      }`}
      draggable
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      role="listitem"
    >
      <button
        aria-current={active ? "page" : undefined}
        className="sidebar-pinned-note-link"
        data-focus-region-initial={active ? "true" : undefined}
        data-href={note.route}
        data-label={note.title}
        data-sidebar-nav-item="true"
        onClick={onOpen}
        onKeyDown={onKeyDown}
        title={`${note.title}. Alt+Up or Alt+Down to reorder.`}
        type="button"
      >
        <Icon icon="document" aria-hidden="true" />
        <span>{note.title}</span>
      </button>
      <button
        aria-label={`Remove ${note.title} from Pinned`}
        className="sidebar-pinned-note-remove"
        onClick={onRequestRemove}
        title="Remove pin"
        type="button"
      >
        <Icon icon="cross" aria-hidden="true" />
      </button>
    </div>
  );
}
