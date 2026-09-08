import { Icon } from "@patkepa/kantzen-ui/primitives";
import { Link } from "react-router-dom";
import type { CalendarEvent } from "../../types";
import {
  addDays,
  getMinutesSinceStartOfDay,
  isSameDay,
} from "../../lib/calendarDate";
import {
  currentTimeFormatter,
  formatEventCount,
  formatEventTime,
  formatTimeValue,
  fullDateFormatter,
  getEventsForDate,
  getTimetablePlacement,
  timetableEndHour,
  timetableRowHeight,
  timetableStartHour,
  timetableTimeLabels,
} from "./calendarViewModel";
import { ContextMenuTarget } from "../context_menu/CastleContextMenu";
import { createCalendarEventContextMenu } from "../context_menu/context_menu_models";

export function TimetableView({
  anchorDate,
  calendarEvents,
  currentTime,
  today,
  onSelectDate,
}: {
  anchorDate: Date;
  calendarEvents: CalendarEvent[];
  currentTime: Date;
  today: Date;
  onSelectDate: (date: Date) => void;
}) {
  const tomorrow = addDays(today, 1);
  const dailyEvents = getEventsForDate(calendarEvents, anchorDate);
  const tomorrowEventCount = getEventsForDate(calendarEvents, tomorrow).length;
  const currentTimeMinutes = getMinutesSinceStartOfDay(currentTime);
  const timetableStartMinutes = timetableStartHour * 60;
  const timetableEndMinutes = timetableEndHour * 60;
  const showCurrentTime =
    isSameDay(anchorDate, today) &&
    currentTimeMinutes >= timetableStartMinutes &&
    currentTimeMinutes < timetableEndMinutes;

  return (
    <section
      aria-label={`${fullDateFormatter.format(anchorDate)} timetable`}
      className="calendar-timetable"
    >
      <div className="calendar-timetable-header">
        <div className="calendar-timetable-summary">
          <span>Day schedule</span>
          <strong>{formatEventCount(dailyEvents.length)}</strong>
        </div>
        <div aria-label="Open a nearby day" className="calendar-timetable-day-switch">
          <button
            aria-pressed={isSameDay(anchorDate, today)}
            className={isSameDay(anchorDate, today) ? "active" : undefined}
            type="button"
            onClick={() => onSelectDate(today)}
          >
            Today
          </button>
          <button
            aria-pressed={isSameDay(anchorDate, tomorrow)}
            className={isSameDay(anchorDate, tomorrow) ? "active" : undefined}
            type="button"
            onClick={() => onSelectDate(tomorrow)}
          >
            Tomorrow
            {tomorrowEventCount > 0 ? <span>{tomorrowEventCount}</span> : null}
          </button>
        </div>
      </div>

      <div className="calendar-timetable-scroll">
        <div
          className="calendar-timetable-grid"
          style={{
            gridTemplateRows: `repeat(${timetableTimeLabels.length}, ${timetableRowHeight}px)`,
          }}
        >
          {timetableTimeLabels.map((timeLabel, index) => (
            <div
              className="calendar-timetable-time-row"
              key={timeLabel}
              style={{ gridRow: index + 1 }}
            >
              <time dateTime={timeLabel}>{timeLabel}</time>
              <span aria-hidden="true" />
            </div>
          ))}

          {showCurrentTime ? (
            <div
              aria-label={`Current time ${currentTimeFormatter.format(currentTime)}`}
              className="calendar-timetable-current-time"
              role="img"
              style={{
                top:
                  ((currentTimeMinutes - timetableStartMinutes) / 60) *
                  timetableRowHeight,
              }}
            >
              <time dateTime={formatTimeValue(currentTime)}>
                {currentTimeFormatter.format(currentTime)}
              </time>
              <span aria-hidden="true" />
            </div>
          ) : null}

          {dailyEvents.length === 0 ? (
            <div className="calendar-timetable-empty">
              <Icon icon="calendar" aria-hidden="true" />
              <strong>Nothing scheduled</strong>
              <span>
                {isSameDay(anchorDate, today) && tomorrowEventCount > 0
                  ? `${formatEventCount(tomorrowEventCount)} tomorrow`
                  : "This day is clear"}
              </span>
            </div>
          ) : (
            dailyEvents.map((event) => {
              const { row, span } = getTimetablePlacement(event, anchorDate);
              const eventTime = formatEventTime(event, anchorDate);
              return (
                <ContextMenuTarget
                  key={event.id}
                  menu={createCalendarEventContextMenu(event)}
                >
                  <article
                    aria-label={`${eventTime}, ${event.title}. ${event.description}`}
                    className={[
                      "calendar-timetable-event",
                      `calendar-timetable-event--${event.kind}`,
                      span === 1 ? "calendar-timetable-event--compact" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{ gridRow: `${row} / span ${span}` }}
                    tabIndex={0}
                  >
                    <div className="calendar-timetable-event-time">
                      <Icon
                        icon={event.kind === "work" ? "briefcase" : "map-marker"}
                        aria-hidden="true"
                      />
                      <time dateTime={`${event.date}T${event.startTime}`}>
                        {eventTime}
                      </time>
                    </div>
                    <h3>{event.title}</h3>
                    <p>{event.description}</p>
                    {event.people.length > 0 ? (
                      <div aria-label="People" className="calendar-timetable-event-people">
                        {event.people.map((person) => (
                          <Link key={person.noteId} to={person.route}>
                            <Icon icon="person" aria-hidden="true" />
                            {person.name}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </article>
                </ContextMenuTarget>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
