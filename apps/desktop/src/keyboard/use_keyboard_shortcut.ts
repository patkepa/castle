import { useEffect } from "react";
import {
  shouldIgnoreShortcutEvent,
  type KeyboardEventGuardOptions,
} from "./event_guards";
import {
  matchesShortcut,
  shortcutCatalog,
  type ShortcutDefinition,
  type ShortcutId,
} from "./shortcut_catalog";

interface KeyboardShortcutOptions extends KeyboardEventGuardOptions {
  enabled?: boolean;
}

export function useKeyboardShortcut(
  shortcutId: ShortcutId,
  onTrigger: (event: KeyboardEvent) => void,
  options: KeyboardShortcutOptions = {},
) {
  const {
    allowInEditable,
    allowWhenOverlayOpen,
    enabled = true,
  } = options;
  useEffect(() => {
    if (!enabled) return;
    const shortcut: ShortcutDefinition = shortcutCatalog[shortcutId];
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.repeat && !shortcut.allowRepeat) ||
        !matchesShortcut(event, shortcutId) ||
        shouldIgnoreShortcutEvent(event, {
          allowInEditable: allowInEditable ?? shortcut.allowInEditable,
          allowWhenOverlayOpen:
            allowWhenOverlayOpen ?? shortcut.allowWhenOverlayOpen,
        })
      ) {
        return;
      }

      event.preventDefault();
      onTrigger(event);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    allowInEditable,
    allowWhenOverlayOpen,
    enabled,
    onTrigger,
    shortcutId,
  ]);
}
