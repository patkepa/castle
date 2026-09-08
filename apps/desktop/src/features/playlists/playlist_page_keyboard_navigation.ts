import { useCallback, type RefObject } from "react";
import { useKeyboardShortcut } from "../../keyboard/use_keyboard_shortcut";

const fullscreenTargetSelector = "[data-playlist-fullscreen-target]";

export async function togglePlaylistFullscreen(
  playerView: Pick<HTMLElement, "querySelector"> | null,
  fullscreenDocument: Pick<Document, "exitFullscreen" | "fullscreenElement"> = document,
) {
  if (fullscreenDocument.fullscreenElement) {
    await fullscreenDocument.exitFullscreen();
    return true;
  }

  const target = playerView?.querySelector<HTMLElement>(fullscreenTargetSelector);
  if (typeof target?.requestFullscreen !== "function") return false;
  await target.requestFullscreen();
  return true;
}

export function usePlaylistPageKeyboardNavigation({
  playerViewRef,
}: {
  playerViewRef: RefObject<HTMLElement | null>;
}) {
  const toggleFullscreen = useCallback(() => {
    void togglePlaylistFullscreen(playerViewRef.current).catch(() => {});
  }, [playerViewRef]);
  const fullscreenAvailable = typeof document !== "undefined" &&
    typeof document.documentElement.requestFullscreen === "function";

  useKeyboardShortcut("playlistFullscreen", toggleFullscreen, {
    enabled: fullscreenAvailable,
  });
}
