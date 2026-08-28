import { useMemo } from "react";
import {
  addDays,
  formatLocalDateKey,
  getIsoWeek,
  getMinutesSinceStartOfDay,
  isSameDay,
  isWeekend,
  startOfWeek,
} from "../../lib/calendarDate";
import {
  currentTimeFormatter,
  fullDateFormatter,
  weekdayLabels,
  weekTimeLabels,
} from "./calendarViewModel";

export function WeekView({
  anchorDate,
  currentTime,
  today,
}: {
  anchorDate: Date;
  currentTime: Date;
  today: Date;
}) {
  const weekStart = useMemo(() => startOfWeek(anchorDate), [anchorDate]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const todayIndex = days.findIndex((day) => isSameDay(day, today));
  const currentTimePosition =
    (getMinutesSinceStartOfDay(currentTime) / (24 * 60)) * 100;

  return (
    <section aria-label={`Week ${getIsoWeek(anchorDate)}`} className="calendar-week">
      <div className="calendar-week-scroll">
        <div className="calendar-week-grid" role="grid">
          <span aria-hidden="true" className="calendar-week-corner" role="columnheader" />
          {days.map((day) => {
            const isToday = isSameDay(day, today);
            return (
              <div
                className={[
                  "calendar-week-day-heading",
                  isToday ? "calendar-week-day-heading--today" : "",
                  isWeekend(day) ? "calendar-week-day-heading--weekend" : "",
                ].filter(Boolean).join(" ")}
                key={formatLocalDateKey(day)}
                role="columnheader"
              >
                <span>{weekdayLabels[(day.getDay() + 6) % 7]}</span>
                <time
                  aria-current={isToday ? "date" : undefined}
                  dateTime={formatLocalDateKey(day)}
                >
                  {day.getDate()}
                </time>
              </div>
            );
          })}

          {weekTimeLabels.map((timeLabel) => (
            <div className="calendar-week-time-row" key={timeLabel} role="row">
              <time dateTime={timeLabel}>{timeLabel}</time>
              {days.map((day) => (
                <span
                  aria-label={`${fullDateFormatter.format(day)}, ${timeLabel}`}
                  className={[
                    isSameDay(day, today) ? "calendar-week-slot--today" : "",
                    isWeekend(day) ? "calendar-week-slot--weekend" : "",
                  ].filter(Boolean).join(" ")}
                  key={`${formatLocalDateKey(day)}-${timeLabel}`}
                  role="gridcell"
                />
              ))}
            </div>
          ))}

          {todayIndex >= 0 ? (
            <div
              aria-label={`Current time ${currentTimeFormatter.format(currentTime)}`}
              className="calendar-week-current-time-column"
              role="img"
              style={{ gridColumn: todayIndex + 2, gridRow: "2 / -1" }}
            >
              <span
                aria-hidden="true"
                className="calendar-week-current-time"
                style={{ top: `${currentTimePosition}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
