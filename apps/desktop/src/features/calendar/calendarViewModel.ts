import type { CalendarEvent, Task } from "../../types";
import {
  addDays,
  formatLocalDateKey,
  parseTimeToMinutes,
  startOfWeek,
} from "../../lib/calendarDate";

export const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const weekTimeLabels = ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"];
export const timetableStartHour = 0;
export const timetableEndHour = 24;
export const timetableRowHeight = 56;
export const timetableTimeLabels = Array.from(
  { length: timetableEndHour - timetableStartHour },
  (_, index) => `${String(timetableStartHour + index).padStart(2, "0")}:00`,
);
export const calendarGridStepMinutes = 15;
export const calendarGridRowHeight = 16;
export const calendarGridRowCount = (24 * 60) / calendarGridStepMinutes;

const polishMonthLabels = [
  "Styczeń",
  "Luty",
  "Marzec",
  "Kwiecień",
  "Maj",
  "Czerwiec",
  "Lipiec",
  "Sierpień",
  "Wrzesień",
  "Październik",
  "Listopad",
  "Grudzień",
];
const monthFormatter = new Intl.DateTimeFormat("en-GB", { month: "long" });

export const fullDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
export const currentTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function getMonthGridDays(date: Date, fixedWeekCount?: number) {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const lastOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const firstDay = startOfWeek(firstOfMonth);
  const lastDay = fixedWeekCount
    ? addDays(firstDay, fixedWeekCount * 7 - 1)
    : addDays(startOfWeek(lastOfMonth), 6);
  const days: Date[] = [];
  for (
    let currentDay = firstDay;
    currentDay <= lastDay;
    currentDay = addDays(currentDay, 1)
  ) {
    days.push(currentDay);
  }
  return days;
}

export function getEventsForDate(events: readonly CalendarEvent[], date: Date) {
  const dateKey = formatLocalDateKey(date);
  return events.flatMap((event) => eventOccurrenceForDate(event, dateKey) ?? []);
}

export function getScheduledTasksForDate(tasks: readonly Task[], date: Date) {
  const dateKey = formatLocalDateKey(date);
  return tasks.filter(
    (task) =>
      task.targetDate === dateKey &&
      Boolean(task.targetTime) &&
      task.estimateMinutes > 0,
  );
}

export function getCalendarEventMinuteRange(event: CalendarEvent, date: Date) {
  const dateKey = formatLocalDateKey(date);
  const isStartDate = event.date === dateKey;
  const isEndDate = Boolean(event.endDate && event.endDate === dateKey);
  const start = isStartDate ? parseTimeToMinutes(event.startTime) : 0;
  let end: number;
  if (isEndDate) {
    end = parseTimeToMinutes(event.endTime ?? "00:00");
  } else if (event.endDate) {
    end = 24 * 60;
  } else if (event.endTime) {
    end = parseTimeToMinutes(event.endTime);
    if (end <= start) end = 24 * 60;
  } else {
    end = Math.min(24 * 60, start + 60);
  }
  return { start, end: Math.max(start + calendarGridStepMinutes, end) };
}

export function getScheduledTaskMinuteRange(task: Task) {
  const start = parseTimeToMinutes(task.targetTime);
  return {
    start,
    end: Math.min(24 * 60, start + task.estimateMinutes),
  };
}

export function getCalendarGridPlacement(start: number, end: number) {
  const row = Math.floor(start / calendarGridStepMinutes) + 2;
  const span = Math.max(
    2,
    Math.ceil((Math.max(start + calendarGridStepMinutes, end) - start) /
      calendarGridStepMinutes),
  );
  return { row, span };
}

export function formatMinuteValue(totalMinutes: number) {
  const normalized = Math.max(0, Math.min(24 * 60, totalMinutes));
  if (normalized === 24 * 60) return "24:00";
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60,
  ).padStart(2, "0")}`;
}

export function formatTaskEstimate(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function getTimetablePlacement(event: CalendarEvent, date?: Date) {
  const dateKey = date ? formatLocalDateKey(date) : event.date;
  const isStartDate = !date || event.date === dateKey;
  const isEndDate = Boolean(event.endDate && event.endDate === dateKey);
  const startMinutes = isStartDate
    ? parseTimeToMinutes(event.startTime)
    : timetableStartHour * 60;
  const timetableStartMinutes = timetableStartHour * 60;
  const row = Math.max(
    1,
    Math.floor((startMinutes - timetableStartMinutes) / 60) + 1,
  );
  const endMinutes = isEndDate
    ? parseTimeToMinutes(event.endTime ?? "00:00")
    : event.endDate
      ? timetableEndHour * 60
      : event.endTime
        ? parseTimeToMinutes(event.endTime)
        : startMinutes + 60;
  return { row, span: Math.max(1, Math.ceil((endMinutes - startMinutes) / 60)) };
}

export function formatTimeValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

export function formatEventTime(event: CalendarEvent, date?: Date) {
  if (!event.endTime) return event.startTime;
  if (!event.endDate) return `${event.startTime}–${event.endTime}`;
  if (!date) {
    return event.endDate === nextCalendarDateKey(event.date)
      ? `${event.startTime}–${event.endTime} next day`
      : `${event.startTime}–${event.endTime} · ends ${event.endDate}`;
  }

  const dateKey = formatLocalDateKey(date);
  if (dateKey === event.date) return `${event.startTime}–midnight · continues`;
  if (dateKey === event.endDate) return `continued · 00:00–${event.endTime}`;
  return "continues all day";
}

function nextCalendarDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return formatLocalDateKey(new Date(year, month - 1, day + 1));
}

function eventOccurrenceForDate(event: CalendarEvent, dateKey: string) {
  if (!event.recurrence) {
    return event.date === dateKey || Boolean(event.endDate && event.date < dateKey && dateKey <= event.endDate)
      ? event
      : null;
  }

  const durationDays = event.endDate ? calendarDateDifference(event.date, event.endDate) : 0;
  for (let offset = 0; offset <= durationDays; offset += 1) {
    const occurrenceDate = dateKeyAfterDays(dateKey, -offset);
    if (
      occurrenceDate < event.date ||
      (event.repeatUntil && occurrenceDate > event.repeatUntil) ||
      calendarDateDifference(event.date, occurrenceDate) % 7 !== 0
    ) {
      continue;
    }
    return {
      ...event,
      date: occurrenceDate,
      endDate: event.endDate ? dateKeyAfterDays(occurrenceDate, durationDays) : undefined,
    };
  }
  return null;
}

function calendarDateDifference(start: string, end: string) {
  const startDate = parseDateKey(start);
  const endDate = parseDateKey(end);
  return Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
}

function dateKeyAfterDays(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return formatLocalDateKey(date);
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatEventCount(count: number) {
  return `${count} ${count === 1 ? "event" : "events"}`;
}

export function formatBilingualMonth(date: Date) {
  return `${monthFormatter.format(date)} / ${polishMonthLabels[date.getMonth()]}`;
}

export function formatBilingualMonthYear(date: Date) {
  return `${formatBilingualMonth(date)} ${date.getFullYear()}`;
}

export function formatBilingualDayMonth(date: Date, includeYear = false) {
  const year = includeYear ? ` ${date.getFullYear()}` : "";
  return `${date.getDate()} ${formatBilingualMonth(date)}${year}`;
}
