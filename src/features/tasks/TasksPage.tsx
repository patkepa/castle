import { WorkspacePortal } from "@patkepa/kantzen-ui/app-shell";
import { Icon, PopoverNext } from "@patkepa/kantzen-ui/primitives";
import { InspectorWorkspace } from "@patkepa/kantzen-ui";
import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { shortcutCatalog, shortcutDisplayText } from "../../keyboard/shortcut_catalog";
import { formatLocalDateKey } from "../../lib/calendarDate";
import { useCastlePlatform } from "../../platform/castle_platform_provider";
import type { Note, Project, Task } from "../../types";
import { TaskBrowser } from "./TaskBrowser";
import { TaskGroups } from "./TaskGroups";
import { TaskForm, TaskInspector } from "./TaskInspector";
import { TaskKanban } from "./TaskKanban";
import { useTaskPageKeyboardNavigation } from "./task_page_keyboard_navigation";
import {
  defaultTaskId,
  filterTasks,
  filterTasksByGroup,
  taskCustomGroupNames,
  taskTagsWithGroup,
  tasksForWorkspace,
  type TaskFilter,
  type TaskGroupFilter,
} from "./taskPresentation";
import {
  TaskViewToggle,
  useTaskViewMode,
  type TaskViewMode,
} from "./TaskViewToggle";
import {
  emptyTaskFormValues,
  useTaskMutations,
  type TaskFormValues,
} from "./useTaskMutations";
import {
  updateCastleUserPreferences,
  useCastleUserPreferences,
} from "../../lib/userPreferences";
import { useCastleContextMenu } from "../context_menu/CastleContextMenu";
import type { CastleTaskProjectFolder } from "../../platform/user_preferences";
import { createProjectSeed } from "../../lib/projectCreation";

interface PendingProject {
  id: string;
  title: string;
}

type ProjectFolderEditor =
  | { mode: "create"; projectIds: string[]; title: string }
  | { mode: "rename"; folderId: string; title: string };

type ProjectDragItem =
  | { kind: "project"; id: string }
  | { kind: "folder"; id: string };

type ProjectDropTarget =
  | { kind: "folder"; folderId: string }
  | { kind: "project"; projectId: string };

type FolderDropTarget = { kind: "folder-reorder"; folderId: string };
type ProjectDropLocation = {
  target: ProjectDropTarget | FolderDropTarget;
  position: "before" | "after";
};

