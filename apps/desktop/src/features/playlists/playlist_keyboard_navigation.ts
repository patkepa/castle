import type { KeyboardEvent } from "react";

export function handlePlaylistQueueKeyDown(
  event: KeyboardEvent<HTMLElement>,
) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      ".playlist-queue-item:not([disabled])",
    ),
  );
  const currentIndex = buttons.indexOf(event.target as HTMLButtonElement);
  if (currentIndex < 0 || buttons.length === 0) return;

  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? buttons.length - 1
      : event.key === "ArrowDown"
        ? Math.min(buttons.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);

  if (nextIndex === currentIndex) return;
  event.preventDefault();
  buttons[nextIndex]?.focus();
}
