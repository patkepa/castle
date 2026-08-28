import { Icon } from "@patkepa/kantzen-ui/primitives";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link } from "react-router-dom";
import type { CalendarEvent, Task } from "../../types";
import {
  formatLocalDateKey,
  getMinutesSinceStartOfDay,
  isSameDay,
  isWeekend,
} from "../../lib/calendarDate";
import {
  calendarGridRowCount,
  calendarGridRowHeight,
  calendarGridStepMinutes,
  currentTimeFormatter,
  formatEventTime,
  formatMinuteValue,
  formatTaskEstimate,
  fullDateFormatter,
  getCalendarEventMinuteRange,
  getCalendarGridPlacement,
  getEventsForDate,
  getScheduledTaskMinuteRange,
  getScheduledTasksForDate,
  weekdayLabels,
} from "./calendarViewModel";

interface CalendarGridStyle extends CSSProperties {
  "--calendar-grid-columns": number;
  "--calendar-grid-row-height": string;
}

interface CalendarGridSelection {
  date: Date;
  dateKey: string;
  anchor: number;
  pointerId: number;
  start: number;
  end: number;
}

export function CalendarTimeGrid({
  days,
  events,
  tasks,
  currentTime,
  today,
  selectedEventId,
  onCreateEvent,
  onEditEvent,
}: {
  days: Date[];
  events: CalendarEvent[];
  tasks: Task[];
  currentTime: Date;
  today: Date;
  selectedEventId: string | null;
  onCreateEvent: (date: Date, time: string, endMinutes?: number) => void;
  onEditEvent: (event: CalendarEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<CalendarGridSelection | null>(null);
  const ignoreSlotClickRef = useRef(false);
  const initialCurrentMinutesRef = useRef(getMinutesSinceStartOfDay(currentTime));
  const [selection, setSelection] = useState<CalendarGridSelection | null>(null);
  const gridRows = useMemo(
    () => Array.from({ length: calendarGridRowCount }, (_, index) => index),
    [],
  );
  const isSingleDay = days.length === 1;
  const currentDayIndex = days.findIndex((day) => isSameDay(day, today));
  const currentMinutes = getMinutesSinceStartOfDay(currentTime);
  const visibleDaysKey = days.map(formatLocalDateKey).join(",");
  const todayKey = formatLocalDateKey(today);
  const containsToday = days.some((day) => formatLocalDateKey(day) === todayKey);
  const currentPlacement = getCalendarGridPlacement(
    currentMinutes,
    currentMinutes + calendarGridStepMinutes,
  );

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const preferredMinute = containsToday
      ? Math.max(7 * 60, initialCurrentMinutesRef.current - 90)
      : 8 * 60;
    scroller.scrollTop =
      (preferredMinute / calendarGridStepMinutes) * calendarGridRowHeight;
  }, [containsToday, visibleDaysKey]);

  const style: CalendarGridStyle = {
    "--calendar-grid-columns": days.length,
    "--calendar-grid-row-height": `${calendarGridRowHeight}px`,
    gridTemplateRows: `54px repeat(${calendarGridRowCount}, ${calendarGridRowHeight}px)`,
  };

  const startSelection = (event: ReactPointerEvent<HTMLButtonElement>, day: Date, minutes: number) => {
    if (event.button !== 0) return;

    event.preventDefault();
    const nextSelection = {
      date: day,
      dateKey: formatLocalDateKey(day),
      anchor: minutes,
      pointerId: event.pointerId,
      start: minutes,
      end: minutes + calendarGridStepMinutes,
    };
    selectionRef.current = nextSelection;
    setSelection(nextSelection);

    const finishSelection = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      window.removeEventListener("pointerup", finishSelection);
      window.removeEventListener("pointercancel", cancelSelection);

      const completedSelection = selectionRef.current;
      selectionRef.current = null;
      setSelection(null);
      if (!completedSelection) return;

      ignoreSlotClickRef.current = true;
      if (completedSelection.start === completedSelection.end - calendarGridStepMinutes) {
        onCreateEvent(day, formatMinuteValue(minutes));
        return;
      }
      onCreateEvent(
        day,
        formatMinuteValue(completedSelection.start),
        completedSelection.end,
      );
    };
    const cancelSelection = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      window.removeEventListener("pointerup", finishSelection);
      window.removeEventListener("pointercancel", cancelSelection);
      selectionRef.current = null;
      setSelection(null);
    };

    window.addEventListener("pointerup", finishSelection);
    window.addEventListener("pointercancel", cancelSelection);
  };

  const extendSelection = (
    event: ReactPointerEvent<HTMLButtonElement>,
    day: Date,
    minutes: number,
  ) => {
    const activeSelection = selectionRef.current;
    if (
      !activeSelection ||
      activeSelection.pointerId !== event.pointerId ||
      activeSelection.dateKey !== formatLocalDateKey(day)
    ) return;

    const nextSelection = {
      ...activeSelection,
      start: Math.min(activeSelection.anchor, minutes),
      end: Math.max(activeSelection.anchor, minutes) + calendarGridStepMinutes,
    };
    if (nextSelection.start === activeSelection.start && nextSelection.end === activeSelection.end) return;
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
  };

  return (
    <section
      aria-label={isSingleDay ? `${fullDateFormatter.format(days[0])} schedule` : "Week schedule"}
      className={`calendar-time-view${isSingleDay ? " calendar-time-view--day" : ""}`}
    >
      <div className="calendar-time-scroll" ref={scrollRef}>
        <div className="calendar-time-grid" role="grid" style={style}>
          <div className="calendar-grid-timezone" role="columnheader">
            {shortTimeZone(currentTime)}
          </div>
          {days.map((day, index) => {
            const dayIsToday = isSameDay(day, today);
            return (
              <button
                aria-current={dayIsToday ? "date" : undefined}
                className={[
                  "calendar-grid-day-heading",
                  dayIsToday ? "calendar-grid-day-heading--today" : "",
                  isWeekend(day) ? "calendar-grid-day-heading--weekend" : "",
                ].filter(Boolean).join(" ")}
                key={formatLocalDateKey(day)}
                onClick={() => onCreateEvent(day, "09:00")}
                role="columnheader"
                style={{ gridColumn: index + 2, gridRow: 1 }}
                type="button"
              >
                <span>{weekdayLabels[(day.getDay() + 6) % 7]}</span>
                <time dateTime={formatLocalDateKey(day)}>{day.getDate()}</time>
              </button>
            );
          })}

          {gridRows.map((rowIndex) => {
            const minutes = rowIndex * calendarGridStepMinutes;
            const showLabel = minutes % 30 === 0;
            const hourLine = minutes % 60 === 0;
            const row = rowIndex + 2;
            return (
              <div className="calendar-grid-row" key={minutes} role="row">
                <time
                  aria-hidden={!showLabel}
                  className={hourLine ? "calendar-grid-time--hour" : undefined}
                  dateTime={formatMinuteValue(minutes)}
                  style={{ gridColumn: 1, gridRow: row }}
                >
                  {showLabel ? formatMinuteValue(minutes) : ""}
                </time>
                {days.map((day, dayIndex) => (
                  <button
                    aria-label={`Add event on ${fullDateFormatter.format(day)} at ${formatMinuteValue(minutes)}`}
                    className={[
                      "calendar-grid-slot",
                      hourLine ? "calendar-grid-slot--hour" : "",
                      minutes % 30 === 0 ? "calendar-grid-slot--half-hour" : "",
                      isSameDay(day, today) ? "calendar-grid-slot--today" : "",
                      isWeekend(day) ? "calendar-grid-slot--weekend" : "",
                    ].filter(Boolean).join(" ")}
                    key={`${formatLocalDateKey(day)}-${minutes}`}
                    onClick={(event) => {
                      if (ignoreSlotClickRef.current) {
                        ignoreSlotClickRef.current = false;
                        event.preventDefault();
                        return;
                      }
                      onCreateEvent(day, formatMinuteValue(minutes));
                    }}
                    onPointerDown={(event) => startSelection(event, day, minutes)}
                    onPointerEnter={(event) => extendSelection(event, day, minutes)}
                    role="gridcell"
                    style={{ gridColumn: dayIndex + 2, gridRow: row }}
                    tabIndex={minutes % 60 === 0 ? 0 : -1}
                    type="button"
                  />
                ))}
              </div>
            );
          })}

          {selection ? (
            <div
              aria-hidden="true"
              className="calendar-grid-selection"
              style={{
                gridColumn: days.findIndex((day) => formatLocalDateKey(day) === selection.dateKey) + 2,
                gridRow: `${Math.floor(selection.start / calendarGridStepMinutes) + 2} / span ${
                  (selection.end - selection.start) / calendarGridStepMinutes
                }`,
              }}
            >
              {formatMinuteValue(selection.start)}–{formatMinuteValue(selection.end)}
            </div>
          ) : null}

          {currentDayIndex >= 0 ? (
            <div
              aria-label={`Current time ${currentTimeFormatter.format(currentTime)}`}
              className="calendar-grid-current-time"
              role="img"
              style={{
                gridColumn: currentDayIndex + 2,
                gridRow: currentPlacement.row,
              }}
            >
              <time dateTime={currentTimeFormatter.format(currentTime)}>
                {currentTimeFormatter.format(currentTime)}
              </time>
              <span aria-hidden="true" />
            </div>
          ) : null}

          {days.flatMap((day, dayIndex) =>
            getEventsForDate(events, day).map((event) => {
              const range = getCalendarEventMinuteRange(event, day);
              const placement = getCalendarGridPlacement(range.start, range.end);
              const eventTime = formatEventTime(event, day);
              return (
                <button
                  aria-label={`${eventTime}, ${event.title}. ${event.description}`}
                  aria-pressed={selectedEventId === event.id}
                  className={[
                    "calendar-grid-item",
                    "calendar-grid-event",
                    `calendar-grid-event--${event.kind}`,
                    selectedEventId === event.id ? "calendar-grid-item--selected" : "",
                    placement.span <= 3 ? "calendar-grid-item--compact" : "",
                  ].filter(Boolean).join(" ")}
                  key={`${event.id}-${formatLocalDateKey(day)}`}
                  onClick={() => onEditEvent(event)}
                  style={{
                    gridColumn: dayIndex + 2,
                    gridRow: `${placement.row} / span ${placement.span}`,
                  }}
                  type="button"
                >
                  <time>{formatMinuteValue(range.start)}</time>
                  <strong>{event.title}</strong>
                  <span>
                    <Icon
                      icon={event.kind === "work" ? "folder-close" : "people"}
                      aria-hidden="true"
                    />
                    {event.project?.title ?? (event.kind === "work" ? "Work" : "Social")}
                  </span>
                  <small>{formatMinuteValue(range.end)}</small>
                </button>
              );
            }),
          )}

          {days.flatMap((day, dayIndex) =>
            getScheduledTasksForDate(tasks, day).map((task) => {
              const range = getScheduledTaskMinuteRange(task);
              const placement = getCalendarGridPlacement(range.start, range.end);
              return (
                <Link
                  aria-label={`${task.title}, task estimated at ${formatTaskEstimate(task.estimateMinutes)}`}
                  className={[
                    "calendar-grid-item",
                    "calendar-grid-task",
                    task.status === "done" ? "calendar-grid-task--done" : "",
                    placement.span <= 3 ? "calendar-grid-item--compact" : "",
                  ].filter(Boolean).join(" ")}
                  key={task.id}
                  style={{
                    gridColumn: dayIndex + 2,
                    gridRow: `${placement.row} / span ${placement.span}`,
                  }}
                  to={task.route}
                >
                  <time>{task.targetTime}</time>
                  <strong>
                    <Icon icon={task.status === "done" ? "tick" : "small-tick"} aria-hidden="true" />
                    {task.title}
                  </strong>
                  <span>Task · {formatTaskEstimate(task.estimateMinutes)}</span>
                  <small>{formatMinuteValue(range.end)}</small>
                </Link>
              );
            }),
          )}
        </div>
      </div>
    </section>
  );
}

function shortTimeZone(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { timeZoneName: "shortOffset" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value ?? "Local";
}
