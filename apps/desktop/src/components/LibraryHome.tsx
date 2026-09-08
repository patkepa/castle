import { useDeferredValue, useMemo, useState } from "react";
import { EmptyState } from "@patkepa/kantzen-ui";
import { FolderTile } from "./FolderPage";
import {
  LibraryViewToggle,
  useLibraryViewMode,
} from "./LibraryViewToggle";
import { LibrarySearch, LibraryToolbar } from "./LibraryToolbar";
import { LibraryBrowser } from "./library_browser";
import { createFolderRoute } from "../lib/libraryPaths";
import type { SectionSummary } from "../types";

interface LibraryHomeProps {
  onTogglePinnedFolder: (route: string) => void;
  pinnedFolderRoutes: ReadonlySet<string>;
  sections: SectionSummary[];
}

export function LibraryHome({
  onTogglePinnedFolder,
  pinnedFolderRoutes,
  sections,
}: LibraryHomeProps) {
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useLibraryViewMode();
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const visibleSections = useMemo(
    () =>
      sections.filter(
        (section) =>
          !deferredQuery ||
          `${section.label} ${section.id}`
            .toLocaleLowerCase()
            .includes(deferredQuery),
    ),
    [deferredQuery, sections],
  );

  return (
    <>
      <LibraryToolbar root>
        <div className="file-browser-view-title">
          <span>Index</span>
          <strong>All collections</strong>
        </div>
        <LibrarySearch
          value={query}
          onChange={setQuery}
          placeholder="Filter collections"
        />
        <LibraryViewToggle
          value={viewMode}
          onChange={(mode) => {
            if (mode !== "playlist") setViewMode(mode);
          }}
        />
      </LibraryToolbar>

      <main className="file-browser">
        {visibleSections.length > 0 ? (
          <LibraryBrowser
            className={
              viewMode === "list" ? "file-browser-list" : "file-browser-grid"
            }
            viewMode={viewMode}
          >
            {visibleSections.map((section) => (
              <FolderTile
                detail={
                  section.id === "sheets"
                    ? "OpenDocument spreadsheets"
                    : undefined
                }
                key={section.id}
                label={section.label}
                noteCount={section.count}
                to={createFolderRoute(section.id)}
                icon={section.icon}
                isPinned={pinnedFolderRoutes.has(createFolderRoute(section.id))}
                onTogglePin={onTogglePinnedFolder}
              />
            ))}
          </LibraryBrowser>
        ) : (
          <EmptyState
            icon="search"
            title="No matching collections"
            description="Try a different collection name."
            className="file-browser-empty"
          />
        )}
      </main>
    </>
  );
}
