import { Icon } from "@patkepa/kantzen-ui/primitives";
import { useEffect, useState, type FormEvent } from "react";
import type { Note, Project } from "../../types";
import {
  validateCalendarEventForm,
  type CalendarEventFormValues,
} from "./calendarEventMarkdown";

export function CalendarEventEditor({
  mode,
  initialValues,
  projects,
  people,
  canEdit,
  canDelete,
  busy,
  mutationError,
  onClose,
  onDelete,
  onSave,
}: {
  mode: "create" | "edit";
  initialValues: CalendarEventFormValues;
  projects: Project[];
  people: Note[];
  canEdit: boolean;
  canDelete: boolean;
  busy: boolean;
  mutationError: string;
  onClose: () => void;
  onDelete?: () => Promise<boolean>;
  onSave: (values: CalendarEventFormValues) => Promise<boolean>;
}) {
  const [values, setValues] = useState(initialValues);
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    setValues(initialValues);
    setValidationError("");
  }, [initialValues]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextError = validateCalendarEventForm(values);
    setValidationError(nextError);
    if (nextError || !canEdit) return;
    await onSave(values);
  };

  const error = validationError || mutationError;
  const disabled = busy || !canEdit;

  return (
    <aside
      aria-label={mode === "create" ? "New event" : `Edit ${values.title}`}
      className="calendar-event-editor"
    >
      <header className="calendar-event-editor-header">
        <div>
          <Icon icon={mode === "create" ? "plus" : "edit"} aria-hidden="true" />
          <h2>{mode === "create" ? "New event" : "Edit event"}</h2>
        </div>
        <button
          aria-label="Close event editor"
          className="calendar-editor-close"
          disabled={busy}
          onClick={onClose}
          type="button"
        >
          <Icon icon="cross" aria-hidden="true" />
        </button>
      </header>

      <form className="calendar-event-form" onSubmit={submit}>
        <div className="calendar-event-form-scroll">
          {!canEdit ? (
            <p className="calendar-readonly-notice">
              Open this library in the Castle desktop app to edit its Markdown events.
            </p>
          ) : null}
          {error ? (
            <div className="calendar-event-form-error" role="alert">
              <Icon icon="warning-sign" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <label className="calendar-form-field calendar-form-field--wide">
            <span>Title</span>
            <input
              autoFocus
              disabled={disabled}
              placeholder="Event title"
              value={values.title}
              onChange={(event) => setValues({
                ...values,
                title: event.currentTarget.value,
              })}
            />
          </label>

          <div className="calendar-form-row calendar-form-row--date">
            <label className="calendar-form-field">
              <span>Date</span>
              <input
                disabled={disabled}
                type="date"
                value={values.date}
                onChange={(event) => setValues({
                  ...values,
                  date: event.currentTarget.value,
                  endDate: values.endDate && event.currentTarget.value > values.endDate
                    ? event.currentTarget.value
                    : values.endDate,
                })}
              />
            </label>
            <label className="calendar-form-field">
              <span>End date</span>
              <input
                disabled={disabled || !values.endTime}
                min={values.date}
                type="date"
                value={values.endDate}
                onChange={(event) => setValues({
                  ...values,
                  endDate: event.currentTarget.value,
                })}
              />
            </label>
          </div>

          <div className="calendar-form-row">
            <label className="calendar-form-field">
              <span>Start</span>
              <input
                disabled={disabled}
                type="time"
                value={values.startTime}
                onChange={(event) => setValues({
                  ...values,
                  startTime: event.currentTarget.value,
                })}
              />
            </label>
            <label className="calendar-form-field">
              <span>End</span>
              <input
                disabled={disabled}
                type="time"
                value={values.endTime}
                onChange={(event) => setValues({
                  ...values,
                  endTime: event.currentTarget.value,
                  endDate: event.currentTarget.value ? values.endDate : "",
                })}
              />
            </label>
          </div>

          <div className="calendar-form-row calendar-form-row--date">
            <label className="calendar-form-field">
              <span>Repeat</span>
              <select
                disabled={disabled}
                value={values.recurrence}
                onChange={(event) => setValues({
                  ...values,
                  recurrence: event.currentTarget.value as CalendarEventFormValues["recurrence"],
                  repeatUntil: event.currentTarget.value === "weekly" ? values.repeatUntil : "",
                })}
              >
                <option value="none">Does not repeat</option>
                <option value="weekly">Every week</option>
              </select>
            </label>
            <label className="calendar-form-field">
              <span>Repeat until</span>
              <input
                disabled={disabled || values.recurrence !== "weekly"}
                min={values.date}
                type="date"
                value={values.repeatUntil}
                onChange={(event) => setValues({
                  ...values,
                  repeatUntil: event.currentTarget.value,
                })}
              />
            </label>
          </div>

          <fieldset className="calendar-form-field calendar-kind-field" disabled={disabled}>
            <legend>Kind</legend>
            <div>
              <label className={values.kind === "work" ? "active" : undefined}>
                <input
                  checked={values.kind === "work"}
                  name="event-kind"
                  type="radio"
                  value="work"
                  onChange={() => setValues({ ...values, kind: "work" })}
                />
                <Icon icon="briefcase" aria-hidden="true" />
                Work
              </label>
              <label className={values.kind === "social" ? "active" : undefined}>
                <input
                  checked={values.kind === "social"}
                  name="event-kind"
                  type="radio"
                  value="social"
                  onChange={() => setValues({ ...values, kind: "social" })}
                />
                <Icon icon="people" aria-hidden="true" />
                Social
              </label>
            </div>
          </fieldset>

          <label className="calendar-form-field calendar-form-field--wide">
            <span>Project</span>
            <span className="calendar-select-wrap">
              <Icon icon="folder-close" aria-hidden="true" />
              <select
                disabled={disabled}
                value={values.projectId}
                onChange={(event) => setValues({
                  ...values,
                  projectId: event.currentTarget.value,
                })}
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.title}</option>
                ))}
              </select>
            </span>
          </label>

          <label className="calendar-form-field calendar-form-field--wide">
            <span>People</span>
            <select
              className="calendar-people-select"
              disabled={disabled}
              multiple
              size={Math.min(3, Math.max(1, people.length))}
              value={values.peopleIds}
              onChange={(event) => setValues({
                ...values,
                peopleIds: Array.from(
                  event.currentTarget.selectedOptions,
                  (option) => option.value,
                ),
              })}
            >
              {people.length === 0 ? <option disabled>No people available</option> : null}
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.title}</option>
              ))}
            </select>
            <small>Hold Command or Control to select several people.</small>
          </label>

          <label className="calendar-form-field calendar-form-field--wide">
            <span>Description</span>
            <textarea
              disabled={disabled}
              placeholder="What is this event about?"
              rows={6}
              value={values.description}
              onChange={(event) => setValues({
                ...values,
                description: event.currentTarget.value,
              })}
            />
          </label>
        </div>

        <footer className="calendar-event-form-footer">
          {mode === "edit" && onDelete ? (
            <button
              className="calendar-delete-event"
              disabled={busy || !canDelete}
              onClick={() => void onDelete()}
              type="button"
            >
              <Icon icon="trash" aria-hidden="true" />
              Delete event
            </button>
          ) : <span />}
          <button
            className="calendar-save-event"
            disabled={disabled}
            type="submit"
          >
            <Icon icon="floppy-disk" aria-hidden="true" />
            {busy
              ? "Saving…"
              : mode === "create"
                ? "Create event"
                : "Save changes"}
          </button>
        </footer>
      </form>
    </aside>
  );
}
