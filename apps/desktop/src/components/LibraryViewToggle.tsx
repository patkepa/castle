import { useCallback } from "react";
import { SegmentedControl } from "@patkepa/kantzen-ui";
import {
  updateCastleUserPreferences,
  useCastleUserPreferences,
} from "../lib/userPreferences";

export type LibraryViewMode = "list" | "grid" | "playlist";
type PersistentLibraryViewMode = Exclude<LibraryViewMode, "playlist">;

export function useLibraryViewMode() {
  const { libraryViewMode: viewMode } = useCastleUserPreferences();
  const setViewMode = useCallback((mode: PersistentLibraryViewMode) => {
    updateCastleUserPreferences((current) => ({
      ...current,
      libraryViewMode: mode,
    }));
  }, []);

  return [viewMode, setViewMode] as const;
}

export function LibraryViewToggle({
  playlistAvailable = false,
  value,
  onChange,
}: {
  playlistAvailable?: boolean;
  value: LibraryViewMode;
  onChange: (mode: LibraryViewMode) => void;
}) {
  const items = [
    { icon: "list", label: "List", value: "list" } as const,
    { icon: "grid-view", label: "Grid", value: "grid" } as const,
    ...(playlistAvailable
      ? [{ icon: "video", label: "Playlist", value: "playlist" } as const]
      : []),
  ];

  return (
    <SegmentedControl
      ariaLabel="View"
      className="file-browser-view-toggle"
      items={items}
      onChange={onChange}
      value={value}
      variant="joined"
    />
  );
}
