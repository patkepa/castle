import { Icon } from "@patkepa/kantzen-ui/primitives";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import type { Task, TaskStatus } from "../../types";
import { ContextMenuTarget } from "../context_menu/CastleContextMenu";
import { createTaskContextMenu } from "../context_menu/context_menu_models";
import { useTaskListKeyboardNavigation } from "./task_list_keyboard_navigation";
import { TaskPersonAvatar } from "./TaskStatus";
import {
  formatTaskDue,
  groupTasks,
  groupTasksByStatus,
  isOverdue,
  statusLabels,
  taskDateTime,
  taskStatuses,
  type TaskFilter,
} from "./taskPresentation";
import {
  taskMoveTargetAt,
  type TaskMoveTarget,
} from "./useTaskMutations";

export function TaskBrowser({
  tasks,
  totalTaskCount,
  selectedTaskId,
  now,
  filtered,
  filter,
  onClearFilters,
  onFilterChange,
  onNewTask,
  onSelectTask,
  canCreate,
  canEdit,
  busyTaskId,
  onMoveTask,
  onStatusChange,
  onDeleteTask,
}: {
  tasks: Task[];
  totalTaskCount: number;
  selectedTaskId: string | null;
  now: Date;
  filtered: boolean;
  filter: TaskFilter;
  onClearFilters: () => void;
  onFilterChange: (filter: TaskFilter) => void;
  onNewTask: () => void;
  onSelectTask: (task: Task) => void;
  canCreate: boolean;
  canEdit: boolean;
  busyTaskId: string | null;
  onMoveTask: (taskId: string, status: TaskStatus, target: TaskMoveTarget) => void;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  onDeleteTask: (task: Task) => void;
}) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    taskId: string;
    edge: "before" | "after";
  } | null>(null);
  const taskOptions = groupTasks(tasks, now).flatMap((group) => group.tasks);
  const selectedIndex = taskOptions.findIndex((task) => task.id === selectedTaskId);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const indexesByTaskId = new Map(
    taskOptions.map((task, index) => [task.id, index]),
  );
  const tasksByStatus = new Map(
    groupTasksByStatus(tasks).map((group) => [group.status, group.tasks]),
  );
  const statusIndexesByTaskId = new Map<string, number>();
  for (const status of taskStatuses) {
    (tasksByStatus.get(status) ?? []).forEach((task, index) => {
      statusIndexesByTaskId.set(task.id, index);
    });
  }

  const handleKeyDown = useTaskListKeyboardNavigation({
    tasks: taskOptions,
    onSelectTask,
  });

  return (
    <aside className="tasks-browser" aria-label="Task browser">
      <header className="task-pane-header">
        <span>
          <strong>Tasks</strong>
        </span>
        <span className="task-pane-count">{tasks.length}</span>
      </header>

      {canEdit && draggedTaskId ? (
        <div className="tasks-browser-drop-statuses" aria-label="Move task to status">
          <span>Move to</span>
          {taskStatuses.map((status) => (
            <button
              type="button"
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void onMoveTask(draggedTaskId, status, { position: "end" });
                setDraggedTaskId(null);
                setDropTarget(null);
              }}
            >
              <i className={`tasks-browser-status tasks-browser-status--${status}`} aria-hidden="true" />
              {statusLabels[status]}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className="tasks-browser-scroll"
        role={taskOptions.length > 0 ? "listbox" : undefined}
        aria-label={taskOptions.length > 0 ? "Tasks" : undefined}
        aria-orientation={taskOptions.length > 0 ? "vertical" : undefined}
        onKeyDown={handleKeyDown}
      >
        {taskOptions.length > 0 ? taskOptions.map((task) => (
          <TaskBrowserRow
            key={task.id}
            task={task}
            now={now}
            selected={selectedTaskId === task.id}
            tabIndex={indexesByTaskId.get(task.id) === activeIndex ? 0 : -1}
            position={indexesByTaskId.get(task.id) ?? 0}
            statusPosition={statusIndexesByTaskId.get(task.id) ?? 0}
            statusSetSize={tasksByStatus.get(task.status)?.length ?? 0}
            setSize={taskOptions.length}
            onSelect={() => onSelectTask(task)}
            canEdit={canEdit}
            busy={busyTaskId === task.id}
            dragging={draggedTaskId === task.id}
            dropEdge={dropTarget?.taskId === task.id ? dropTarget.edge : null}
            onDragStart={() => setDraggedTaskId(task.id)}
            onDragEnd={() => {
              setDraggedTaskId(null);
              setDropTarget(null);
            }}
            onDragOver={(event) => {
              if (!canEdit || !draggedTaskId) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              setDropTarget({
                taskId: task.id,
                edge: event.clientY > rect.top + rect.height / 2 ? "after" : "before",
              });
            }}
            onDrop={(event) => {
              if (!draggedTaskId) return;
              event.preventDefault();
              const edge = dropTarget?.taskId === task.id ? dropTarget.edge : "before";
              void onMoveTask(
                draggedTaskId,
                task.status,
                { relativeToTaskId: task.id, edge },
              );
              setDraggedTaskId(null);
              setDropTarget(null);
            }}
            onStatusChange={(status) => onStatusChange(task, status)}
            onDelete={() => onDeleteTask(task)}
            onKeyboardMove={(event) => {
              if (!event.altKey) return;
              const statusIndex = taskStatuses.indexOf(task.status);
              const statusPosition = statusIndexesByTaskId.get(task.id) ?? 0;
              const statusSetSize = tasksByStatus.get(task.status)?.length ?? 0;
              if (event.key === "ArrowUp" && statusPosition > 0) {
                event.preventDefault();
                event.stopPropagation();
                void onMoveTask(
                  task.id,
                  task.status,
                  taskMoveTargetAt(
                    tasksByStatus.get(task.status) ?? [],
                    task.id,
                    statusPosition - 1,
                  ),
                );
              } else if (event.key === "ArrowDown" && statusPosition < statusSetSize - 1) {
                event.preventDefault();
                event.stopPropagation();
                void onMoveTask(
                  task.id,
                  task.status,
                  taskMoveTargetAt(
                    tasksByStatus.get(task.status) ?? [],
                    task.id,
                    statusPosition + 1,
                  ),
                );
              } else if (event.key === "ArrowLeft" && statusIndex > 0) {
                event.preventDefault();
                event.stopPropagation();
                void onMoveTask(task.id, taskStatuses[statusIndex - 1], {
                  position: "start",
                });
              } else if (event.key === "ArrowRight" && statusIndex < taskStatuses.length - 1) {
                event.preventDefault();
                event.stopPropagation();
                void onMoveTask(task.id, taskStatuses[statusIndex + 1], {
                  position: "start",
                });
              }
            }}
          />
        )) : (
          <TaskBrowserEmpty filtered={filtered} onClearFilters={onClearFilters} />
        )}
      </div>

      <TaskPaneFooter
        canCreate={canCreate}
        filter={filter}
        taskCount={tasks.length}
        totalTaskCount={totalTaskCount}
        onFilterChange={onFilterChange}
        onNewTask={onNewTask}
      />
    </aside>
  );
}

export function TaskPaneFooter({
  canCreate,
  filter,
  taskCount,
  totalTaskCount,
  onFilterChange,
  onNewTask,
}: {
  canCreate: boolean;
  filter: TaskFilter;
  taskCount: number;
  totalTaskCount: number;
  onFilterChange: (filter: TaskFilter) => void;
  onNewTask: () => void;
}) {
  return (
    <footer className="task-pane-footer">
      <details className="task-pane-options">
        <summary>
          <Icon icon="filter" size={13} aria-hidden="true" />
          Options
          <small aria-live="polite">
            {taskCount === totalTaskCount ? taskCount : `${taskCount}/${totalTaskCount}`}
          </small>
        </summary>
        <div>
          <label>
            <input
              type="radio"
              name="task-status-filter"
              checked={filter === "all"}
              onChange={() => onFilterChange("all")}
            />
            All statuses
          </label>
          {taskStatuses.map((status) => (
            <label key={status}>
              <input
                type="radio"
                name="task-status-filter"
                checked={filter === status}
                onChange={() => onFilterChange(status)}
              />
              {statusLabels[status]}
            </label>
          ))}
        </div>
      </details>
      <button
        type="button"
        className="task-pane-add"
        aria-label="Create task"
        disabled={!canCreate}
        title={canCreate ? "Create task" : "Task creation is available in the desktop app"}
        onClick={onNewTask}
      >
        <Icon icon="small-plus" size={15} aria-hidden="true" />
      </button>
    </footer>
  );
}

function TaskBrowserRow({
  task,
  now,
  selected,
  tabIndex,
  position,
  statusPosition,
  statusSetSize,
  setSize,
  onSelect,
  canEdit,
  busy,
  dragging,
  dropEdge,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onStatusChange,
  onDelete,
  onKeyboardMove,
}: {
  task: Task;
  now: Date;
  selected: boolean;
  tabIndex: number;
  position: number;
  statusPosition: number;
  statusSetSize: number;
  setSize: number;
  onSelect: () => void;
  canEdit: boolean;
  busy: boolean;
  dragging: boolean;
  dropEdge: "before" | "after" | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>) => void;
  onStatusChange: (status: TaskStatus) => void;
  onDelete: () => void;
  onKeyboardMove: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const firstPerson = task.people[0];

  return (
    <ContextMenuTarget
      menu={createTaskContextMenu(task, canEdit ? {
        onStatusChange,
        onDelete,
      } : {})}
      onOpen={onSelect}
    >
      <button
        type="button"
        role="option"
        aria-selected={selected}
        aria-posinset={position + 1}
        aria-setsize={setSize}
        className={`tasks-browser-row${selected ? " is-selected" : ""}${dragging ? " is-dragging" : ""}${dropEdge ? ` is-drop-${dropEdge}` : ""}`}
        data-task-option="true"
        data-task-id={task.id}
        disabled={busy}
        draggable={canEdit && !busy}
        aria-description={canEdit ? `Position ${statusPosition + 1} of ${statusSetSize} in ${statusLabels[task.status]}` : undefined}
        aria-keyshortcuts={canEdit ? "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight" : undefined}
        onClick={onSelect}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", task.id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onKeyDown={onKeyboardMove}
        tabIndex={tabIndex}
      >
        <span
          className={`tasks-browser-status tasks-browser-status--${task.status}`}
          aria-hidden="true"
        />
        <span className="tasks-browser-copy">
          <strong className={task.status === "done" ? "is-complete" : undefined}>
            {task.title}
          </strong>
          <span className="tasks-browser-meta">
            <time
              className={isOverdue(task, now) ? "is-overdue" : undefined}
              dateTime={taskDateTime(task)}
            >
              <Icon icon="calendar" size={12} aria-hidden="true" />
              {formatTaskDue(task, now)}
            </time>
            {firstPerson ? (
              <span className="tasks-browser-context">
                <TaskPersonAvatar person={firstPerson} />
                {firstPerson.name}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </ContextMenuTarget>
  );
}

function TaskBrowserEmpty({
  filtered,
  onClearFilters,
}: {
  filtered: boolean;
  onClearFilters: () => void;
}) {
  return (
    <div className="tasks-browser-empty">
      <Icon icon={filtered ? "search" : "tick-circle"} size={24} aria-hidden="true" />
      <strong>{filtered ? "No matching tasks" : "No tasks in this group"}</strong>
      <span>
        {filtered
          ? "Try another search, group, or status."
          : "Use the + button to add the first task."}
      </span>
      {filtered ? (
        <button type="button" onClick={onClearFilters}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
