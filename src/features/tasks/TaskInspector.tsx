import { Icon, PopoverNext } from "@patkepa/kantzen-ui/primitives";
import type { IconName } from "@patkepa/kantzen-ui/icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import type { Note, Project, Task, TaskStatus, TaskSubtask } from "../../types";
import { TaskPersonAvatar, TaskStatusLabel } from "./TaskStatus";
import {
  TaskDateControl,
  TaskEstimateControl,
  TaskPeopleControl,
  TaskSingleSelectControl,
  TaskTagsControl,
  TaskTimeControl,
  type TaskControlOption,
} from "./TaskInspectorControls";
import {
  countCompletedSubtasks,
  formatDuration,
  formatFullTaskDate,
  formatMetadataDate,
  statusLabels,
  taskFinalDeadline,
  taskGroupName,
  taskPublicTags,
  taskTagsWithFinalDeadline,
  taskTagsWithGroup,
  taskTagsWithPublicTags,
  taskStatuses,
} from "./taskPresentation";
import {
  taskFormValues,
  type TaskFormValues,
} from "./useTaskMutations";

const taskStatusOptions: TaskControlOption[] = taskStatuses.map((status) => ({
  label: statusLabels[status],
  value: status,
}));

export function TaskInspector({
  task,
  projects,
  people,
  groups = [],
  canEdit,
  canDelete,
  busy,
  error,
  onClose,
  onClearError,
  onSave,
  onStatusChange,
  onToggleSubtask,
  onAddSubtask,
  onRemoveSubtask,
  onDelete,
}: {
  task: Task | null;
  projects: Project[];
  people: Note[];
  groups?: string[];
  canEdit: boolean;
  canDelete: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onClearError: () => void;
  onSave: (task: Task, values: TaskFormValues) => Promise<boolean>;
  onStatusChange: (task: Task, status: TaskStatus) => Promise<boolean>;
  onToggleSubtask: (task: Task, subtaskId: string) => Promise<boolean>;
  onAddSubtask: (task: Task, title: string) => Promise<boolean>;
  onRemoveSubtask: (task: Task, subtaskId: string) => Promise<boolean>;
  onDelete: (task: Task) => Promise<boolean>;
}) {
  if (!task) {
    return (
      <section className="task-inspector task-inspector--empty">
        <Icon icon="tick-circle" size={30} aria-hidden="true" />
        <h2>Select a task</h2>
        <p>Choose a task from the browser to inspect its record.</p>
      </section>
    );
  }

  return (
    <TaskInspectorContent
      key={task.id}
      task={task}
      projects={projects}
      people={people}
      groups={groups}
      canEdit={canEdit}
      canDelete={canDelete}
      busy={busy}
      error={error}
      onClose={onClose}
      onClearError={onClearError}
      onSave={onSave}
      onStatusChange={onStatusChange}
      onToggleSubtask={onToggleSubtask}
      onAddSubtask={onAddSubtask}
      onRemoveSubtask={onRemoveSubtask}
      onDelete={onDelete}
    />
  );
}

