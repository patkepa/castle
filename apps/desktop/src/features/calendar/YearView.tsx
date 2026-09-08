import { useMemo } from "react";
import { Icon } from "@patkepa/kantzen-ui/primitives";
import {
  formatLocalDateKey,
  isSameDay,
  isWeekend,
} from "../../lib/calendarDate";
import {
  formatBilingualMonth,
  formatBilingualMonthYear,
  fullDateFormatter,
  getMonthGridDays,
  weekdayLabels,
} from "./calendarViewModel";

export function YearView({
  anchorDate,
  today,
  onOpenMonth,
}: {
  anchorDate: Date;
  today: Date;
  onOpenMonth: (month: Date) => void;
}) {
  const year = anchorDate.getFullYear();
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, month) => new Date(year, month, 1)),
    [year],
  );
  return (
    <section aria-label={`${year} calendar`} className="calendar-year">
      {months.map((month) => (
        <MiniMonth
          date={month}
          key={month.getMonth()}
          today={today}
          onOpen={() => onOpenMonth(month)}
        />
      ))}
    </section>
  );
}

function MiniMonth({
  date,
  today,
  onOpen,
}: {
  date: Date;
  today: Date;
  onOpen: () => void;
}) {
  const days = useMemo(() => getMonthGridDays(date, 6), [date]);
  const month = date.getMonth();
  return (
    <article className="calendar-mini-month">
      <button type="button" onClick={onOpen}>
        <span>{formatBilingualMonth(date)}</span>
        <Icon icon="arrow-right" aria-hidden="true" />
      </button>
      <div className="calendar-mini-weekdays" aria-hidden="true">
        {weekdayLabels.map((weekday) => (
          <span key={weekday}>{weekday.slice(0, 1)}</span>
        ))}
      </div>
      <div
        aria-label={formatBilingualMonthYear(date)}
        className="calendar-mini-days"
        role="grid"
      >
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          const belongsToMonth = day.getMonth() === month;
          return (
            <span
              aria-label={belongsToMonth ? fullDateFormatter.format(day) : undefined}
              className={[
                isToday ? "calendar-mini-day--today" : "",
                !belongsToMonth ? "calendar-mini-day--empty" : "",
                isWeekend(day) ? "calendar-mini-day--weekend" : "",
              ].filter(Boolean).join(" ")}
              key={formatLocalDateKey(day)}
              role="gridcell"
            >
              {belongsToMonth ? (
                <time
                  aria-current={isToday ? "date" : undefined}
                  dateTime={formatLocalDateKey(day)}
                >
                  {day.getDate()}
                </time>
              ) : null}
            </span>
          );
        })}
      </div>
    </article>
  );
}
