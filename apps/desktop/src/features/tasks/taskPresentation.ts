import { startOfDay } from "../../lib/calendarDate";
import type { Task, TaskStatus, TaskSubtask } from "../../types";

export type TaskFilter = "all" | TaskStatus;
export type TaskScope = "personal" | "projects";
export type TaskWorkspaceId = "personal" | string;
export type TaskGroupFilter =
  | "all"
  | "inbox"
  | "today"
  | "upcoming"
  | "completed"
  | `custom:${string}`;
export type TaskGroupId =
  | "overdue"
  | "today"
  | "tomorrow"
  | "upcoming"
  | "no_date"
  | "completed";

export interface TaskGroup {
  id: TaskGroupId;
  label: string;
  tasks: Task[];
}

export interface TaskStatusGroup {
  status: TaskStatus;
  label: string;
  tasks: Task[];
}

export const taskFilters: readonly TaskFilter[] = [
  "all",
  "todo",
  "in_progress",
  "blocked",
  "done",
];

export const taskStatuses: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "done",
];

export const statusLabels: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

const groupLabels: Record<TaskGroupId, string> = {
  overdue: "Overdue",
  today: "Due today",
  tomorrow: "Tomorrow",
  upcoming: "Upcoming",
  no_date: "No date",
  completed: "Completed",
};

const taskGroupTagPrefix = "group:";
const taskDeadlineTagPrefix = "deadline:";

const shortDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});
const fullDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const metadataDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function tasksForScope(tasks: Task[], scope: TaskScope) {
  return tasks.filter((task) =>
    scope === "personal" ? !task.project : Boolean(task.project),
  );
}

export function tasksForWorkspace(tasks: Task[], workspaceId: TaskWorkspaceId) {
  return tasks.filter((task) =>
    workspaceId === "personal"
      ? !task.project
      : task.project?.id === workspaceId,
  );
}

export function filterTasksByGroup(
  tasks: Task[],
  group: TaskGroupFilter,
  now: Date,
) {
  if (group === "all") return tasks;
  if (group === "inbox") {
    return tasks.filter((task) => !taskGroupName(task));
  }
  if (group === "completed") {
    return tasks.filter((task) => task.status === "done");
  }
  if (group.startsWith("custom:")) {
    const groupName = group.slice("custom:".length).toLocaleLowerCase();
    return tasks.filter(
      (task) => taskGroupName(task)?.toLocaleLowerCase() === groupName,
    );
  }

  const today = startOfDay(now).getTime();
  return tasks.filter((task) => {
    if (!task.targetDate || task.status === "done") return false;
    const target = parseTaskDate(task.targetDate).getTime();
    return group === "today"
      ? target === today
      : target > today;
  });
}

export function taskGroupName(task: Pick<Task, "tags">) {
  return task.tags
    .find((tag) => tag.toLocaleLowerCase().startsWith(taskGroupTagPrefix))
    ?.slice(taskGroupTagPrefix.length)
    .trim() || "";
}

export function taskTagsWithGroup(tags: string[], groupName: string) {
  const publicAndReservedTags = tags.filter(
    (tag) => !tag.toLocaleLowerCase().startsWith(taskGroupTagPrefix),
  );
  const normalizedGroup = groupName.trim();
  return normalizedGroup
    ? [...publicAndReservedTags, `${taskGroupTagPrefix}${normalizedGroup}`]
    : publicAndReservedTags;
}

export function taskFinalDeadline(task: Pick<Task, "tags">) {
  return task.tags
    .find((tag) => tag.toLocaleLowerCase().startsWith(taskDeadlineTagPrefix))
    ?.slice(taskDeadlineTagPrefix.length)
    .trim() || "";
}

export function taskTagsWithFinalDeadline(tags: string[], deadline: string) {
  const publicAndReservedTags = tags.filter(
    (tag) => !tag.toLocaleLowerCase().startsWith(taskDeadlineTagPrefix),
  );
  const normalizedDeadline = deadline.trim();
  return normalizedDeadline
    ? [...publicAndReservedTags, `${taskDeadlineTagPrefix}${normalizedDeadline}`]
    : publicAndReservedTags;
}

export function taskPublicTags(task: Pick<Task, "tags">) {
  return task.tags.filter((tag) => {
    const normalized = tag.toLocaleLowerCase();
    return !normalized.startsWith(taskGroupTagPrefix) &&
      !normalized.startsWith(taskDeadlineTagPrefix);
  });
}

export function taskTagsWithPublicTags(tags: string[], publicTags: string[]) {
  const reservedTags = tags.filter((tag) => {
    const normalized = tag.toLocaleLowerCase();
    return normalized.startsWith(taskGroupTagPrefix) ||
      normalized.startsWith(taskDeadlineTagPrefix);
  });
  return [...publicTags, ...reservedTags];
}