function TaskInspectorContent({
  task,
  projects,
  people,
  groups,
  canEdit,
  canDelete,
  busy,
  error,
  onClose,
  onClearError,
  onSave,
  onStatusChange,
  onToggleSubtask,
  onAddSubtask,
  onRemoveSubtask,
  onDelete,
}: {
  task: Task;
  projects: Project[];
  people: Note[];
  groups: string[];
  canEdit: boolean;
  canDelete: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onClearError: () => void;
  onSave: (task: Task, values: TaskFormValues) => Promise<boolean>;
  onStatusChange: (task: Task, status: TaskStatus) => Promise<boolean>;
  onToggleSubtask: (task: Task, subtaskId: string) => Promise<boolean>;
  onAddSubtask: (task: Task, title: string) => Promise<boolean>;
  onRemoveSubtask: (task: Task, subtaskId: string) => Promise<boolean>;
  onDelete: (task: Task) => Promise<boolean>;
}) {
  const [newSubtask, setNewSubtask] = useState("");
  const completedSubtasks = countCompletedSubtasks(task.subtasks);
  const targetPersonId = task.people[0]?.noteId ?? "";
  const cooperatorIds = task.people.slice(1).map((person) => person.noteId);
  const publicTags = taskPublicTags(task);
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );
  const groupOptions = useMemo<TaskControlOption[]>(
    () => [
      { icon: "inbox", label: "Inbox", value: "" },
      ...groups.map((group) => ({ icon: "folder-close" as const, label: group, value: group })),
    ],
    [groups],
  );
  const personOptions = useMemo<TaskControlOption[]>(
    () => [
      { icon: "person", label: "No target person", value: "" },
      ...people.map((person) => ({ label: person.title, value: person.id })),
    ],
    [people],
  );
  const projectOptions = useMemo<TaskControlOption[]>(
    () => [
      { icon: "home", label: "Personal task", value: "" },
      ...projects.map((project) => ({ icon: "projects" as const, label: project.title, value: project.id })),
    ],
    [projects],
  );

  const saveFields = (patch: Partial<TaskFormValues>) =>
    onSave(task, { ...taskFormValues(task), ...patch });

  return (
    <section className="task-inspector" aria-label={`${task.title} details`}>
      <header className="task-inspector-header">
        <div className="task-inspector-heading">
          {canEdit ? (
            <TaskDirectTextField
              ariaLabel="Task title"
              className="task-direct-field task-direct-field--title"
              disabled={busy}
              required
              value={task.title}
              onCommit={(title) => saveFields({ title })}
            />
          ) : (
            <h2>{task.title}</h2>
          )}
        </div>
        <div className="task-inspector-header-actions">
          <TaskInspectorActions
            busy={busy}
            canDelete={canDelete}
            task={task}
            onDelete={onDelete}
          />
          <button
            type="button"
            className="task-inspector-close"
            aria-label="Close task details"
            onClick={onClose}
          >
            <Icon icon="cross" size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="task-inspector-scroll">
        {error ? (
          <TaskMutationError error={error} onDismiss={onClearError} />
        ) : null}
        {!canEdit ? (
          <p className="task-readonly-notice">
            Open this library in the Castle desktop app to edit its Markdown tasks.
          </p>
        ) : null}
        <dl className="task-metadata-grid">
          <TaskMetadata icon="properties" label="Status">
            {canEdit ? (
              <TaskSingleSelectControl
                ariaLabel="Task status"
                disabled={busy}
                options={taskStatusOptions}
                placeholder="Choose status"
                renderLeading={(option) => (
                  <span className={`task-status task-status--${option.value}`} aria-hidden="true">
                    <i />
                  </span>
                )}
                value={task.status}
                onChange={(status) => void onStatusChange(task, status as TaskStatus)}
              />
            ) : (
              <TaskStatusLabel status={task.status} />
            )}
          </TaskMetadata>
          <TaskMetadata icon="calendar" label="Date / time">
            {canEdit ? (
              <span className="task-date-time-control">
                <TaskDateControl
                  ariaLabel="Task date"
                  disabled={busy}
                  placeholder="No date"
                  value={task.targetDate}
                  onChange={(targetDate) => {
                    void saveFields({
                      targetDate,
                      targetTime: targetDate ? task.targetTime : "",
                    });
                  }}
                />
                <TaskTimeControl
                  ariaLabel="Task time"
                  disabled={busy || !task.targetDate}
                  value={task.targetTime}
                  onChange={(targetTime) => void saveFields({ targetTime })}
                />
              </span>
            ) : task.targetDate ? (
              `${formatFullTaskDate(task.targetDate)}${task.targetTime ? ` · ${task.targetTime}` : ""}`
            ) : (
              "No date"
            )}
          </TaskMetadata>
          <TaskMetadata icon="stopwatch" label="Estimate">
            {canEdit ? (
              <TaskEstimateControl
                disabled={busy}
                value={task.estimateMinutes}
                onChange={(estimateMinutes) => void saveFields({ estimateMinutes })}
              />
            ) : task.estimateMinutes > 0 ? (
              formatDuration(task.estimateMinutes)
            ) : (
              "Not estimated"
            )}
          </TaskMetadata>
          <TaskMetadata icon="calendar" label="Final deadline">
            {canEdit ? (
              <TaskDateControl
                ariaLabel="Task final deadline"
                disabled={busy}
                placeholder="No final deadline"
                value={taskFinalDeadline(task)}
                onChange={(deadline) => void saveFields({
                  tags: taskTagsWithFinalDeadline(task.tags, deadline),
                })}
              />
            ) : taskFinalDeadline(task) ? (
              formatFullTaskDate(taskFinalDeadline(task))
            ) : (
              "No final deadline"
            )}
          </TaskMetadata>
          <TaskMetadata icon="tag" label="Tags">
            {canEdit ? (
              <TaskTagsControl
                disabled={busy}
                tags={publicTags}
                onChange={(tags) => void saveFields({
                  tags: taskTagsWithPublicTags(task.tags, tags),
                })}
              />
            ) : (
              publicTags.join(", ") || "No tags"
            )}
          </TaskMetadata>
          <TaskMetadata icon="people" label="Cooperators">
            {canEdit ? (
              <TaskPeopleControl
                ariaLabel="Task cooperators"
                disabled={busy}
                people={people}
                selectedIds={cooperatorIds}
                excludedIds={targetPersonId ? [targetPersonId] : []}
                emptyLabel="No cooperators"
                onChange={(nextIds) => void saveFields({
                  peopleIds: targetPersonId ? [targetPersonId, ...nextIds] : nextIds,
                })}
              />
            ) : cooperatorIds.length > 0 ? (
              <TaskPeopleLinks people={task.people.slice(1)} />
            ) : (
              "No cooperators"
            )}
          </TaskMetadata>
          <TaskMetadata icon="folder-close" label="Group">
            {canEdit ? (
              <TaskSingleSelectControl
                ariaLabel="Task group"
                disabled={busy}
                options={groupOptions}
                placeholder="Inbox"
                value={taskGroupName(task)}
                onChange={(group) => void saveFields({
                  tags: taskTagsWithGroup(task.tags, group),
                })}
              />
            ) : (
              taskGroupName(task) || "Inbox"
            )}
          </TaskMetadata>
          <TaskMetadata icon="person" label="Target person">
            {canEdit ? (
              <TaskSingleSelectControl
                ariaLabel="Task target person"
                disabled={busy}
                options={personOptions}
                placeholder="No target person"
                renderLeading={(option) => {
                  const person = peopleById.get(option.value);
                  return person ? (
                    <TaskPersonAvatar
                      person={{
                        avatarUrl: person.avatarUrl,
                        name: person.title,
                        noteId: person.id,
                        route: person.route,
                      }}
                    />
                  ) : <Icon icon="person" size={13} aria-hidden="true" />;
                }}
                searchPlaceholder="Search people"
                value={targetPersonId}
                onChange={(nextTargetId) => {
                  void saveFields({
                    peopleIds: [nextTargetId, ...cooperatorIds]
                      .filter((id, index, ids) => id && ids.indexOf(id) === index),
                  });
                }}
              />
            ) : task.people[0] ? (
              <TaskPeopleLinks people={[task.people[0]]} />
            ) : (
              "No target person"
            )}
          </TaskMetadata>
          <TaskMetadata icon="projects" label="Project">
            {canEdit ? (
              <TaskSingleSelectControl
                ariaLabel="Task project"
                disabled={busy}
                options={projectOptions}
                placeholder="Personal task"
                searchPlaceholder="Search projects"
                value={task.project?.id ?? ""}
                onChange={(projectId) => void saveFields({ projectId })}
              />
            ) : task.project ? (
              <Link className="task-metadata-project" to={task.project.route}>
                {task.project.title}
                <Icon icon="arrow-top-right" size={11} aria-hidden="true" />
              </Link>
            ) : (
              "Personal task"
            )}
          </TaskMetadata>
        </dl>

        <section className="task-description" aria-labelledby="task-description-title">
          <header>
            <h3 id="task-description-title">Description</h3>
            <span>Markdown</span>
          </header>
          {canEdit ? (
            <TaskDirectTextField
              ariaLabel="Task description in Markdown"
              className="task-direct-field task-direct-field--description"
              disabled={busy}
              multiline
              placeholder="Write the task description in Markdown…"
              value={task.description === "Open this note to read more." ? "" : task.description}
              onCommit={(description) => saveFields({ description })}
            />
          ) : (
            <p>{task.description || "No description"}</p>
          )}
        </section>

        <section className="task-checklist" aria-labelledby="task-checklist-title">
          <header>
            <div>
              <h3 id="task-checklist-title">Checklist</h3>
              <span>{completedSubtasks} / {task.subtasks.length}</span>
            </div>
          </header>
          {task.subtasks.length > 0 ? (
            <ul>
              {task.subtasks.map((subtask) => (
                <TaskChecklistItem
                  key={subtask.id}
                  subtask={subtask}
                  editable={canEdit}
                  disabled={busy}
                  onToggle={() => void onToggleSubtask(task, subtask.id)}
                  onRemove={() => void onRemoveSubtask(task, subtask.id)}
                />
              ))}
            </ul>
          ) : (
            <div className="task-checklist-empty">
              <span aria-hidden="true">
                <Icon icon="clipboard" size={20} />
              </span>
              <strong>No checklist items yet.</strong>
              <p>Add checklist items in the note.</p>
            </div>
          )}
          {canEdit ? (
            <form
              className="task-checklist-add"
              onSubmit={(event) => {
                event.preventDefault();
                const title = newSubtask.trim();
                if (!title) return;
                void onAddSubtask(task, title).then((saved) => {
                  if (saved) setNewSubtask("");
                });
              }}
            >
              <Icon icon="small-plus" size={14} aria-hidden="true" />
              <input
                aria-label="New checklist item"
                disabled={busy}
                placeholder="Add checklist item"
                value={newSubtask}
                onChange={(event) => setNewSubtask(event.currentTarget.value)}
              />
              <button disabled={busy || !newSubtask.trim()} type="submit">Add</button>
            </form>
          ) : null}
        </section>

        <footer className="task-inspector-footer">
          {task.createdAt ? (
            <span>
              <Icon icon="calendar" size={13} aria-hidden="true" />
              Created {formatMetadataDate(task.createdAt)}
            </span>
          ) : null}
          {task.completedAt ? (
            <span>
              <Icon icon="tick-circle" size={13} aria-hidden="true" />
              Completed {formatMetadataDate(task.completedAt)}
            </span>
          ) : null}
          {task.modifiedAt ? (
            <span>
              <Icon icon="edit" size={13} aria-hidden="true" />
              Updated {formatMetadataDate(task.modifiedAt)}
            </span>
          ) : null}
        </footer>
      </div>
    </section>
  );
}

