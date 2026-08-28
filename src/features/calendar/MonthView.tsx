import { Icon } from "@patkepa/kantzen-ui/primitives";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { CalendarEvent, Task } from "../../types";
import {
  formatLocalDateKey,
  isSameDay,
  isWeekend,
} from "../../lib/calendarDate";
import {
  formatBilingualMonthYear,
  fullDateFormatter,
  getEventsForDate,
  getMonthGridDays,
  getScheduledTasksForDate,
  weekdayLabels,
} from "./calendarViewModel";

const visibleItemLimit = 3;

export function MonthView({
  anchorDate,
  today,
  events,
  tasks,
  selectedEventId,
  onCreateEvent,
  onEditEvent,
  onOpenDay,
}: {
  anchorDate: Date;
  today: Date;
  events: CalendarEvent[];
  tasks: Task[];
  selectedEventId: string | null;
  onCreateEvent: (date: Date, time: string) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onOpenDay: (date: Date) => void;
}) {
  const days = useMemo(() => getMonthGridDays(anchorDate), [anchorDate]);
  const displayedMonth = anchorDate.getMonth();

  return (
    <section
      aria-label={formatBilingualMonthYear(anchorDate)}
      className="calendar-month"
      role="grid"
    >
      <div className="calendar-month-weekdays" role="row">
        {weekdayLabels.map((weekday) => (
          <span key={weekday} role="columnheader">{weekday}</span>
        ))}
      </div>
      <div className="calendar-month-days">
        {days.map((day) => {
          const dayEvents = getEventsForDate(events, day);
          const dayTasks = getScheduledTasksForDate(tasks, day);
          const items = [
            ...dayEvents.map((event) => ({ type: "event" as const, event })),
            ...dayTasks.map((task) => ({ type: "task" as const, task })),
          ].sort((left, right) => {
            const leftTime = left.type === "event" ? left.event.startTime : left.task.targetTime;
            const rightTime = right.type === "event" ? right.event.startTime : right.task.targetTime;
            return leftTime.localeCompare(rightTime);
          });
          const isToday = isSameDay(day, today);
          const isOutsideMonth = day.getMonth() !== displayedMonth;
          return (
            <div
              aria-label={fullDateFormatter.format(day)}
              className={[
                "calendar-day",
                isToday ? "calendar-day--today" : "",
                isOutsideMonth ? "calendar-day--outside" : "",
                isWeekend(day) ? "calendar-day--weekend" : "",
              ].filter(Boolean).join(" ")}
              key={formatLocalDateKey(day)}
              role="gridcell"
            >
              <div className="calendar-day-heading">
                <button
                  aria-current={isToday ? "date" : undefined}
                  aria-label={`Open ${fullDateFormatter.format(day)}`}
                  onClick={() => onOpenDay(day)}
                  type="button"
                >
                  {day.getDate()}
                </button>
                <button
                  aria-label={`Add event on ${fullDateFormatter.format(day)}`}
                  className="calendar-day-add"
                  onClick={() => onCreateEvent(day, "09:00")}
                  type="button"
                >
                  <Icon icon="plus" size={12} aria-hidden="true" />
                </button>
              </div>
              <div className="calendar-month-items">
                {items.slice(0, visibleItemLimit).map((item) =>
                  item.type === "event" ? (
                    <button
                      aria-pressed={selectedEventId === item.event.id}
                      className={[
                        "calendar-month-item",
                        `calendar-month-item--${item.event.kind}`,
                        selectedEventId === item.event.id ? "selected" : "",
                      ].filter(Boolean).join(" ")}
                      key={item.event.id}
                      onClick={() => onEditEvent(item.event)}
                      type="button"
                    >
                      <time>{item.event.startTime}</time>
                      <span>{item.event.title}</span>
                    </button>
                  ) : (
                    <Link
                      className="calendar-month-item calendar-month-item--task"
                      key={item.task.id}
                      to={item.task.route}
                    >
                      <Icon icon="small-tick" size={10} aria-hidden="true" />
                      <time>{item.task.targetTime}</time>
                      <span>{item.task.title}</span>
                    </Link>
                  ),
                )}
                {items.length > visibleItemLimit ? (
                  <button
                    className="calendar-month-more"
                    onClick={() => onOpenDay(day)}
                    type="button"
                  >
                    +{items.length - visibleItemLimit} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