export function taskCustomGroupNames(tasks: Task[]) {
  const names = new Map<string, string>();
  for (const task of tasks) {
    const name = taskGroupName(task);
    if (name) names.set(name.toLocaleLowerCase(), name);
  }
  return [...names.values()].sort((left, right) => left.localeCompare(right));
}

export function defaultTaskId(tasks: Task[]) {
  return (
    tasks.find((task) => task.status !== "done" && task.people.length > 0)?.id ??
    tasks.find((task) => task.status !== "done")?.id ??
    tasks[0]?.id ??
    ""
  );
}

export function filterTasks(
  tasks: Task[],
  filter: TaskFilter,
  normalizedQuery: string,
) {
  return tasks.filter((task) => {
    if (filter !== "all" && task.status !== filter) return false;
    if (!normalizedQuery) return true;
    return taskSearchText(task).includes(normalizedQuery);
  });
}

export function groupTasks(tasks: Task[], now: Date): TaskGroup[] {
  const grouped = new Map<TaskGroupId, Task[]>();

  for (const task of [...tasks].sort(compareTaskSortOrder)) {
    const groupId = taskGroupId(task, now);
    const group = grouped.get(groupId);
    if (group) group.push(task);
    else grouped.set(groupId, [task]);
  }

  return (
    [
      "overdue",
      "today",
      "tomorrow",
      "upcoming",
      "no_date",
      "completed",
    ] as const
  ).flatMap((id) => {
    const groupedTasks = grouped.get(id);
    return groupedTasks?.length
      ? [{ id, label: groupLabels[id], tasks: groupedTasks }]
      : [];
  });
}

export function groupTasksByStatus(tasks: Task[]): TaskStatusGroup[] {
  const grouped: Record<TaskStatus, Task[]> = {
    todo: [],
    in_progress: [],
    blocked: [],
    done: [],
  };

  for (const task of [...tasks].sort(compareTaskSortOrder)) {
    grouped[task.status].push(task);
  }

  return taskStatuses.map((status) => ({
    status,
    label: statusLabels[status],
    tasks: grouped[status],
  }));
}

export function countTaskStatuses(tasks: Task[]) {
  const counts: Record<TaskStatus, number> = {
    todo: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
  };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

export function countCompletedSubtasks(subtasks: TaskSubtask[]) {
  let completed = 0;
  for (const subtask of subtasks) {
    if (subtask.completed) completed += 1;
  }
  return completed;
}

export function formatTaskDue(task: Task, now: Date) {
  if (!task.targetDate) return "No date";
  const target = parseTaskDate(task.targetDate);
  const dayDifference = Math.round(
    (target.getTime() - startOfDay(now).getTime()) / 86_400_000,
  );
  const dateLabel =
    dayDifference === 0
      ? "Today"
      : dayDifference === 1
        ? "Tomorrow"
        : shortDateFormatter.format(target);
  return `${dateLabel}${task.targetTime ? ` · ${task.targetTime}` : ""}`;
}

export function formatFullTaskDate(value: string) {
  return fullDateFormatter.format(parseTaskDate(value));
}

export function formatMetadataDate(value: string) {
  return metadataDateFormatter.format(new Date(value));
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} hr${remainingMinutes ? ` ${remainingMinutes} min` : ""}`;
}

export function taskDateTime(task: Task) {
  if (!task.targetDate) return "";
  return `${task.targetDate}${task.targetTime ? `T${task.targetTime}` : ""}`;
}

export function isOverdue(task: Task, now: Date) {
  if (!task.targetDate || task.status === "done") return false;
  const target = new Date(
    `${task.targetDate}T${task.targetTime || "23:59"}:00`,
  );
  return target.getTime() < now.getTime();
}

export function personInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
}

function taskGroupId(task: Task, now: Date): TaskGroupId {
  if (task.status === "done") return "completed";
  if (!task.targetDate) return "no_date";

  const difference = Math.round(
    (parseTaskDate(task.targetDate).getTime() - startOfDay(now).getTime()) /
      86_400_000,
  );
  if (difference < 0) return "overdue";
  if (difference === 0) return "today";
  if (difference === 1) return "tomorrow";
  return "upcoming";
}

function taskSearchText(task: Task) {
  return [
    task.title,
    task.description,
    task.status,
    task.tags.join(" "),
    task.people.map((person) => person.name).join(" "),
    task.project?.title ?? "personal",
    task.subtasks.map((subtask) => subtask.title).join(" "),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function parseTaskDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function compareTaskSortOrder(left: Task, right: Task) {
  const leftOrder = left.sortOrder > 0 ? left.sortOrder : Number.MAX_SAFE_INTEGER;
  const rightOrder = right.sortOrder > 0 ? right.sortOrder : Number.MAX_SAFE_INTEGER;
  return leftOrder - rightOrder || left.title.localeCompare(right.title);
}
