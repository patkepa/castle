import { SegmentedControl } from "@patkepa/kantzen-ui";
import { useCallback } from "react";
import {
  updateCastleUserPreferences,
  useCastleUserPreferences,
} from "../../lib/userPreferences";

export type TaskViewMode = "list" | "kanban";

export function useTaskViewMode() {
  const { taskViewMode: viewMode } = useCastleUserPreferences();
  const setViewMode = useCallback((mode: TaskViewMode) => {
    updateCastleUserPreferences((current) => ({ ...current, taskViewMode: mode }));
  }, []);

  return [viewMode, setViewMode] as const;
}

export function TaskViewToggle({
  value,
  onChange,
}: {
  value: TaskViewMode;
  onChange: (mode: TaskViewMode) => void;
}) {
  return (
    <SegmentedControl
      ariaLabel="Task view"
      className="tasks-view-toggle"
      items={[
        { icon: "list", label: "List", title: "List view", value: "list" },
        {
          icon: "column-layout",
          label: "Board",
          title: "Kanban view",
          value: "kanban",
        },
      ]}
      onChange={onChange}
      value={value}
    />
  );
}
