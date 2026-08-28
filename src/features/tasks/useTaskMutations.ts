import { useCallback, useMemo, useRef, useState } from "react";
import type { TaskCommand, TaskFields } from "../../generated/castle_contracts";
import { formatLocalDateKey } from "../../lib/calendarDate";
import { useCastlePlatform } from "../../platform/castle_platform_provider";
import type { Note, Project, Task, TaskStatus } from "../../types";

export interface TaskFormValues {
  title: string;
  description: string;
  status: TaskStatus;
  targetDate: string;
  targetTime: string;
  estimateMinutes: number;
  projectId: string;
  peopleIds: string[];
  tags: string[];
}

export type TaskMoveTarget =
  | { position: "start" | "end" }
  | { relativeToTaskId: string; edge: "before" | "after" };

interface DeletedTask {
  task: Task;
  sourceFile: string;
  trashId: string;
}

export function taskFormValues(task: Task): TaskFormValues {
  return {
    title: task.title,
    description: task.description === "Open this note to read more."
      ? ""
      : task.description,
    status: task.status,
    targetDate: task.targetDate,
    targetTime: task.targetTime,
    estimateMinutes: task.estimateMinutes,
    projectId: task.project?.id ?? "",
    peopleIds: task.people.map((person) => person.noteId),
    tags: task.tags,
  };
}

export function emptyTaskFormValues(projectId = ""): TaskFormValues {
  return {
    title: "",
    description: "",
    status: "todo",
    targetDate: "",
    targetTime: "",
    estimateMinutes: 0,
    projectId,
    peopleIds: [],
    tags: [],
  };
}

