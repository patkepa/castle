import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCalendarEventMarkdown,
  createCalendarEventIdentity,
  destinationSourceFileForEvent,
  emptyCalendarEventFormValues,
  validateCalendarEventForm,
} from "../apps/desktop/src/features/calendar/calendarEventMarkdown.ts";

test("creates canonical calendar event records with resolved Castle links", () => {
  const values = {
    ...emptyCalendarEventFormValues("2026-08-03", "09:30"),
    title: "Work on Castle",
    description: "Focused work on the calendar.",
    projectId: "project_castle",
    peopleIds: ["person_alex_morgan"],
  };
  const markdown = buildCalendarEventMarkdown({
    id: "event_2026_08_03_work_on_castle",
    values,
    projects: [{
      id: "project_castle",
      title: "Castle",
      route: "/note/projects/castle/castle",
    }],
    people: [{
      id: "person_alex_morgan",
      title: "Alex Morgan",
      route: "/note/people/alex_morgan",
    }],
  });

  assert.match(markdown, /type: calendar_event/);
  assert.match(markdown, /date: "2026-08-03"/);
  assert.match(markdown, /start: "09:30"/);
  assert.match(markdown, /end: "10:30"/);
  assert.match(markdown, /project: "\[\[projects\/castle\/castle\|Castle\]\]"/);
  assert.match(markdown, /people: \["\[\[people\/alex_morgan\|Alex Morgan\]\]"\]/);
  assert.match(markdown, /# Work on Castle\n\nFocused work on the calendar\./);
});

test("preserves event metadata that is not represented by the editor", () => {
  const originalMarkdown = `---
type: calendar_event
schema_version: 1
id: event_original
date: "2026-08-03"
start: "09:00"
kind: work
timezone: Europe/Warsaw
tags:
  - planning
  - castle
---

# Original
`;
  const markdown = buildCalendarEventMarkdown({
    id: "event_original",
    values: {
      ...emptyCalendarEventFormValues("2026-08-04", "10:00"),
      title: "Updated",
    },
    projects: [],
    people: [],
    originalMarkdown,
  });

  assert.match(markdown, /timezone: Europe\/Warsaw/);
  assert.match(markdown, /tags:\n  - planning\n  - castle/);
});

test("writes and reads weekly recurrence metadata", () => {
  const values = {
    ...emptyCalendarEventFormValues("2026-08-03", "09:00"),
    title: "Weekly planning",
    recurrence: "weekly",
    repeatUntil: "2026-08-31",
  };
  const markdown = buildCalendarEventMarkdown({
    id: "event_2026_08_03_weekly_planning",
    values,
    projects: [],
    people: [],
  });

  assert.match(markdown, /recurrence: weekly/);
  assert.match(markdown, /repeat_until: "2026-08-31"/);
  assert.equal(
    validateCalendarEventForm({ ...values, recurrence: "none" }),
    "Choose weekly recurrence before setting an end date for repeats.",
  );
});

test("generates unique dated identities and moves edited events with their date", () => {
  const values = {
    ...emptyCalendarEventFormValues("2026-08-03", "09:00"),
    title: "Plan launch",
  };
  const identity = createCalendarEventIdentity(values, [{
    id: "event_2026_08_03_plan_launch",
  }]);

  assert.equal(identity.id, "event_2026_08_03_plan_launch_2");
  assert.equal(identity.sourceFile, "events/2026/2026_08_03_plan_launch_2.md");
  assert.equal(
    destinationSourceFileForEvent(
      "events/2026/2026_08_03_plan_launch.md",
      { ...values, date: "2027-01-04" },
    ),
    "events/2027/2027_01_04_plan_launch.md",
  );
});

test("rejects invalid event ranges before source mutation", () => {
  assert.equal(
    validateCalendarEventForm({
      ...emptyCalendarEventFormValues("2026-08-03", "09:00"),
      title: "Invalid range",
      endTime: "09:00",
    }),
    "The end time must differ from the start time.",
  );
});
