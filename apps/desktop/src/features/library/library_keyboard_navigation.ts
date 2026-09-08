import {
  useCallback,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
} from "react";
import {
  findEventItem,
  focusKeyboardItem,
  getItemGridNavigationIndex,
  getLinearNavigationIndex,
  getScopedItems,
} from "@patkepa/kantzen-ui/interactions";
import type { LibraryViewMode } from "../../components/LibraryViewToggle";

const libraryItemSelector = '[data-library-item="true"]';
const libraryFolderSelector = '[data-library-folder="true"]';

let shouldRestoreLibraryItemFocus = false;

export function useLibraryKeyboardNavigation({
  enabled = true,
  viewMode,
}: {
  enabled?: boolean;
  viewMode: LibraryViewMode;
}) {
  const scopeRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!shouldRestoreLibraryItemFocus) return;
    if (!enabled) {
      shouldRestoreLibraryItemFocus = false;
      return;
    }

    const firstItem = scopeRef.current?.querySelector<HTMLElement>(
      libraryItemSelector,
    );
    if (!firstItem) return;

    shouldRestoreLibraryItemFocus = false;
    focusKeyboardItem(firstItem);
  });

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const currentItem = findEventItem<HTMLElement>(
        event.target,
        libraryItemSelector,
      );
      if (!currentItem) return;

      if (isUnmodifiedActivation(event)) {
        if (event.key === " ") {
          event.preventDefault();
          if (event.repeat) return;
          shouldRestoreLibraryItemFocus = currentItem.matches(
            libraryFolderSelector,
          );
          currentItem.click();
          return;
        }

        if (
          event.key === "Enter" &&
          currentItem.matches(libraryFolderSelector)
        ) {
          shouldRestoreLibraryItemFocus = true;
          return;
        }
      }

      const items = getScopedItems<HTMLElement>(
        event.currentTarget,
        libraryItemSelector,
      );
      const currentIndex = items.indexOf(currentItem);
      const nextIndex =
        viewMode === "list"
          ? getLinearNavigationIndex(event.key, currentIndex, items.length)
          : getItemGridNavigationIndex(
              event.key,
              currentIndex,
              items.length,
              getGridColumnCount(items),
            );
      if (nextIndex === null) return;

      event.preventDefault();
      focusKeyboardItem(items[nextIndex]);
    },
    [enabled, viewMode],
  );

  return { handleKeyDown, scopeRef };
}

function isUnmodifiedActivation(event: KeyboardEvent<HTMLDivElement>) {
  return (
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (event.key === " " || event.key === "Enter")
  );
}

function getGridColumnCount(items: readonly HTMLElement[]) {
  const firstItemTop = items[0]?.offsetTop;
  if (firstItemTop === undefined) return 1;
  const nextRowIndex = items.findIndex(
    (item) => item.offsetTop > firstItemTop,
  );
  return nextRowIndex > 0 ? nextRowIndex : Math.max(items.length, 1);
}