export function useTaskMutations({
  tasks,
  projects,
  people,
  onTasksChange,
}: {
  tasks: Task[];
  projects: Project[];
  people: Note[];
  onTasksChange: (tasks: Task[]) => void;
}) {
  const platform = useCastlePlatform();
  const mutations = platform.contentMutations;
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const busyTaskIdRef = useRef<string | null>(null);
  const [mutationLabel, setMutationLabel] = useState("");
  const [error, setError] = useState("");
  const [deletedTask, setDeletedTask] = useState<DeletedTask | null>(null);
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );
  const canEdit = Boolean(platform.capabilities.editContent && mutations);
  const canCreate = Boolean(platform.capabilities.createContent && mutations);
  const canDelete = Boolean(platform.capabilities.deleteContent && mutations);

  const persistExisting = useCallback(async (
    task: Task,
    optimisticTask: Task,
    command: TaskCommand,
    label: string,
  ) => {
    if (!mutations || !platform.capabilities.editContent || busyTaskIdRef.current) {
      return false;
    }
    const previousTasks = tasks;
    busyTaskIdRef.current = task.id;
    onTasksChange(tasks.map((candidate) =>
      candidate.id === task.id ? optimisticTask : candidate
    ));
    setBusyTaskId(task.id);
    setMutationLabel(label);
    setError("");

    try {
      const result = await mutations.mutateTask({ taskId: task.id, command });
      onTasksChange(tasks.map((candidate) =>
        candidate.id === task.id ? result.task : candidate
      ));
      return true;
    } catch (reason) {
      onTasksChange(previousTasks);
      setError(taskMutationError(reason));
      return false;
    } finally {
      busyTaskIdRef.current = null;
      setBusyTaskId(null);
      setMutationLabel("");
    }
  }, [mutations, onTasksChange, platform.capabilities.editContent, tasks]);

  const saveTask = useCallback(async (task: Task, values: TaskFormValues) => {
    const today = formatLocalDateKey(new Date());
    return persistExisting(
      task,
      taskFromValues(task, values, projectsById, peopleById, today),
      { kind: "update", fields: toTaskFields(values) },
      "Saving task…",
    );
  }, [peopleById, persistExisting, projectsById]);

  const changeStatus = useCallback(async (task: Task, status: TaskStatus) => {
    if (task.status === status) return true;
    const today = formatLocalDateKey(new Date());
    return persistExisting(
      task,
      withTaskStatus(task, status, today),
      { kind: "changeStatus", status },
      `Moving to ${status.replace("_", " ")}…`,
    );
  }, [persistExisting]);

  const moveTask = useCallback(async (
    taskId: string,
    status: TaskStatus,
    target: TaskMoveTarget,
  ) => {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return false;
    const sortOrder = taskSortOrderAt(tasks, taskId, status, target);
    if (task.status === status && task.sortOrder === sortOrder) return true;
    const today = formatLocalDateKey(new Date());
    return persistExisting(
      task,
      { ...withTaskStatus(task, status, today), sortOrder },
      { kind: "move", status, sortOrder },
      "Reordering task…",
    );
  }, [persistExisting, tasks]);

  const toggleSubtask = useCallback(async (task: Task, subtaskId: string) => {
    const index = task.subtasks.findIndex((subtask) => subtask.id === subtaskId);
    if (index < 0) return false;
    const subtasks = task.subtasks.map((subtask, itemIndex) =>
      itemIndex === index ? { ...subtask, completed: !subtask.completed } : subtask
    );
    return persistExisting(
      task,
      { ...task, subtasks },
      { kind: "toggleSubtask", subtaskId },
      "Updating checklist…",
    );
  }, [persistExisting]);

  const addSubtask = useCallback(async (task: Task, title: string) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return false;
    return persistExisting(
      task,
      {
        ...task,
        subtasks: [
          ...task.subtasks,
          {
            id: `${task.id}:subtask-${task.subtasks.length + 1}`,
            title: normalizedTitle,
            completed: false,
          },
        ],
      },
      { kind: "addSubtask", title: normalizedTitle },
      "Adding checklist item…",
    );
  }, [persistExisting]);

  const removeSubtask = useCallback(async (task: Task, subtaskId: string) => {
    const index = task.subtasks.findIndex((subtask) => subtask.id === subtaskId);
    if (index < 0) return false;
    const subtasks = task.subtasks
      .filter((_, itemIndex) => itemIndex !== index)
      .map((subtask, itemIndex) => ({
        ...subtask,
        id: `${task.id}:subtask-${itemIndex + 1}`,
      }));
    return persistExisting(
      task,
      { ...task, subtasks },
      { kind: "removeSubtask", subtaskId },
      "Removing checklist item…",
    );
  }, [persistExisting]);

  const createTask = useCallback(async (values: TaskFormValues) => {
    if (!mutations || !platform.capabilities.createContent || busyTaskIdRef.current) {
      return null;
    }
    const pendingId = "new-task";
    busyTaskIdRef.current = pendingId;
    setBusyTaskId(pendingId);
    setMutationLabel("Creating task…");
    setError("");
    try {
      const result = await mutations.createTask({ fields: toTaskFields(values) });
      onTasksChange([...tasks, result.task]);
      return result.task;
    } catch (reason) {
      setError(taskMutationError(reason));
      return null;
    } finally {
      busyTaskIdRef.current = null;
      setBusyTaskId(null);
      setMutationLabel("");
    }
  }, [mutations, onTasksChange, platform.capabilities.createContent, tasks]);

  const deleteTask = useCallback(async (task: Task) => {
    if (!mutations || !platform.capabilities.deleteContent || busyTaskIdRef.current) {
      return false;
    }
    busyTaskIdRef.current = task.id;
    setBusyTaskId(task.id);
    setMutationLabel("Deleting task…");
    setError("");
    try {
      const result = await mutations.deleteTask({ taskId: task.id });
      onTasksChange(tasks.filter((candidate) => candidate.id !== task.id));
      setDeletedTask({
        task: result.task,
        sourceFile: result.source.sourceFile,
        trashId: result.source.trashId,
      });
      return true;
    } catch (reason) {
      setError(taskMutationError(reason));
      return false;
    } finally {
      busyTaskIdRef.current = null;
      setBusyTaskId(null);
      setMutationLabel("");
    }
  }, [mutations, onTasksChange, platform.capabilities.deleteContent, tasks]);

  const restoreDeletedTask = useCallback(async () => {
    if (
      !deletedTask ||
      !mutations ||
      !platform.capabilities.deleteContent ||
      busyTaskIdRef.current
    ) {
      return false;
    }
    const { task, sourceFile, trashId } = deletedTask;
    busyTaskIdRef.current = task.id;
    setBusyTaskId(task.id);
    setMutationLabel("Restoring task…");
    setError("");
    try {
      const result = await mutations.restoreTask({
        taskId: task.id,
        noteId: task.noteId,
        sourceFile,
        trashId,
      });
      onTasksChange([
        ...tasks.filter((candidate) => candidate.id !== task.id),
        result.task,
      ]);
      setDeletedTask(null);
      return true;
    } catch (reason) {
      setError(taskMutationError(reason));
      return false;
    } finally {
      busyTaskIdRef.current = null;
      setBusyTaskId(null);
      setMutationLabel("");
    }
  }, [
    deletedTask,
    mutations,
    onTasksChange,
    platform.capabilities.deleteContent,
    tasks,
  ]);

  return {
    addSubtask,
    busyTaskId,
    canCreate,
    canDelete,
    canEdit,
    changeStatus,
    clearError: () => setError(""),
    createTask,
    deleteTask,
    deletedTask,
    dismissDeletedTask: () => setDeletedTask(null),
    error,
    moveTask,
    mutationLabel,
    removeSubtask,
    restoreDeletedTask,
    saveTask,
    toggleSubtask,
  };
}

