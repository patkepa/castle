import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
} from "react";
import {
  findEventItem,
  focusKeyboardItem,
  getScopedItems,
} from "@patkepa/kantzen-ui/interactions";

const treeItemSelector = '[role="treeitem"]';

export interface PeopleTreeItemKeyboardProps {
  "data-tree-item-id": string;
  onFocus: () => void;
  tabIndex: number;
}

export function usePeopleTreeKeyboardNavigation({
  availableItemIds,
  initialItemId,
  selectedItemId,
}: {
  availableItemIds: ReadonlySet<string>;
  initialItemId: string;
  selectedItemId: string | null;
}) {
  const [activeItemId, setActiveItemId] = useState(
    selectedItemId ?? initialItemId,
  );
  const tabStopItemId = availableItemIds.has(activeItemId)
    ? activeItemId
    : initialItemId;

  useEffect(() => {
    if (selectedItemId) setActiveItemId(selectedItemId);
  }, [selectedItemId]);

  const focusTreeItem = useCallback((item: HTMLElement | null) => {
    if (!item) return;
    const itemId = item.dataset.treeItemId;
    if (itemId) setActiveItemId(itemId);
    focusKeyboardItem(item);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const currentItem = findEventItem<HTMLElement>(
        event.target,
        treeItemSelector,
      );
      if (!currentItem) return;

      const items = getScopedItems<HTMLElement>(
        event.currentTarget,
        treeItemSelector,
      );
      const currentIndex = items.indexOf(currentItem);
      if (currentIndex < 0) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        focusTreeItem(
          items[
            Math.min(Math.max(currentIndex + step, 0), items.length - 1)
          ],
        );
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        focusTreeItem(event.key === "Home" ? items[0] : items.at(-1) ?? null);
        return;
      }
      if (event.key === "ArrowRight") {
        const expanded = currentItem.getAttribute("aria-expanded");
        if (expanded === "false") {
          event.preventDefault();
          currentItem.click();
          return;
        }
        if (expanded === "true") {
          event.preventDefault();
          focusTreeItem(
            currentItem.nextElementSibling?.querySelector<HTMLElement>(
              treeItemSelector,
            ) ?? null,
          );
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        const expanded = currentItem.getAttribute("aria-expanded");
        if (expanded === "true") {
          event.preventDefault();
          currentItem.click();
          return;
        }
        const parentItem = currentItem.parentElement
          ?.closest<HTMLElement>('[role="group"]')
          ?.previousElementSibling;
        if (parentItem instanceof HTMLElement) {
          event.preventDefault();
          focusTreeItem(parentItem);
        }
        return;
      }

      if (
        event.key.length !== 1 ||
        event.key === " " ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const query = event.key.toLocaleLowerCase();
      const orderedItems = [
        ...items.slice(currentIndex + 1),
        ...items.slice(0, currentIndex + 1),
      ];
      const match = orderedItems.find((item) =>
        item.textContent?.trim().toLocaleLowerCase().startsWith(query),
      );
      if (match) {
        event.preventDefault();
        focusTreeItem(match);
      }
    },
    [focusTreeItem],
  );

  const getTreeItemProps = useCallback(
    (itemId: string): PeopleTreeItemKeyboardProps => ({
      "data-tree-item-id": itemId,
      onFocus: () => setActiveItemId(itemId),
      tabIndex: tabStopItemId === itemId ? 0 : -1,
    }),
    [tabStopItemId],
  );

  return { getTreeItemProps, handleKeyDown };
}