export function TasksPage({
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
  const [workspaceId, setWorkspaceId] = useState("personal");
  const [pendingProject, setPendingProject] = useState<PendingProject | null>(null);
  const [projectCreationBusy, setProjectCreationBusy] = useState(false);
  const [projectCreationError, setProjectCreationError] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<TaskGroupFilter>("all");
  const {
    taskGroups: customGroups,
    taskProjectFolders,
    taskProjectOrder,
  } = useCastleUserPreferences();
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useTaskViewMode();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() =>
    defaultTaskId(tasksForWorkspace(tasks, "personal")),
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useTaskPageKeyboardNavigation(searchInputRef);

  const now = useMemo(() => new Date(), []);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const scopedTasks = useMemo(
    () => tasksForWorkspace(tasks, workspaceId),
    [tasks, workspaceId],
  );
  const workspaceCustomGroups = useMemo(
    () => mergeGroupNames(
      customGroups[workspaceId] ?? [],
      taskCustomGroupNames(scopedTasks),
    ),
    [customGroups, scopedTasks, workspaceId],
  );
  const groupedTasks = useMemo(
    () => filterTasksByGroup(scopedTasks, selectedGroup, now),
    [now, scopedTasks, selectedGroup],
  );
  const visibleTasks = useMemo(
    () => filterTasks(groupedTasks, filter, deferredQuery),
    [deferredQuery, filter, groupedTasks],
  );
  const selectedTask = selectedTaskId === null
    ? null
    : visibleTasks.find((task) => task.id === selectedTaskId) ??
      visibleTasks[0] ??
      null;
  const isFiltered = filter !== "all" || Boolean(query) || selectedGroup !== "all";
  const taskMutations = useTaskMutations({
    tasks,
    projects,
    people,
    onTasksChange,
  });

  useEffect(() => {
    if (pendingProject && projects.some((project) => project.id === pendingProject.id)) {
      setPendingProject(null);
    }
  }, [pendingProject, projects]);

  useEffect(() => {
    if (
      workspaceId !== "personal" &&
      !projects.some((project) => project.id === workspaceId) &&
      pendingProject?.id !== workspaceId
    ) {
      setWorkspaceId("personal");
      setSelectedGroup("all");
    }
  }, [pendingProject, projects, workspaceId]);

  const closeComposer = useCallback(() => {
    if (taskMutations.busyTaskId) return;
    taskMutations.clearError();
    setComposerOpen(false);
  }, [taskMutations]);

  const selectWorkspace = useCallback((nextWorkspaceId: string) => {
    const nextTasks = tasksForWorkspace(tasks, nextWorkspaceId);
    setWorkspaceId(nextWorkspaceId);
    setSelectedGroup("all");
    setFilter("all");
    setQuery("");
    setSelectedTaskId(defaultTaskId(nextTasks));
  }, [tasks]);

  const selectGroup = useCallback((group: TaskGroupFilter) => {
    setSelectedGroup(group);
    setFilter("all");
    setSelectedTaskId(defaultTaskId(filterTasksByGroup(scopedTasks, group, now)));
  }, [now, scopedTasks]);

  const addGroup = useCallback((name: string) => {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    updateCastleUserPreferences((current) => {
      const next = {
        ...current,
        taskGroups: {
          ...current.taskGroups,
          [workspaceId]: mergeGroupNames(
            current.taskGroups[workspaceId] ?? [],
            [normalizedName],
          ),
        },
      };
      return next;
    });
    setSelectedGroup(`custom:${normalizedName}`);
  }, [workspaceId]);

  const createProjectFolder = useCallback((title: string, projectIds: string[]) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle || projectIds.length === 0) return;
    updateCastleUserPreferences((current) => ({
      ...current,
      taskProjectFolders: [
        ...current.taskProjectFolders,
        {
          id: createProjectFolderId(normalizedTitle, current.taskProjectFolders),
          title: normalizedTitle,
          projectIds: [...new Set(projectIds)],
        },
      ],
    }));
  }, []);

  const renameProjectFolder = useCallback((folderId: string, title: string) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return;
    updateCastleUserPreferences((current) => ({
      ...current,
      taskProjectFolders: current.taskProjectFolders.map((folder) =>
        folder.id === folderId ? { ...folder, title: normalizedTitle } : folder,
      ),
    }));
  }, []);

  const removeProjectFolder = useCallback((folderId: string) => {
    updateCastleUserPreferences((current) => ({
      ...current,
      taskProjectFolders: current.taskProjectFolders.filter((folder) => folder.id !== folderId),
    }));
  }, []);

  const organizeProjectTabs = useCallback((next: {
    folders: CastleTaskProjectFolder[];
    projectOrder: string[];
  }) => {
    updateCastleUserPreferences((current) => ({
      ...current,
      taskProjectFolders: next.folders,
      taskProjectOrder: next.projectOrder,
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedGroup("all");
    setFilter("all");
    setQuery("");
  }, []);

  const createProject = useCallback(async (title: string) => {
    const mutations = platform.contentMutations;
    if (!mutations || !platform.capabilities.createContent || projectCreationBusy) {
      return null;
    }

    const project = createProjectSeed(title, projects);
    setProjectCreationBusy(true);
    setProjectCreationError("");
    try {
      await mutations.createSource(project.source);
      const pending = { id: project.id, title: project.title };
      setPendingProject(pending);
      selectWorkspace(project.id);
      return pending;
    } catch (reason) {
      setProjectCreationError(projectCreationMessage(reason));
      return null;
    } finally {
      setProjectCreationBusy(false);
    }
  }, [platform, projectCreationBusy, projects, selectWorkspace]);

  const newTaskDefaults = useMemo(
    () => taskDefaultsForSelection(workspaceId, selectedGroup, now),
    [now, selectedGroup, workspaceId],
  );

  return (
    <main className="tasks-page">
      <WorkspacePortal slot="topbar">
        <div className="tasks-topbar">
          <TaskProjectTabs
            canCreate={taskMutations.canCreate}
            busy={projectCreationBusy}
            error={projectCreationError}
            pendingProject={pendingProject}
            projects={projects}
            folders={taskProjectFolders}
            projectOrder={taskProjectOrder}
            selectedId={workspaceId}
            onCreate={createProject}
            onCreateFolder={createProjectFolder}
            onRenameFolder={renameProjectFolder}
            onRemoveFolder={removeProjectFolder}
            onOrganize={organizeProjectTabs}
            onSelect={selectWorkspace}
          />
          <TaskToolbar
            query={query}
            searchInputRef={searchInputRef}
            viewMode={viewMode}
            mutationLabel={taskMutations.mutationLabel}
            onQueryChange={setQuery}
            onViewModeChange={setViewMode}
          />
        </div>
      </WorkspacePortal>

      <header className="sr-only">
        <h1>Tasks</h1>
        <p>Direct task planning across personal work and projects.</p>
      </header>

      <InspectorWorkspace
        className={`tasks-workspace tasks-workspace--${viewMode}`}
        ariaLabel="Task planning workspace"
      >
        <TaskGroups
          tasks={scopedTasks}
          customGroups={workspaceCustomGroups}
          selectedGroup={selectedGroup}
          now={now}
          onAddGroup={addGroup}
          onSelectGroup={selectGroup}
        />

        {viewMode === "list" ? (
          <TaskBrowser
            tasks={visibleTasks}
            totalTaskCount={scopedTasks.length}
            selectedTaskId={selectedTask?.id ?? null}
            now={now}
            filtered={isFiltered}
            filter={filter}
            onClearFilters={clearFilters}
            onFilterChange={setFilter}
            onNewTask={() => {
              taskMutations.clearError();
              setComposerOpen(true);
            }}
            onSelectTask={(task) => setSelectedTaskId(task.id)}
            canCreate={taskMutations.canCreate}
            canEdit={taskMutations.canEdit}
            busyTaskId={taskMutations.busyTaskId}
            onMoveTask={taskMutations.moveTask}
            onStatusChange={(task, status) => taskMutations.changeStatus(task, status)}
            onDeleteTask={(task) => {
              if (window.confirm(`Move “${task.title}” to Castle Trash?`)) {
                void taskMutations.deleteTask(task);
              }
            }}
          />
        ) : (
          <TaskKanban
            tasks={visibleTasks}
            totalTaskCount={scopedTasks.length}
            selectedTaskId={selectedTask?.id ?? null}
            now={now}
            filter={filter}
            filtered={isFiltered}
            onClearFilters={clearFilters}
            onFilterChange={setFilter}
            onNewTask={() => {
              taskMutations.clearError();
              setComposerOpen(true);
            }}
            onSelectTask={(task) => setSelectedTaskId(task.id)}
            canCreate={taskMutations.canCreate}
            canEdit={taskMutations.canEdit}
            busyTaskId={taskMutations.busyTaskId}
            onMoveTask={taskMutations.moveTask}
            onStatusChange={(task, status) => taskMutations.changeStatus(task, status)}
            onDeleteTask={(task) => {
              if (window.confirm(`Move “${task.title}” to Castle Trash?`)) {
                void taskMutations.deleteTask(task);
              }
            }}
          />
        )}

        <TaskInspector
          key={selectedTask?.id ?? "empty-task"}
          task={selectedTask}
          projects={projects}
          people={people}
          groups={workspaceCustomGroups}
          canEdit={taskMutations.canEdit}
          canDelete={taskMutations.canDelete}
          busy={taskMutations.busyTaskId === selectedTask?.id}
          error={taskMutations.error}
          onClose={() => setSelectedTaskId(null)}
          onClearError={taskMutations.clearError}
          onSave={taskMutations.saveTask}
          onStatusChange={taskMutations.changeStatus}
          onToggleSubtask={taskMutations.toggleSubtask}
          onAddSubtask={taskMutations.addSubtask}
          onRemoveSubtask={taskMutations.removeSubtask}
          onDelete={async (task) => {
            const deleted = await taskMutations.deleteTask(task);
            if (deleted) setSelectedTaskId(null);
            return deleted;
          }}
        />
      </InspectorWorkspace>

      {composerOpen ? (
        <TaskComposerDialog
          busy={Boolean(taskMutations.busyTaskId)}
          onCancel={closeComposer}
        >
          <TaskForm
            busy={Boolean(taskMutations.busyTaskId)}
            error={taskMutations.error}
            initialValues={newTaskDefaults}
            people={people}
            projects={projects}
            submitLabel="Create task"
            onCancel={closeComposer}
            onSubmit={async (values) => {
              const task = await taskMutations.createTask(values);
              if (!task) return;
              setWorkspaceId(task.project?.id ?? "personal");
              setFilter("all");
              setQuery("");
              setSelectedTaskId(task.id);
              setComposerOpen(false);
            }}
          />
        </TaskComposerDialog>
      ) : null}

      {taskMutations.deletedTask ? (
        <TaskDeletionNotice
          busy={taskMutations.busyTaskId === taskMutations.deletedTask.task.id}
          taskTitle={taskMutations.deletedTask.task.title}
          onDismiss={taskMutations.dismissDeletedTask}
          onRestore={() => void taskMutations.restoreDeletedTask()}
        />
      ) : null}
    </main>
  );
}

function TaskProjectTabs({
  canCreate,
  busy,
  error,
  pendingProject,
  projects,
  folders,
  projectOrder,
  selectedId,
  onCreate,
  onCreateFolder,
  onRenameFolder,
  onRemoveFolder,
  onOrganize,
  onSelect,
}: {
  canCreate: boolean;
  busy: boolean;
  error: string;
  pendingProject: PendingProject | null;
  projects: Project[];
  folders: CastleTaskProjectFolder[];
  projectOrder: string[];
  selectedId: string;
  onCreate: (title: string) => Promise<PendingProject | null>;
  onCreateFolder: (title: string, projectIds: string[]) => void;
  onRenameFolder: (folderId: string, title: string) => void;
  onRemoveFolder: (folderId: string) => void;
  onOrganize: (next: {
    folders: CastleTaskProjectFolder[];
    projectOrder: string[];
  }) => void;
  onSelect: (id: string) => void;
}) {
  const { openMenu } = useCastleContextMenu();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [folderEditor, setFolderEditor] = useState<ProjectFolderEditor | null>(null);
  const [draggedItem, setDraggedItem] = useState<ProjectDragItem | null>(null);
  const [dropLocation, setDropLocation] = useState<ProjectDropLocation | null>(null);
  const allProjects = useMemo(
    () => pendingProject && !projects.some(({ id }) => id === pendingProject.id)
      ? [...projects, pendingProject]
      : projects,
    [pendingProject, projects],
  );
  const selectedProjectIdSet = useMemo(() => new Set(selectedProjectIds), [selectedProjectIds]);
  const projectById = useMemo(
    () => new Map(allProjects.map((project) => [project.id, project])),
    [allProjects],
  );
  const visibleFolders = useMemo(
    () => folders.map((folder) => ({
      ...folder,
      projectIds: folder.projectIds.filter((projectId) => projectById.has(projectId)),
    })).filter((folder) => folder.projectIds.length > 0),
    [folders, projectById],
  );
  const groupedProjectIds = useMemo(
    () => new Set(visibleFolders.flatMap((folder) => folder.projectIds)),
    [visibleFolders],
  );
  const orderedProjects = useMemo(
    () => orderProjects(allProjects, projectOrder),
    [allProjects, projectOrder],
  );
  const ungroupedProjects = orderedProjects.filter((project) => !groupedProjectIds.has(project.id));
  useEffect(() => {
    setSelectedProjectIds((current) => current.filter((projectId) => projectById.has(projectId)));
  }, [projectById]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    void onCreate(title).then((created) => {
      if (!created) return;
      setDraft("");
      setAdding(false);
    });
  };

  const selectProject = (projectId: string, shiftKey: boolean) => {
    if (shiftKey) {
      setSelectedProjectIds((current) => current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]);
      return;
    }
    setSelectedProjectIds([]);
    onSelect(projectId);
  };

  const openProjectFolderMenu = (projectId: string, event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const projectIds = selectedProjectIdSet.has(projectId)
      ? selectedProjectIds
      : [projectId];
    if (!selectedProjectIdSet.has(projectId)) setSelectedProjectIds(projectIds);
    openMenu({
      kind: "Task projects",
      subject: `${projectIds.length} selected project${projectIds.length === 1 ? "" : "s"}`,
      groups: [{
        id: "organize",
        actions: [{
          id: "create-project-folder",
          label: `Create folder from ${projectIds.length} project${projectIds.length === 1 ? "" : "s"}`,
          icon: "folder-close",
          operation: {
            type: "callback",
            execute: () => {
              setFolderEditor({ mode: "create", projectIds, title: "" });
            },
          },
        }],
      }],
    }, { left: event.clientX, top: event.clientY });
  };

  const persistOrganization = (nextFolders: CastleTaskProjectFolder[], nextOrder = projectOrder) => {
    onOrganize({
      folders: nextFolders.filter((folder) => folder.projectIds.length > 0),
      projectOrder: nextOrder,
    });
  };

  const removeProjectFromFolders = (projectId: string) => visibleFolders.map((folder) => ({
    ...folder,
    projectIds: folder.projectIds.filter((id) => id !== projectId),
  }));

  const moveProject = (
    projectId: string,
    target: ProjectDropTarget,
    position: ProjectDropLocation["position"],
  ) => {
    if (target.kind === "folder") {
      const nextFolders = removeProjectFromFolders(projectId).map((folder) =>
        folder.id === target.folderId
          ? { ...folder, projectIds: [...folder.projectIds, projectId] }
          : folder,
      );
      persistOrganization(nextFolders);
      return;
    }

    const nextFolders = removeProjectFromFolders(projectId);
    if (target.kind === "project") {
      const targetFolder = nextFolders.find((folder) => folder.projectIds.includes(target.projectId));
      if (targetFolder) {
        persistOrganization(nextFolders.map((folder) => folder.id === targetFolder.id
          ? {
            ...folder,
            projectIds: reorderProjectIds(folder.projectIds, projectId, target.projectId, position),
          }
          : folder));
        return;
      }
      if (groupedProjectIds.has(projectId)) return;
    }

    const projectIds = orderProjects(allProjects, projectOrder).map(({ id }) => id);
    if (target.kind === "project") {
      persistOrganization(
        nextFolders,
        reorderProjectIds(projectIds, projectId, target.projectId, position),
      );
    }
  };

  const moveFolder = (
    folderId: string,
    beforeFolderId: string,
    position: ProjectDropLocation["position"],
  ) => {
    if (folderId === beforeFolderId) return;
    const movingFolder = visibleFolders.find((folder) => folder.id === folderId);
    if (!movingFolder) return;
    const remainingFolders = visibleFolders.filter((folder) => folder.id !== folderId);
    const beforeIndex = remainingFolders.findIndex((folder) => folder.id === beforeFolderId);
    if (beforeIndex < 0) return;
    const insertionIndex = position === "after" ? beforeIndex + 1 : beforeIndex;
    persistOrganization([
      ...remainingFolders.slice(0, insertionIndex),
      movingFolder,
      ...remainingFolders.slice(insertionIndex),
    ]);
  };

  const startDragging = (item: ProjectDragItem, event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    setDraggedItem(item);
    setDropLocation(null);
  };

  const acceptDrop = (
    event: DragEvent<HTMLElement>,
    target: ProjectDropTarget | FolderDropTarget,
  ) => {
    if (!draggedItem) return;
    event.preventDefault();
    const position = dropPosition(event);
    if (
      draggedItem.kind === "project" &&
      target.kind === "project" &&
      groupedProjectIds.has(draggedItem.id) &&
      !groupedProjectIds.has(target.projectId)
    ) {
      return;
    }
    if (
      (draggedItem.kind === "project" && target.kind === "project") ||
      (draggedItem.kind === "folder" && target.kind === "folder-reorder")
    ) {
      setDropLocation({ target, position });
    } else if (draggedItem.kind === "project" && target.kind === "folder") {
      setDropLocation({ target, position });
    }
  };

  const finishDrop = (event: DragEvent<HTMLElement>, target: ProjectDropTarget | FolderDropTarget) => {
    event.preventDefault();
    if (!draggedItem) return;
    const position = dropPosition(event);
    if (draggedItem.kind === "project" && target.kind !== "folder-reorder") {
      moveProject(draggedItem.id, target, position);
    } else if (draggedItem.kind === "folder" && target.kind === "folder-reorder") {
      moveFolder(draggedItem.id, target.folderId, position);
    }
    setDraggedItem(null);
    setDropLocation(null);
  };

  const isDropTarget = (target: ProjectDropTarget | FolderDropTarget) =>
    dropLocation !== null && sameDropTarget(dropLocation.target, target);

  const renderProjectTab = (project: Project | PendingProject) => {
    const target: ProjectDropTarget = { kind: "project", projectId: project.id };
    const dropPosition = isDropTarget(target) ? dropLocation?.position ?? null : null;
    return (
    <Fragment key={project.id}>
      <button
      type="button"
      role="tab"
      aria-selected={selectedId === project.id}
      aria-label={selectedProjectIdSet.has(project.id)
        ? `${project.title}, selected for a folder`
        : project.title}
      data-folder-selected={selectedProjectIdSet.has(project.id) || undefined}
      data-drop-position={dropPosition || undefined}
      data-organizing="true"
      draggable
      data-dragging={draggedItem?.kind === "project" && draggedItem.id === project.id || undefined}
      onClick={(event) => selectProject(project.id, event.shiftKey)}
      onContextMenu={(event) => openProjectFolderMenu(project.id, event)}
      onDragEnd={() => {
        setDraggedItem(null);
        setDropLocation(null);
      }}
      onDragOver={(event) => acceptDrop(event, target)}
      onDragStart={(event) => startDragging({ kind: "project", id: project.id }, event)}
      onDrop={(event) => finishDrop(event, target)}
    >
      {project.title}
      </button>
    </Fragment>
    );
  };

  return (
    <nav className="tasks-project-tabs" aria-label="Task projects">
      <div role="tablist" aria-label="Personal and project tasks">
        <button
          type="button"
          role="tab"
          aria-selected={selectedId === "personal"}
          onClick={() => onSelect("personal")}
        >
          <Icon icon="person" size={13} aria-hidden="true" />
          Personal
        </button>
        {visibleFolders.map((folder) => {
          const target: FolderDropTarget = { kind: "folder-reorder", folderId: folder.id };
          const dropPosition = isDropTarget(target) ? dropLocation?.position ?? null : null;
          return (
          <Fragment key={folder.id}>
            <TaskProjectFolderTab
            folder={folder}
            projects={projectById}
            selectedId={selectedId}
            organizing
            draggedItem={draggedItem}
            dropLocation={dropLocation}
            dropPosition={dropPosition}
            isDropTarget={isDropTarget({ kind: "folder", folderId: folder.id })}
            onDragEnd={() => {
              setDraggedItem(null);
              setDropLocation(null);
            }}
            onDragOver={acceptDrop}
            onDrop={finishDrop}
            onDragStart={startDragging}
            onRemove={() => onRemoveFolder(folder.id)}
            onRename={() => setFolderEditor({
              mode: "rename",
              folderId: folder.id,
              title: folder.title,
            })}
            onSelect={onSelect}
          />
          </Fragment>
          );
        })}
        {ungroupedProjects.map(renderProjectTab)}
        {adding ? (
          <form className="tasks-project-create" onSubmit={submit}>
            <input
              autoFocus
              aria-label="New project name"
              disabled={busy}
              placeholder="Project name"
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
        {!adding ? (
          <button
            type="button"
            className="tasks-project-add"
            aria-label="Create project"
            disabled={!canCreate}
            title={canCreate ? "Create project" : "Project creation is available in the desktop app"}
            onClick={() => setAdding(true)}
          >
            <Icon icon="small-plus" size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {error ? <span className="tasks-project-error" role="alert">{error}</span> : null}
      {folderEditor ? (
        <ProjectFolderDialog
          editor={folderEditor}
          onCancel={() => setFolderEditor(null)}
          onSubmit={(title) => {
            if (folderEditor.mode === "create") {
              onCreateFolder(title, folderEditor.projectIds);
              setSelectedProjectIds([]);
            } else {
              onRenameFolder(folderEditor.folderId, title);
            }
            setFolderEditor(null);
          }}
        />
      ) : null}
    </nav>
  );
}

function TaskProjectFolderTab({
  folder,
  projects,
  selectedId,
  organizing,
  draggedItem,
  dropLocation,
  dropPosition,
  isDropTarget,
  onDragEnd,
  onDragOver,
  onDrop,
  onDragStart,
  onRemove,
  onRename,
  onSelect,
}: {
  folder: CastleTaskProjectFolder;
  projects: Map<string, Project | PendingProject>;
  selectedId: string;
  organizing: boolean;
  draggedItem: ProjectDragItem | null;
  dropLocation: ProjectDropLocation | null;
  dropPosition: ProjectDropLocation["position"] | null;
  isDropTarget: boolean;
  onDragEnd: () => void;
  onDragOver: (
    event: DragEvent<HTMLElement>,
    target: ProjectDropTarget | FolderDropTarget,
  ) => void;
  onDrop: (event: DragEvent<HTMLElement>, target: ProjectDropTarget | FolderDropTarget) => void;
  onDragStart: (item: ProjectDragItem, event: DragEvent<HTMLElement>) => void;
  onRemove: () => void;
  onRename: () => void;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containsSelectedProject = folder.projectIds.includes(selectedId);

  return (
    <PopoverNext
      arrow={false}
      captureDismiss
      content={(
        <div className="tasks-project-folder-dropdown" aria-label={`${folder.title} folder`}>
          <section aria-labelledby={`${folder.id}-projects`}>
            <h2 className="sr-only" id={`${folder.id}-projects`}>Projects</h2>
            {folder.projectIds.map((projectId) => {
              const project = projects.get(projectId);
              const childDropPosition = dropLocation?.target.kind === "project" &&
                dropLocation.target.projectId === projectId
                ? dropLocation.position
                : null;
              return project ? (
                <button
                  aria-current={selectedId === project.id ? "page" : undefined}
                  data-drop-position={childDropPosition || undefined}
                  draggable={organizing}
                  key={project.id}
                  type="button"
                  onClick={() => {
                    onSelect(project.id);
                    setOpen(false);
                  }}
                  onDragEnd={onDragEnd}
                  onDragOver={(event) => onDragOver(event, {
                    kind: "project",
                    projectId: project.id,
                  })}
                  onDragStart={(event) => onDragStart({ kind: "project", id: project.id }, event)}
                  onDrop={(event) => onDrop(event, { kind: "project", projectId: project.id })}
                >
                  <Icon icon="projects" size={15} aria-hidden="true" />
                  <span>{project.title}</span>
                </button>
              ) : null;
            })}
          </section>
          <footer>
            <button
              aria-label="Rename folder"
              title="Rename folder"
              type="button"
              onClick={() => {
              onRename();
              setOpen(false);
              }}
            >
              <Icon icon="edit" size={14} aria-hidden="true" />
            </button>
            <button
              aria-label="Remove folder"
              className="is-danger"
              title="Remove folder"
              type="button"
              onClick={() => {
              onRemove();
              setOpen(false);
              }}
            >
              <Icon icon="trash" size={14} aria-hidden="true" />
            </button>
          </footer>
        </div>
      )}
      inheritDarkTheme
      isOpen={open}
      placement="bottom-start"
      popoverClassName="tasks-project-folder-popover"
      transitionDuration={0}
      onInteraction={setOpen}
    >
      <button
        aria-expanded={open}
        aria-label={`${folder.title} folder`}
        className="tasks-project-folder"
        data-active={containsSelectedProject || undefined}
        data-drop-folder={isDropTarget || undefined}
        data-drop-position={dropPosition || undefined}
        data-organizing={organizing || undefined}
        draggable={organizing}
        type="button"
        onDragEnd={onDragEnd}
        onDragOver={(event) => onDragOver(event, draggedItem?.kind === "folder"
          ? { kind: "folder-reorder", folderId: folder.id }
          : { kind: "folder", folderId: folder.id })}
        onDragStart={(event) => onDragStart({ kind: "folder", id: folder.id }, event)}
        onDrop={(event) => onDrop(event, draggedItem?.kind === "folder"
          ? { kind: "folder-reorder", folderId: folder.id }
          : { kind: "folder", folderId: folder.id })}
      >
        <Icon icon="folder-close" size={14} aria-hidden="true" />
        {folder.title}
        <Icon icon="chevron-down" size={12} aria-hidden="true" />
      </button>
    </PopoverNext>
  );
}

function dropPosition(event: DragEvent<HTMLElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  const horizontal = bounds.width >= bounds.height;
  const offset = horizontal
    ? event.clientX - bounds.left
    : event.clientY - bounds.top;
  const length = horizontal ? bounds.width : bounds.height;
  return offset < length / 2 ? "before" : "after";
}

function sameDropTarget(
  left: ProjectDropTarget | FolderDropTarget,
  right: ProjectDropTarget | FolderDropTarget,
) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "project" && right.kind === "project") {
    return left.projectId === right.projectId;
  }
  if (left.kind === "folder" && right.kind === "folder") {
    return left.folderId === right.folderId;
  }
  if (left.kind === "folder-reorder" && right.kind === "folder-reorder") {
    return left.folderId === right.folderId;
  }
  return false;
}

function ProjectFolderDialog({
  editor,
  onCancel,
  onSubmit,
}: {
  editor: ProjectFolderEditor;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(editor.title);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const isCreating = editor.mode === "create";
  return (
    <dialog
      aria-label={isCreating ? "Create project folder" : "Rename project folder"}
      className="task-project-folder-dialog"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const normalizedTitle = title.trim();
          if (normalizedTitle) onSubmit(normalizedTitle);
        }}
      >
        <header>
          <Icon icon="folder-close" size={16} aria-hidden="true" />
          <div>
            <h2>{isCreating ? "Create project folder" : "Rename project folder"}</h2>
            <p>{isCreating
              ? `${editor.projectIds.length} selected project${editor.projectIds.length === 1 ? "" : "s"} will be grouped here.`
              : "Choose a new name for this project folder."}</p>
          </div>
        </header>
        <label>
          <span>Folder name</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <footer>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit">{isCreating ? "Create folder" : "Save name"}</button>
        </footer>
      </form>
    </dialog>
  );
}

function TaskToolbar({
  query,
  searchInputRef,
  viewMode,
  mutationLabel,
  onQueryChange,
  onViewModeChange,
}: {
  query: string;
  searchInputRef: RefObject<HTMLInputElement>;
  viewMode: TaskViewMode;
  mutationLabel: string;
  onQueryChange: (query: string) => void;
  onViewModeChange: (viewMode: TaskViewMode) => void;
}) {
  return (
    <div className="tasks-toolbar" role="toolbar" aria-label="Task controls">
      {mutationLabel ? (
        <span className="tasks-save-status" role="status">
          <Icon icon="refresh" size={13} aria-hidden="true" />
          {mutationLabel}
        </span>
      ) : null}
      <label className="tasks-search">
        <Icon icon="search" size={15} aria-hidden="true" />
        <span className="sr-only">Search tasks</span>
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          aria-keyshortcuts={shortcutCatalog.tasksSearch.ariaKeyShortcuts}
          placeholder="Search tasks"
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear task search"
            onClick={() => onQueryChange("")}
          >
            <Icon icon="small-cross" size={13} aria-hidden="true" />
          </button>
        ) : (
          <kbd>{shortcutDisplayText("tasksSearch")}</kbd>
        )}
      </label>
      <TaskViewToggle value={viewMode} onChange={onViewModeChange} />
    </div>
  );
}

function TaskDeletionNotice({
  busy,
  taskTitle,
  onDismiss,
  onRestore,
}: {
  busy: boolean;
  taskTitle: string;
  onDismiss: () => void;
  onRestore: () => void;
}) {
  return (
    <aside className="task-deletion-notice" role="status">
      <Icon icon="trash" size={15} aria-hidden="true" />
      <span>
        <strong>Moved to Castle Trash</strong>
        <small>{taskTitle}</small>
      </span>
      <button type="button" disabled={busy} onClick={onRestore}>
        {busy ? "Restoring…" : "Undo"}
      </button>
      <button type="button" aria-label="Dismiss deleted task notice" onClick={onDismiss}>
        <Icon icon="cross" size={13} aria-hidden="true" />
      </button>
    </aside>
  );
}

function TaskComposerDialog({
  busy,
  children,
  onCancel,
}: {
  busy: boolean;
  children: ReactNode;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, []);

  return (
    <dialog
      aria-label="Create task"
      className="task-composer"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      {children}
    </dialog>
  );
}

function taskDefaultsForSelection(
  workspaceId: string,
  selectedGroup: TaskGroupFilter,
  now: Date,
): TaskFormValues {
  const values = emptyTaskFormValues(workspaceId === "personal" ? "" : workspaceId);
  if (selectedGroup === "today") values.targetDate = formatLocalDateKey(now);
  if (selectedGroup === "completed") values.status = "done";
  if (selectedGroup.startsWith("custom:")) {
    values.tags = taskTagsWithGroup(values.tags, selectedGroup.slice("custom:".length));
  }
  return values;
}

export function orderProjects<T extends { id: string }>(projects: T[], projectOrder: string[]) {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const orderedIds = new Set<string>();
  const orderedProjects = projectOrder.flatMap((projectId) => {
    const project = projectsById.get(projectId);
    if (!project || orderedIds.has(projectId)) return [];
    orderedIds.add(projectId);
    return [project];
  });
  return [...orderedProjects, ...projects.filter((project) => !orderedIds.has(project.id))];
}

export function reorderProjectIds(
  projectIds: string[],
  projectId: string,
  targetProjectId: string,
  position: "before" | "after" | undefined,
) {
  if (projectId === targetProjectId) return projectIds;
  const remainingProjectIds = projectIds.filter((id) => id !== projectId);
  const targetIndex = remainingProjectIds.indexOf(targetProjectId);
  if (targetIndex < 0) return remainingProjectIds;
  const insertionIndex = position === "after" ? targetIndex + 1 : targetIndex;
  return [
    ...remainingProjectIds.slice(0, insertionIndex),
    projectId,
    ...remainingProjectIds.slice(insertionIndex),
  ];
}

function snakeCaseName(value: string) {
  return value
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function createProjectFolderId(title: string, folders: CastleTaskProjectFolder[]) {
  const base = snakeCaseName(title) || "projects";
  const existingIds = new Set(folders.map((folder) => folder.id));
  let id = `task_folder_${base}`;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `task_folder_${base}_${suffix}`;
    suffix += 1;
  }
  return id;
}

function projectCreationMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "") || "Castle could not create this project.";
}

function mergeGroupNames(...groups: string[][]) {
  const names = new Map<string, string>();
  for (const name of groups.flat()) {
    const normalized = name.trim();
    if (normalized) names.set(normalized.toLocaleLowerCase(), normalized);
  }
  return [...names.values()].sort((left, right) => left.localeCompare(right));
}
