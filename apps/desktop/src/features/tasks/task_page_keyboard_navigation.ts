import { useCallback, type RefObject } from "react";
import { useKeyboardShortcut } from "../../keyboard/use_keyboard_shortcut";

export function useTaskPageKeyboardNavigation(
  searchInputRef: RefObject<HTMLInputElement>,
) {
  const focusTaskSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, [searchInputRef]);

  useKeyboardShortcut("tasksSearch", focusTaskSearch);
}
