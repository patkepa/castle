import { WorkspacePortal } from "@patkepa/kantzen-ui/app-shell";
import { Icon } from "@patkepa/kantzen-ui/primitives";
import { WorkspaceToolbar } from "@patkepa/kantzen-ui";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  addDays,
  addMonths,
  addYears,
  getIsoWeek,
  isSameDay,
  parseLocalDateKey,
  startOfDay,
  startOfWeek,
} from "../../lib/calendarDate";
import type { CalendarEvent, Note, Project, Task } from "../../types";
import { CalendarEventEditor } from "./CalendarEventEditor";
import { CalendarTimeGrid } from "./CalendarTimeGrid";
import {
  calendarEventFormValues,
  emptyCalendarEventFormValues,
  type CalendarEventFormValues,
} from "./calendarEventMarkdown";
import {
  fullDateFormatter,
  getEventsForDate,
  getScheduledTasksForDate,
} from "./calendarViewModel";
import { MonthView } from "./MonthView";
import { useCalendarEventMutations } from "./useCalendarEventMutations";
import { YearView } from "./YearView";

type CalendarView = "day" | "week" | "month" | "year";

type CalendarEditorState =
  | { mode: "create"; values: CalendarEventFormValues }
  | { mode: "edit"; eventId: string };

const calendarViews: CalendarView[] = ["day", "week", "month", "year"];
const monthFormatter = new Intl.DateTimeFormat("en-GB", { month: "long" });
const monthYearFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});

