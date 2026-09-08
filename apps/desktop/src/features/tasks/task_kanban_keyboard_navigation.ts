import { useCallback, useMemo, type KeyboardEvent } from "react";
import {
  findEventItem,
  focusKeyboardItem,
  getGridNavigationPosition,
  getScopedItems,
} from "@patkepa/kantzen-ui/interactions";
import type { Task } from "../../types";

const kanbanColumnSelector = '[data-kanban-column="true"]';
const taskOptionSelector = '[data-task-option="true"]';

export function useTaskKanbanKeyboardNavigation({
  tasks,
  onSelectTask,
}: {
  tasks: readonly Task[];
  onSelectTask: (task: Task) => void;
}) {
  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );

  return useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      const currentCard = findEventItem<HTMLButtonElement>(
        event.target,
        taskOptionSelector,
      );
      const currentColumn = currentCard?.closest<HTMLElement>(
        kanbanColumnSelector,
      );
      if (!currentCard || !currentColumn) return;

      const columns = getScopedItems<HTMLElement>(
        event.currentTarget,
        kanbanColumnSelector,
      );
      const currentCards = getScopedItems<HTMLButtonElement>(
        currentColumn,
        taskOptionSelector,
      );
      const columnSizes = columns.map(
        (column) =>
          column.querySelectorAll<HTMLButtonElement>(taskOptionSelector).length,
      );
      const nextPosition = getGridNavigationPosition(
        event.key,
        {
          columnIndex: columns.indexOf(currentColumn),
          rowIndex: currentCards.indexOf(currentCard),
        },
        columnSizes,
      );
      if (!nextPosition) return;

      event.preventDefault();
      const nextCard = columns[nextPosition.columnIndex]
        ?.querySelectorAll<HTMLButtonElement>(taskOptionSelector)
        .item(nextPosition.rowIndex);
      if (!nextCard) return;

      focusKeyboardItem(nextCard);
      const nextTask = tasksById.get(nextCard.dataset.taskId ?? "");
      if (nextTask) onSelectTask(nextTask);
    },
    [onSelectTask, tasksById],
  );
}
