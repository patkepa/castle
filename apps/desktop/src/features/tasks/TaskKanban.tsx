import { Icon } from "@patkepa/kantzen-ui/primitives";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import type { Task, TaskStatus } from "../../types";
import { useTaskKanbanKeyboardNavigation } from "./task_kanban_keyboard_navigation";
import { TaskPersonAvatar } from "./TaskStatus";
import {
  countCompletedSubtasks,
  formatTaskDue,
  groupTasksByStatus,
  isOverdue,
  taskDateTime,
  taskStatuses,
  type TaskFilter,
} from "./taskPresentation";
import { ContextMenuTarget } from "../context_menu/CastleContextMenu";
import { createTaskContextMenu } from "../context_menu/context_menu_models";
import {
  taskMoveTargetAt,
  type TaskMoveTarget,
} from "./useTaskMutations";
import { TaskPaneFooter } from "./TaskBrowser";

export function TaskKanban({
  tasks,
  totalTaskCount,
  selectedTaskId,
  now,
  filter,
  filtered,
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
  filter: TaskFilter;
  filtered: boolean;
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
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    taskId: string;
    edge: "before" | "after";
  } | null>(null);
  const groups = groupTasksByStatus(tasks).filter(
    (group) => filter === "all" || group.status === filter,
  );
  const handleKeyDown = useTaskKanbanKeyboardNavigation({
    tasks,
    onSelectTask,
  });

  return (
    <section className="tasks-kanban" aria-label="Task Kanban board">
      <header className="task-pane-header">
        <span>
          <strong>Tasks</strong>
        </span>
        <span className="task-pane-count">{tasks.length}</span>
      </header>
      <div className="tasks-kanban-scroll">
        {canEdit && tasks.length > 0 ? (
          <p className="tasks-kanban-help">
            Drag cards to reorder or change status. Keyboard: Alt + arrow keys.
          </p>
        ) : null}
        {tasks.length > 0 ? (
          <div
            className={`tasks-kanban-board${groups.length === 1 ? " tasks-kanban-board--single" : ""}`}
            onKeyDown={handleKeyDown}
          >
            {groups.map((group) => {
              const selectedIndex = group.tasks.findIndex(
                (task) => task.id === selectedTaskId,
              );
              const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;

              return (
                <section
                  className={`tasks-kanban-column tasks-kanban-column--${group.status}`}
                  key={group.status}
                  aria-labelledby={`tasks-kanban-${group.status}`}
                >
                  <header className="tasks-kanban-column-header">
                    <span className="tasks-kanban-column-title">
                      <i aria-hidden="true" />
                      <h2 id={`tasks-kanban-${group.status}`}>{group.label}</h2>
                    </span>
                    <span className="tasks-kanban-count">
                      {group.tasks.length}
                    </span>
                  </header>

                  <div
                    className="tasks-kanban-cards"
                    role="listbox"
                    aria-label={`${group.label} tasks`}
                    aria-orientation="vertical"
                    data-kanban-column="true"
                    data-drag-active={draggedTaskId ? "true" : undefined}
                    data-drop-active={dragOverStatus === group.status ? "true" : undefined}
                    onDragEnter={(event) => {
                      if (!canEdit || !draggedTaskId) return;
                      event.preventDefault();
                      setDragOverStatus(group.status);
                    }}
                    onDragOver={(event) => {
                      if (canEdit && draggedTaskId) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDragOverStatus(group.status);
                      }
                    }}
                    onDrop={(event) => {
                      if (!canEdit || !draggedTaskId) return;
                      event.preventDefault();
                      void onMoveTask(draggedTaskId, group.status, { position: "end" });
                      setDraggedTaskId(null);
                      setDragOverStatus(null);
                      setDropTarget(null);
                    }}
                  >
                    {group.tasks.length > 0 ? (
                      group.tasks.map((task, index) => (
                        <TaskKanbanCard
                          key={task.id}
                          task={task}
                          now={now}
                          selected={selectedTaskId === task.id}
                          tabIndex={index === activeIndex ? 0 : -1}
                          position={index}
                          setSize={group.tasks.length}
                          onSelect={() => onSelectTask(task)}
                          canEdit={canEdit}
                          busy={busyTaskId === task.id}
                          dragging={draggedTaskId === task.id}
                          dropEdge={dropTarget?.taskId === task.id ? dropTarget.edge : null}
                          onDragStart={() => {
                            setDraggedTaskId(task.id);
                            setDropTarget(null);
                          }}
                          onDragEnd={() => {
                            setDraggedTaskId(null);
                            setDragOverStatus(null);
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
                          onDropAt={(event, target) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (!draggedTaskId) return;
                            void onMoveTask(
                              draggedTaskId,
                              group.status,
                              target,
                            );
                            setDraggedTaskId(null);
                            setDragOverStatus(null);
                            setDropTarget(null);
                          }}
                          onStatusChange={(status) => onStatusChange(task, status)}
                          onDelete={() => onDeleteTask(task)}
                          onKeyboardMove={(event) => {
                            if (!event.altKey) return;
                            const statusIndex = taskStatuses.indexOf(group.status);
                            if (event.key === "ArrowUp" && index > 0) {
                              event.preventDefault();
                              event.stopPropagation();
                              void onMoveTask(
                                task.id,
                                group.status,
                                taskMoveTargetAt(group.tasks, task.id, index - 1),
                              );
                            } else if (event.key === "ArrowDown" && index < group.tasks.length - 1) {
                              event.preventDefault();
                              event.stopPropagation();
                              void onMoveTask(
                                task.id,
                                group.status,
                                taskMoveTargetAt(group.tasks, task.id, index + 1),
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
                      ))
                    ) : (
                      <div className="tasks-kanban-column-empty">
                        <Icon icon="small-plus" size={13} aria-hidden="true" />
                        No tasks
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <TaskKanbanEmpty
            filtered={filtered}
            onClearFilters={onClearFilters}
          />
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
    </section>
  );
}

function TaskKanbanCard({
  task,
  now,
  selected,
  tabIndex,
  position,
  setSize,
  onSelect,
  canEdit,
  busy,
  dragging,
  dropEdge,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDropAt,
  onStatusChange,
  onDelete,
  onKeyboardMove,
}: {
  task: Task;
  now: Date;
  selected: boolean;
  tabIndex: number;
  position: number;
  setSize: number;
  onSelect: () => void;
  canEdit: boolean;
  busy: boolean;
  dragging: boolean;
  dropEdge: "before" | "after" | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onDropAt: (event: DragEvent<HTMLButtonElement>, target: TaskMoveTarget) => void;
  onStatusChange: (status: TaskStatus) => void;
  onDelete: () => void;
  onKeyboardMove: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const firstPerson = task.people[0];
  const contextLabel = task.project?.title ?? firstPerson?.name;
  const completedSubtasks = countCompletedSubtasks(task.subtasks);

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
        className={`tasks-kanban-card${selected ? " is-selected" : ""}${dragging ? " is-dragging" : ""}${dropEdge ? ` is-drop-${dropEdge}` : ""}`}
        data-task-id={task.id}
        data-task-option="true"
        disabled={busy}
        draggable={canEdit && !busy}
        aria-keyshortcuts={canEdit ? "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight" : undefined}
        onClick={onSelect}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", task.id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onKeyDown={onKeyboardMove}
        onDragOver={onDragOver}
        onDrop={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const after = dropEdge
            ? dropEdge === "after"
            : event.clientY > rect.top + rect.height / 2;
          onDropAt(event, {
            relativeToTaskId: task.id,
            edge: after ? "after" : "before",
          });
        }}
        tabIndex={tabIndex}
      >
        {canEdit ? (
          <span className="tasks-kanban-drag-handle" aria-hidden="true">
            <Icon icon="drag-handle-vertical" size={13} />
          </span>
        ) : null}
        <strong className={task.status === "done" ? "is-complete" : undefined}>
          {task.title}
        </strong>

        <span className="tasks-kanban-card-meta">
          <time
            className={isOverdue(task, now) ? "is-overdue" : undefined}
            dateTime={taskDateTime(task)}
          >
            <Icon icon="calendar" size={12} aria-hidden="true" />
            {formatTaskDue(task, now)}
          </time>
          {contextLabel ? (
            <span className="tasks-kanban-card-context">
              {firstPerson && !task.project ? (
                <TaskPersonAvatar person={firstPerson} />
              ) : (
                <Icon icon="projects" size={12} aria-hidden="true" />
              )}
              <span>{contextLabel}</span>
            </span>
          ) : null}
        </span>

        {task.subtasks.length > 0 ? (
          <span className="tasks-kanban-progress">
            <span>
              <Icon icon="small-tick" size={12} aria-hidden="true" />
              {completedSubtasks} / {task.subtasks.length}
            </span>
            <progress
              aria-label={`${completedSubtasks} of ${task.subtasks.length} checklist items complete`}
              max={task.subtasks.length}
              value={completedSubtasks}
            />
          </span>
        ) : null}
      </button>
    </ContextMenuTarget>
  );
}

function TaskKanbanEmpty({
  filtered,
  onClearFilters,
}: {
  filtered: boolean;
  onClearFilters: () => void;
}) {
  return (
    <div className="tasks-browser-empty tasks-kanban-empty">
      <Icon
        icon={filtered ? "search" : "tick-circle"}
        size={24}
        aria-hidden="true"
      />
      <strong>{filtered ? "No matching tasks" : "No tasks in this scope"}</strong>
      <span>
        {filtered
          ? "Try another search or status."
          : "Task records will appear here automatically."}
      </span>
      {filtered ? (
        <button type="button" onClick={onClearFilters}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