export function CalendarPage({
  events,
  tasks,
  projects,
  people,
}: {
  events: CalendarEvent[];
  tasks: Task[];
  projects: Project[];
  people: Note[];
}) {
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<CalendarView>("week");
  const [anchorDate, setAnchorDate] = useState(
    () => parseLocalDateKey(searchParams.get("date")) ?? startOfDay(new Date()),
  );
  const [editorState, setEditorState] = useState<CalendarEditorState | null>(() => {
    const eventId = searchParams.get("event");
    return eventId ? { mode: "edit", eventId } : null;
  });
  const currentTime = useCurrentTime();
  const today = startOfDay(currentTime);
  const periodLabel = formatPeriodLabel(anchorDate, view);
  const mutation = useCalendarEventMutations({ events, projects, people });
  const selectedEvent = editorState?.mode === "edit"
    ? events.find((event) => event.id === editorState.eventId) ?? null
    : null;
  const editorValues = useMemo(
    () => editorState?.mode === "create"
      ? editorState.values
      : selectedEvent
        ? calendarEventFormValues(selectedEvent)
        : null,
    [editorState, selectedEvent],
  );
  const gridDays = useMemo(
    () => view === "day"
      ? [anchorDate]
      : Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchorDate), index)),
    [anchorDate, view],
  );

  useEffect(() => {
    if (editorState?.mode === "edit" && !selectedEvent) setEditorState(null);
  }, [editorState, selectedEvent]);

  const movePeriod = (direction: -1 | 1) => {
    setAnchorDate((currentDate) => shiftPeriod(currentDate, view, direction));
  };

  const openCreate = (
    date = anchorDate,
    time = defaultStartTime(date, today, currentTime),
    endMinutes?: number,
  ) => {
    mutation.clearError();
    setAnchorDate(date);
    const values = emptyCalendarEventFormValues(localDateKey(date), time);
    setEditorState({
      mode: "create",
      values: endMinutes === undefined
        ? values
        : {
          ...values,
          endTime: endMinutes === 24 * 60 ? "00:00" : formatMinutesAsTime(endMinutes),
          endDate: endMinutes === 24 * 60 ? localDateKey(addDays(date, 1)) : "",
        },
    });
  };

  const openEvent = (event: CalendarEvent) => {
    mutation.clearError();
    setEditorState({ mode: "edit", eventId: event.id });
  };

  const closeEditor = () => {
    if (mutation.busyEventId) return;
    mutation.clearError();
    setEditorState(null);
  };

  return (
    <>
      <WorkspacePortal slot="topbar">
        <WorkspaceToolbar ariaLabel="Calendar controls" className="calendar-topbar">
              <div className="calendar-topbar-actions">
                {mutation.mutationLabel ? (
                  <span className="calendar-mutation-label" role="status">
                    {mutation.mutationLabel}
                  </span>
                ) : null}
                <button
                  className="calendar-today-button"
                  type="button"
                  onClick={() => setAnchorDate(today)}
                >
                  <Icon icon="calendar" aria-hidden="true" />
                  Today
                </button>
                <div className="calendar-view-switch" aria-label="Calendar view">
                  {calendarViews.map((calendarView) => (
                    <button
                      aria-pressed={view === calendarView}
                      className={view === calendarView ? "active" : undefined}
                      key={calendarView}
                      type="button"
                      onClick={() => setView(calendarView)}
                    >
                      {capitalize(calendarView)}
                    </button>
                  ))}
                </div>
                {mutation.canCreate ? (
                  <button
                    className="calendar-new-event"
                    title="Create a calendar event"
                    type="button"
                    onClick={() => openCreate()}
                  >
                    <Icon icon="plus" aria-hidden="true" />
                    New event
                  </button>
                ) : null}
              </div>
        </WorkspaceToolbar>
      </WorkspacePortal>

      <main className={`calendar-page${editorState ? " calendar-page--editing" : ""}`}>
        <section className="calendar-main">
          <header className="calendar-toolbar">
            <div className="calendar-period-controls">
              <button
                aria-label={`Previous ${view}`}
                className="calendar-icon-button"
                type="button"
                onClick={() => movePeriod(-1)}
              >
                <Icon icon="chevron-left" aria-hidden="true" />
              </button>
              <button
                aria-label={`Next ${view}`}
                className="calendar-icon-button"
                type="button"
                onClick={() => movePeriod(1)}
              >
                <Icon icon="chevron-right" aria-hidden="true" />
              </button>
            </div>
            <div className="calendar-period-heading" aria-live="polite">
              <h1>{periodLabel}</h1>
              <span>{getPeriodDetail(anchorDate, view, today, events, tasks)}</span>
            </div>
            {mutation.canCreate ? (
              <button
                className="calendar-inline-new-event"
                type="button"
                onClick={() => openCreate()}
              >
                <Icon icon="plus" aria-hidden="true" />
                <span>New event</span>
              </button>
            ) : null}
          </header>

          {view === "day" || view === "week" ? (
            <CalendarTimeGrid
              currentTime={currentTime}
              days={gridDays}
              events={events}
              onCreateEvent={mutation.canCreate ? openCreate : undefined}
              onEditEvent={openEvent}
              selectedEventId={selectedEvent?.id ?? null}
              tasks={tasks}
              today={today}
            />
          ) : view === "month" ? (
            <MonthView
              anchorDate={anchorDate}
              events={events}
              onCreateEvent={mutation.canCreate ? openCreate : undefined}
              onEditEvent={openEvent}
              onOpenDay={(date) => {
                setAnchorDate(date);
                setView("day");
              }}
              selectedEventId={selectedEvent?.id ?? null}
              tasks={tasks}
              today={today}
            />
          ) : (
            <YearView
              anchorDate={anchorDate}
              today={today}
              onOpenMonth={(month) => {
                setAnchorDate(month);
                setView("month");
              }}
            />
          )}
        </section>

        {editorState && editorValues ? (
          <CalendarEventEditor
            busy={mutation.busyEventId === (selectedEvent?.id ?? "new-event")}
            canDelete={mutation.canDelete}
            canEdit={editorState.mode === "create" ? mutation.canCreate : mutation.canEdit}
            initialValues={editorValues}
            key={selectedEvent?.id ?? `${editorValues.date}-${editorValues.startTime}`}
            mode={editorState.mode}
            mutationError={mutation.error}
            people={people}
            projects={projects}
            onClose={closeEditor}
            onDelete={selectedEvent ? async () => {
              if (!window.confirm(`Move “${selectedEvent.title}” to Castle Trash?`)) {
                return false;
              }
              const deleted = await mutation.deleteEvent(selectedEvent);
              if (deleted) setEditorState(null);
              return deleted;
            } : undefined}
            onSave={async (values) => {
              const saved = selectedEvent
                ? await mutation.saveEvent(selectedEvent, values)
                : await mutation.createEvent(values);
              if (saved) {
                setAnchorDate(parseLocalDateKey(values.date) ?? anchorDate);
                setEditorState(null);
              }
              return saved;
            }}
          />
        ) : null}
      </main>

      {mutation.deletedEvent ? (
        <div className="calendar-undo-toast" role="status">
          <span>“{mutation.deletedEvent.event.title}” moved to Castle Trash.</span>
          <button type="button" onClick={() => void mutation.restoreDeletedEvent()}>
            Undo
          </button>
          <button
            aria-label="Dismiss"
            type="button"
            onClick={mutation.dismissDeletedEvent}
          >
            <Icon icon="cross" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  );
}

function shiftPeriod(date: Date, view: CalendarView, direction: -1 | 1) {
  if (view === "day") return addDays(date, direction);
  if (view === "week") return addDays(date, direction * 7);
  if (view === "month") return addMonths(date, direction);
  return addYears(date, direction);
}

function formatPeriodLabel(date: Date, view: CalendarView) {
  if (view === "day") return fullDateFormatter.format(date);
  if (view === "month") return monthYearFormatter.format(date);
  if (view === "year") return String(date.getFullYear());

  const start = startOfWeek(date);
  const end = addDays(start, 6);
  if (start.getFullYear() !== end.getFullYear()) {
    return `${formatEnglishDayMonth(start, true)} – ${formatEnglishDayMonth(end, true)}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${formatEnglishDayMonth(start)} – ${formatEnglishDayMonth(end, true)}`;
  }
  return `${start.getDate()}–${end.getDate()} ${monthFormatter.format(end)} ${end.getFullYear()}`;
}

function formatEnglishDayMonth(date: Date, includeYear = false) {
  return `${date.getDate()} ${monthFormatter.format(date)}${
    includeYear ? ` ${date.getFullYear()}` : ""
  }`;
}

function getPeriodDetail(
  date: Date,
  view: CalendarView,
  today: Date,
  events: CalendarEvent[],
  tasks: Task[],
) {
  if (view === "day") {
    const relativeDay = isSameDay(date, today)
      ? "Today"
      : isSameDay(date, addDays(today, 1))
        ? "Tomorrow"
        : `Week ${getIsoWeek(date)}`;
    return `${relativeDay} · ${formatItemCounts(
      getEventsForDate(events, date).length,
      getScheduledTasksForDate(tasks, date).length,
    )}`;
  }
  if (view === "week") {
    const days = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(date), index));
    const eventIds = new Set(days.flatMap((day) => getEventsForDate(events, day).map((event) => event.id)));
    const taskIds = new Set(days.flatMap((day) => getScheduledTasksForDate(tasks, day).map((task) => task.id)));
    return `Week ${getIsoWeek(date)} · ${formatItemCounts(eventIds.size, taskIds.size)}`;
  }
  if (view === "month") {
    const month = date.getMonth();
    const year = date.getFullYear();
    const eventCount = events.filter((event) => {
      const eventDate = parseLocalDateKey(event.date);
      return eventDate?.getMonth() === month && eventDate.getFullYear() === year;
    }).length;
    const taskCount = tasks.filter((task) => {
      const taskDate = parseLocalDateKey(task.targetDate);
      return task.targetTime && task.estimateMinutes > 0 &&
        taskDate?.getMonth() === month && taskDate.getFullYear() === year;
    }).length;
    return formatItemCounts(eventCount, taskCount);
  }
  return "12 months";
}

function formatItemCounts(events: number, tasks: number) {
  return `${events} ${events === 1 ? "event" : "events"} · ${tasks} ${
    tasks === 1 ? "task" : "tasks"
  }`;
}

function defaultStartTime(date: Date, today: Date, now: Date) {
  if (!isSameDay(date, today)) return "09:00";
  const roundedMinutes = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
  const normalized = Math.min(23 * 60 + 45, roundedMinutes);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60,
  ).padStart(2, "0")}`;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function formatMinutesAsTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60,
  ).padStart(2, "0")}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function useCurrentTime() {
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    const now = new Date();
    const millisecondsUntilNextMinute =
      60_000 - (now.getSeconds() * 1_000 + now.getMilliseconds());
    let intervalId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      setCurrentTime(new Date());
      intervalId = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    }, millisecondsUntilNextMinute);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  return currentTime;
}