function TaskDirectTextField({
  ariaLabel,
  className,
  disabled,
  multiline = false,
  placeholder,
  required = false,
  value,
  onCommit,
}: {
  ariaLabel: string;
  className: string;
  disabled: boolean;
  multiline?: boolean;
  placeholder?: string;
  required?: boolean;
  value: string;
  onCommit: (value: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  const savingRef = useRef(false);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const commit = async () => {
    if (savingRef.current) return;
    const nextValue = draft.trim();
    if (required && !nextValue) {
      setDraft(value);
      return;
    }
    if (nextValue === value.trim()) return;
    savingRef.current = true;
    const saved = await onCommit(nextValue);
    savingRef.current = false;
    if (!saved) setDraft(value);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(value);
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const sharedProps = {
    "aria-label": ariaLabel,
    className,
    disabled,
    placeholder,
    value: draft,
    onBlur: () => {
      focusedRef.current = false;
      void commit();
    },
    onFocus: () => {
      focusedRef.current = true;
    },
    onChange: (
      event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setDraft(event.currentTarget.value),
    onKeyDown: handleKeyDown,
  };

  return multiline ? (
    <textarea {...sharedProps} rows={3} />
  ) : (
    <input {...sharedProps} required={required} />
  );
}

function TaskInspectorActions({
  busy,
  canDelete,
  task,
  onDelete,
}: {
  busy: boolean;
  canDelete: boolean;
  task: Task;
  onDelete: (task: Task) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const setPopoverOpen = (nextOpenState: boolean) => {
    setOpen(nextOpenState);
    if (!nextOpenState) setConfirmingDelete(false);
  };

  return (
    <PopoverNext
      arrow={false}
      captureDismiss
      content={confirmingDelete ? (
        <div className="task-delete-confirm">
          <span className="task-delete-confirm-icon" aria-hidden="true">
            <Icon icon="trash" size={16} />
          </span>
          <div>
            <strong>Move task to Trash?</strong>
            <p>“{task.title}” can be restored from Castle Trash.</p>
          </div>
          <footer>
            <button disabled={busy} type="button" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
            <button
              className="is-danger"
              disabled={busy}
              type="button"
              onClick={() => {
                void onDelete(task).then((deleted) => {
                  if (deleted) setOpen(false);
                });
              }}
            >
              {busy ? "Moving…" : "Move to Trash"}
            </button>
          </footer>
        </div>
      ) : (
        <div className="task-actions-menu" aria-label="Task options">
          <Link to={task.route} onClick={() => setOpen(false)}>
            <Icon icon="document-open" size={13} aria-hidden="true" />
            <span>Open Markdown note</span>
          </Link>
          {canDelete ? (
            <button
              className="is-danger"
              disabled={busy}
              type="button"
              onClick={() => setConfirmingDelete(true)}
            >
              <Icon icon="trash" size={13} aria-hidden="true" />
              <span>Move to Trash</span>
            </button>
          ) : null}
        </div>
      )}
      inheritDarkTheme
      isOpen={open}
      placement="bottom-end"
      popoverClassName="task-control-popover task-control-popover--actions"
      portalClassName="task-control-popover-portal"
      transitionDuration={0}
      onInteraction={setPopoverOpen}
    >
      <button
        aria-label="Task options"
        className="task-inspector-menu-trigger"
        type="button"
      >
        <Icon icon="more" size={17} aria-hidden="true" />
      </button>
    </PopoverNext>
  );
}

function TaskPeopleLinks({ people }: { people: Task["people"] }) {
  return (
    <span className="task-metadata-people">
      {people.map((person) => (
        <Link key={person.noteId} to={person.route}>
          <TaskPersonAvatar person={person} />
          {person.name}
        </Link>
      ))}
    </span>
  );
}

function TaskMetadata({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt>
        <Icon icon={icon} size={13} aria-hidden="true" />
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function TaskChecklistItem({
  subtask,
  editable,
  disabled,
  onToggle,
  onRemove,
}: {
  subtask: TaskSubtask;
  editable: boolean;
  disabled: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <li className={subtask.completed ? "is-complete" : undefined}>
      {editable ? (
        <button
          type="button"
          className="task-checklist-toggle"
          aria-label={`${subtask.completed ? "Mark incomplete" : "Mark complete"}: ${subtask.title}`}
          aria-pressed={subtask.completed}
          disabled={disabled}
          onClick={onToggle}
        >
          {subtask.completed ? <Icon icon="tick" size={11} /> : null}
        </button>
      ) : (
        <span className="task-checklist-toggle" aria-hidden="true">
          {subtask.completed ? <Icon icon="tick" size={11} /> : null}
        </span>
      )}
      <span>{subtask.title}</span>
      {editable ? (
        <button
          type="button"
          className="task-checklist-remove"
          aria-label={`Remove checklist item: ${subtask.title}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Icon icon="trash" size={12} aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

export function TaskForm({
  initialValues,
  projects,
  people,
  submitLabel,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  initialValues: TaskFormValues;
  projects: Project[];
  people: Note[];
  submitLabel: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (values: TaskFormValues) => void | Promise<void>;
}) {
  const [values, setValues] = useState(initialValues);
  const [tags, setTags] = useState(taskPublicTags({ tags: initialValues.tags }).join(", "));
  const [finalDeadline, setFinalDeadline] = useState(
    taskFinalDeadline({ tags: initialValues.tags }),
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!values.title.trim()) return;
    const publicTags = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    const mergedTags = taskTagsWithFinalDeadline(
      taskTagsWithPublicTags(values.tags, publicTags),
      finalDeadline,
    );
    void onSubmit({
      ...values,
      title: values.title.trim(),
      description: values.description.trim(),
      targetTime: values.targetDate ? values.targetTime : "",
      tags: mergedTags,
    });
  };

  return (
    <form className="task-form" onSubmit={submit}>
      <header className="task-form-header">
        <div>
          <span>Markdown task</span>
          <h2>{initialValues.title ? "Edit task" : "Create task"}</h2>
        </div>
        <button type="button" aria-label="Cancel task editing" disabled={busy} onClick={onCancel}>
          <Icon icon="cross" size={17} aria-hidden="true" />
        </button>
      </header>

      <div className="task-form-scroll">
        {error ? <TaskMutationError error={error} /> : null}
        <label className="task-form-field task-form-field--wide">
          <span>Title</span>
          <input
            autoFocus
            required
            disabled={busy}
            value={values.title}
            onChange={(event) => setValues({ ...values, title: event.currentTarget.value })}
          />
        </label>
        <label className="task-form-field task-form-field--wide">
          <span>Description</span>
          <textarea
            disabled={busy}
            rows={4}
            value={values.description}
            onChange={(event) => setValues({ ...values, description: event.currentTarget.value })}
          />
        </label>

        <div className="task-form-grid">
          <label className="task-form-field">
            <span>Status</span>
            <select
              disabled={busy}
              value={values.status}
              onChange={(event) => setValues({ ...values, status: event.currentTarget.value as TaskStatus })}
            >
              {taskStatuses.map((status) => (
                <option key={status} value={status}>{statusLabels[status]}</option>
              ))}
            </select>
          </label>
          <label className="task-form-field">
            <span>Project</span>
            <select
              disabled={busy}
              value={values.projectId}
              onChange={(event) => setValues({ ...values, projectId: event.currentTarget.value })}
            >
              <option value="">Personal task</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.title}</option>
              ))}
            </select>
          </label>
          <label className="task-form-field">
            <span>Due date</span>
            <input
              disabled={busy}
              type="date"
              value={values.targetDate}
              onChange={(event) => setValues({
                ...values,
                targetDate: event.currentTarget.value,
                targetTime: event.currentTarget.value ? values.targetTime : "",
              })}
            />
          </label>
          <label className="task-form-field">
            <span>Due time</span>
            <input
              disabled={busy || !values.targetDate}
              type="time"
              value={values.targetTime}
              onChange={(event) => setValues({ ...values, targetTime: event.currentTarget.value })}
            />
          </label>
          <label className="task-form-field">
            <span>Final deadline</span>
            <input
              disabled={busy}
              type="date"
              value={finalDeadline}
              onChange={(event) => setFinalDeadline(event.currentTarget.value)}
            />
          </label>
          <label className="task-form-field">
            <span>Estimate (minutes)</span>
            <input
              disabled={busy}
              min="0"
              step="5"
              type="number"
              value={values.estimateMinutes || ""}
              onChange={(event) => setValues({
                ...values,
                estimateMinutes: Math.max(0, Number(event.currentTarget.value) || 0),
              })}
            />
          </label>
          <label className="task-form-field">
            <span>Tags</span>
            <input
              disabled={busy}
              placeholder="important, errands"
              value={tags}
              onChange={(event) => setTags(event.currentTarget.value)}
            />
          </label>
        </div>

        <label className="task-form-field task-form-field--wide">
          <span>People</span>
          <select
            multiple
            disabled={busy}
            size={Math.min(6, Math.max(3, people.length))}
            value={values.peopleIds}
            onChange={(event) => setValues({
              ...values,
              peopleIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value),
            })}
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>{person.title}</option>
            ))}
          </select>
          <small>Hold ⌘ or Ctrl to select more than one person.</small>
        </label>
      </div>

      <footer className="task-form-actions">
        <span>Changes are validated before the Markdown file is replaced.</span>
        <div>
          <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="is-primary" disabled={busy || !values.title.trim()} type="submit">
            <Icon icon={busy ? "refresh" : "floppy-disk"} size={14} aria-hidden="true" />
            {busy ? "Validating…" : submitLabel}
          </button>
        </div>
      </footer>
    </form>
  );
}

function TaskMutationError({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="task-mutation-error" role="alert">
      <Icon icon="warning-sign" size={15} aria-hidden="true" />
      <span>{error}</span>
      {onDismiss ? (
        <button type="button" aria-label="Dismiss error" onClick={onDismiss}>
          <Icon icon="cross" size={13} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