export function taskSortOrderAt(
  tasks: Task[],
  movedTaskId: string,
  status: TaskStatus,
  target: TaskMoveTarget,
) {
  const movedTask = tasks.find((task) => task.id === movedTaskId);
  if (
    movedTask &&
    movedTask.status === status &&
    "relativeToTaskId" in target &&
    target.relativeToTaskId === movedTaskId
  ) {
    return movedTask.sortOrder;
  }
  const projectId = movedTask?.project?.id ?? "";
  const candidates = tasks
    .filter((task) =>
      task.id !== movedTaskId &&
      task.status === status &&
      (task.project?.id ?? "") === projectId
    )
    .sort(compareTaskOrder);
  const targetIndex = "position" in target
    ? target.position === "start" ? 0 : candidates.length
    : candidates.findIndex((task) => task.id === target.relativeToTaskId);
  const insertionIndex = "position" in target || targetIndex < 0
    ? targetIndex < 0 ? candidates.length : targetIndex
    : targetIndex + (target.edge === "after" ? 1 : 0);
  const index = Math.max(0, Math.min(insertionIndex, candidates.length));
  const previous = candidates[index - 1]?.sortOrder;
  const next = candidates[index]?.sortOrder;
  if (previous && next) return (previous + next) / 2;
  if (previous) return previous + 1000;
  if (next) return next / 2;
  return 1000;
}

export function taskMoveTargetAt(
  visibleTasks: Task[],
  movedTaskId: string,
  destinationIndex: number,
): TaskMoveTarget {
  const candidates = visibleTasks.filter((task) => task.id !== movedTaskId);
  const index = Math.max(0, Math.min(destinationIndex, candidates.length));
  const next = candidates[index];
  if (next) return { relativeToTaskId: next.id, edge: "before" };
  const previous = candidates[index - 1];
  return previous
    ? { relativeToTaskId: previous.id, edge: "after" }
    : { position: "end" };
}

function taskFromValues(
  task: Task,
  values: TaskFormValues,
  projectsById: Map<string, Project>,
  peopleById: Map<string, Note>,
  today: string,
): Task {
  return {
    ...task,
    title: values.title.trim(),
    description: values.description.trim() || "Open this note to read more.",
    status: values.status,
    targetDate: values.targetDate,
    targetTime: values.targetDate ? values.targetTime : "",
    estimateMinutes: values.estimateMinutes,
    completedAt: values.status === "done" ? task.completedAt || today : "",
    modifiedAt: new Date().toISOString(),
    tags: values.tags,
    people: values.peopleIds.flatMap((id) => {
      const person = peopleById.get(id);
      return person ? [toTaskPerson(person)] : [];
    }),
    project: projectsById.get(values.projectId) ?? null,
  };
}

function toTaskFields(values: TaskFormValues): TaskFields {
  return {
    title: values.title.trim(),
    description: values.description,
    status: values.status,
    targetDate: values.targetDate,
    targetTime: values.targetTime,
    estimateMinutes: values.estimateMinutes,
    projectId: values.projectId,
    peopleIds: values.peopleIds,
    tags: values.tags,
  };
}

function withTaskStatus(task: Task, status: TaskStatus, today: string): Task {
  return {
    ...task,
    status,
    completedAt: status === "done" ? task.completedAt || today : "",
    modifiedAt: new Date().toISOString(),
  };
}

function toTaskPerson(person: Note) {
  return {
    noteId: person.id,
    name: person.title,
    route: person.route,
    avatarUrl: person.avatarUrl,
  };
}

function compareTaskOrder(left: Task, right: Task) {
  const leftOrder = left.sortOrder > 0 ? left.sortOrder : Number.MAX_SAFE_INTEGER;
  const rightOrder = right.sortOrder > 0 ? right.sortOrder : Number.MAX_SAFE_INTEGER;
  return leftOrder - rightOrder || left.title.localeCompare(right.title);
}

function taskMutationError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "") || "Castle could not update this task.";
}
