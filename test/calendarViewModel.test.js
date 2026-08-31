import assert from "node:assert/strict";
import test from "node:test";
import {
  formatEventTime,
  getCalendarGridPlacement,
  getEventsForDate,
  getMonthGridDays,
  getScheduledTasksForDate,
  getScheduledTaskMinuteRange,
  getTimetablePlacement,
} from "../apps/desktop/src/features/calendar/calendarViewModel.ts";
import { formatLocalDateKey } from "../apps/desktop/src/lib/calendarDate.ts";

test("builds complete Monday-based month grids", () => {
  const days = getMonthGridDays(new Date(2026, 7, 1));
  assert.equal(formatLocalDateKey(days[0]), "2026-07-27");
  assert.equal(formatLocalDateKey(days.at(-1)), "2026-09-06");
  assert.equal(days.length % 7, 0);
});

test("places timetable events into hour rows", () => {
  assert.deepEqual(
    getTimetablePlacement({ startTime: "12:30", endTime: "14:00" }),
    { row: 13, span: 2 },
  );
});

test("places overnight events across both calendar days", () => {
  const event = {
    date: "2026-07-31",
    startTime: "18:00",
    endTime: "05:00",
    endDate: "2026-08-01",
  };
  const startDate = new Date(2026, 6, 31);
  const endDate = new Date(2026, 7, 1);

  assert.deepEqual(getEventsForDate([event], startDate), [event]);
  assert.deepEqual(getEventsForDate([event], endDate), [event]);
  assert.deepEqual(getTimetablePlacement(event, startDate), { row: 19, span: 6 });
  assert.deepEqual(getTimetablePlacement(event, endDate), { row: 1, span: 5 });
  assert.equal(formatEventTime(event), "18:00–05:00 next day");
  assert.equal(
    formatEventTime(event, startDate),
    "18:00–midnight · continues",
  );
  assert.equal(
    formatEventTime(event, endDate),
    "continued · 00:00–05:00",
  );
});

test("renders every segment of events spanning multiple days", () => {
  const event = {
    date: "2026-08-01",
    startTime: "09:00",
    endTime: "17:00",
    endDate: "2026-08-03",
  };
  const startDate = new Date(2026, 7, 1);
  const middleDate = new Date(2026, 7, 2);
  const endDate = new Date(2026, 7, 3);

  assert.deepEqual(getEventsForDate([event], startDate), [event]);
  assert.deepEqual(getEventsForDate([event], middleDate), [event]);
  assert.deepEqual(getEventsForDate([event], endDate), [event]);
  assert.deepEqual(getTimetablePlacement(event, startDate), { row: 10, span: 15 });
  assert.deepEqual(getTimetablePlacement(event, middleDate), { row: 1, span: 24 });
  assert.deepEqual(getTimetablePlacement(event, endDate), { row: 1, span: 17 });
  assert.equal(formatEventTime(event, middleDate), "continues all day");
  assert.equal(formatEventTime(event), "09:00–17:00 · ends 2026-08-03");
});

test("expands weekly events in calendar views through their final occurrence", () => {
  const event = {
    id: "event_weekly_planning",
    date: "2026-08-03",
    startTime: "09:00",
    endTime: "10:00",
    recurrence: "weekly",
    repeatUntil: "2026-08-17",
  };

  const first = getEventsForDate([event], new Date(2026, 7, 3));
  const final = getEventsForDate([event], new Date(2026, 7, 17));
  assert.equal(first[0].date, "2026-08-03");
  assert.equal(final[0].date, "2026-08-17");
  assert.deepEqual(getEventsForDate([event], new Date(2026, 7, 24)), []);
});

test("expands every day of a recurring overnight event", () => {
  const event = {
    id: "event_weekly_night_shift",
    date: "2026-08-03",
    startTime: "22:00",
    endTime: "02:00",
    endDate: "2026-08-04",
    recurrence: "weekly",
  };
  const followingDay = getEventsForDate([event], new Date(2026, 7, 11));

  assert.equal(followingDay[0].date, "2026-08-10");
  assert.equal(followingDay[0].endDate, "2026-08-11");
  assert.equal(formatEventTime(followingDay[0], new Date(2026, 7, 11)), "continued · 00:00–02:00");
});

test("places only timed and estimated tasks on the calendar", () => {
  const scheduled = {
    id: "task_scheduled",
    targetDate: "2026-08-03",
    targetTime: "11:15",
    estimateMinutes: 45,
  };
  const tasks = [
    scheduled,
    { ...scheduled, id: "task_no_time", targetTime: "" },
    { ...scheduled, id: "task_no_estimate", estimateMinutes: 0 },
  ];

  assert.deepEqual(getScheduledTasksForDate(tasks, new Date(2026, 7, 3)), [scheduled]);
  assert.deepEqual(getScheduledTaskMinuteRange(scheduled), { start: 675, end: 720 });
  assert.deepEqual(getCalendarGridPlacement(675, 720), { row: 47, span: 3 });
});
