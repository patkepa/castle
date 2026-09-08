import { useCallback, type KeyboardEvent } from "react";
import {
  findEventItem,
  focusKeyboardItem,
  getLinearNavigationIndex,
  getScopedItems,
} from "@patkepa/kantzen-ui/interactions";
import type { Task } from "../../types";

const taskOptionSelector = '[data-task-option="true"]';

export function useTaskListKeyboardNavigation({
  tasks,
  onSelectTask,
}: {
  tasks: readonly Task[];
  onSelectTask: (task: Task) => void;
}) {
  return useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const currentRow = findEventItem<HTMLButtonElement>(
        event.target,
        taskOptionSelector,
      );
      if (!currentRow) return;

      const rows = getScopedItems<HTMLButtonElement>(
        event.currentTarget,
        taskOptionSelector,
      );
      const nextIndex = getLinearNavigationIndex(
        event.key,
        rows.indexOf(currentRow),
        rows.length,
      );
      if (nextIndex === null) return;

      event.preventDefault();
      focusKeyboardItem(rows[nextIndex]);
      const nextTask = tasks[nextIndex];
      if (nextTask) onSelectTask(nextTask);
    },
    [onSelectTask, tasks],
  );
}
