import { Icon } from "@patkepa/kantzen-ui/primitives";
import { useMemo, useState, type FormEvent } from "react";
import type { IconName } from "@patkepa/kantzen-ui/icons";
import type { Task } from "../../types";
import {
  filterTasksByGroup,
  type TaskGroupFilter,
} from "./taskPresentation";

interface TaskGroupOption {
  id: TaskGroupFilter;
  label: string;
  icon: IconName;
}

const builtInGroups: readonly TaskGroupOption[] = [
  { id: "all", label: "All tasks", icon: "list" },
  { id: "inbox", label: "Inbox", icon: "inbox" },
  { id: "today", label: "Today", icon: "calendar" },
  { id: "upcoming", label: "Upcoming", icon: "time" },
  { id: "completed", label: "Completed", icon: "tick-circle" },
];

export function TaskGroups({
  tasks,
  customGroups,
  selectedGroup,
  now,
  onAddGroup,
  onSelectGroup,
}: {
  tasks: Task[];
  customGroups: string[];
  selectedGroup: TaskGroupFilter;
  now: Date;
  onAddGroup: (name: string) => void;
  onSelectGroup: (group: TaskGroupFilter) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);
  const options = useMemo(
    () => [
      ...builtInGroups.filter((group) => showCompleted || group.id !== "completed"),
      ...customGroups.map((label) => ({
        id: `custom:${label}` as const,
        label,
        icon: "folder-close" as const,
      })),
    ],
    [customGroups, showCompleted],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    onAddGroup(name);
    setDraft("");
    setAdding(false);
  };

  return (
    <aside className="task-groups" aria-label="Task groups">
      <header className="task-pane-header">
        <span>
          <strong>Groups</strong>
        </span>
      </header>

      <nav className="task-groups-list" aria-label="Task group filters">
        {options.map((group) => {
          const count = filterTasksByGroup(tasks, group.id, now).length;
          return (
            <button
              type="button"
              className={selectedGroup === group.id ? "is-selected" : undefined}
              aria-current={selectedGroup === group.id ? "page" : undefined}
              key={group.id}
              onClick={() => onSelectGroup(group.id)}
            >
              <Icon icon={group.icon} size={14} aria-hidden="true" />
              <span>{group.label}</span>
              <small>{count}</small>
            </button>
          );
        })}

        {adding ? (
          <form className="task-group-create" onSubmit={submit}>
            <Icon icon="folder-close" size={14} aria-hidden="true" />
            <input
              autoFocus
              aria-label="New task group name"
              placeholder="Group name"
              value={draft}
              onBlur={() => {
                if (!draft.trim()) setAdding(false);
              }}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDraft("");
                  setAdding(false);
                }
              }}
            />
          </form>
        ) : null}
      </nav>

      <footer className="task-pane-footer">
        <details className="task-pane-options">
          <summary>
            <Icon icon="cog" size={13} aria-hidden="true" />
            Options
          </summary>
          <div>
            <label>
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(event) => {
                  const visible = event.currentTarget.checked;
                  setShowCompleted(visible);
                  if (!visible && selectedGroup === "completed") onSelectGroup("all");
                }}
              />
              Show completed
            </label>
          </div>
        </details>
        <button
          type="button"
          className="task-pane-add"
          aria-label="Add task group"
          title="Add task group"
          onClick={() => setAdding(true)}
        >
          <Icon icon="small-plus" size={15} aria-hidden="true" />
        </button>
      </footer>
    </aside>
  );
}
