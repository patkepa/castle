import { addDays, formatLocalDateKey, parseLocalDateKey } from "../../lib/calendarDate";
import type { CalendarEvent, Note, Project } from "../../types";

export interface CalendarEventFormValues {
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  endDate: string;
  recurrence: "none" | "weekly";
  repeatUntil: string;
  kind: CalendarEvent["kind"];
  projectId: string;
  peopleIds: string[];
}

export interface CalendarEventIdentity {
  id: string;
  noteId: string;
  sourceFile: string;
}

export function calendarEventFormValues(event: CalendarEvent): CalendarEventFormValues {
  return {
    title: event.title,
    description: event.description,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime ?? "",
    endDate: event.endDate ?? "",
    recurrence: event.recurrence ?? "none",
    repeatUntil: event.repeatUntil ?? "",
    kind: event.kind,
    projectId: event.project?.id ?? "",
    peopleIds: event.people.map((person) => person.noteId),
  };
}

export function emptyCalendarEventFormValues(
  date = formatLocalDateKey(new Date()),
  startTime = "09:00",
): CalendarEventFormValues {
  const { time: endTime, nextDay } = addMinutesToClock(startTime, 60);
  const parsedDate = parseLocalDateKey(date);
  return {
    title: "",
    description: "",
    date,
    startTime,
    endTime,
    endDate: nextDay && parsedDate ? formatLocalDateKey(addDays(parsedDate, 1)) : "",
    recurrence: "none",
    repeatUntil: "",
    kind: "work",
    projectId: "",
    peopleIds: [],
  };
}

export function createCalendarEventIdentity(
  values: CalendarEventFormValues,
  events: readonly Pick<CalendarEvent, "id">[],
): CalendarEventIdentity {
  const baseSlug = calendarEventSlug(values.title) || "event";
  const dateSlug = values.date.replaceAll("-", "_");
  const baseId = `event_${dateSlug}_${baseSlug}`;
  const usedIds = new Set(events.map((event) => event.id));
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}_${suffix}`;
    suffix += 1;
  }
  const filename = id.replace(/^event_/, "");
  return {
    id,
    noteId: id,
    sourceFile: `events/${values.date.slice(0, 4)}/${filename}.md`,
  };
}

export function buildCalendarEventMarkdown({
  id,
  values,
  projects,
  people,
  originalMarkdown = "",
}: {
  id: string;
  values: CalendarEventFormValues;
  projects: readonly Project[];
  people: readonly Note[];
  originalMarkdown?: string;
}) {
  const title = oneLine(values.title).trim();
  const description = values.description.trim();
  const project = values.projectId
    ? projects.find((candidate) => candidate.id === values.projectId)
    : null;
  if (values.projectId && !project) {
    throw new Error("Castle could not resolve that event project.");
  }
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const selectedPeople = values.peopleIds.map((noteId) => {
    const person = peopleById.get(noteId);
    if (!person) throw new Error("Castle could not resolve one of those people.");
    return person;
  });

  const rows = [
    "type: calendar_event",
    "schema_version: 1",
    `id: ${id}`,
    `title: ${yamlString(title)}`,
    `date: ${yamlString(values.date)}`,
    `start: ${yamlString(values.startTime)}`,
  ];
  if (values.endTime) rows.push(`end: ${yamlString(values.endTime)}`);
  if (values.endDate) rows.push(`end_date: ${yamlString(values.endDate)}`);
  if (values.recurrence === "weekly") rows.push("recurrence: weekly");
  if (values.repeatUntil) rows.push(`repeat_until: ${yamlString(values.repeatUntil)}`);
  rows.push(`kind: ${values.kind}`);

  const timezoneBlock = preservedFrontmatterBlock(originalMarkdown, "timezone");
  if (timezoneBlock) rows.push(timezoneBlock);
  if (project) rows.push(`project: ${yamlString(wikiLink(project.route, project.title))}`);
  if (selectedPeople.length > 0) {
    rows.push(`people: ${JSON.stringify(
      selectedPeople.map((person) => wikiLink(person.route, person.title)),
    )}`);
  }
  const tagsBlock = preservedFrontmatterBlock(originalMarkdown, "tags");
  if (tagsBlock) rows.push(tagsBlock);

  const body = description ? `\n\n${description}` : "";
  return `---\n${rows.join("\n")}\n---\n\n# ${title}${body}\n`;
}

export function destinationSourceFileForEvent(
  sourceFile: string,
  values: CalendarEventFormValues,
) {
  const year = values.date.slice(0, 4);
  const dateSlug = values.date.replaceAll("-", "_");
  const currentFilename = sourceFile.split("/").at(-1) ?? "";
  const retainedSlug = currentFilename
    .replace(/\.mdx?$/i, "")
    .replace(/^\d{4}_\d{2}_\d{2}_/, "");
  const slug = retainedSlug || calendarEventSlug(values.title) || "event";
  return `events/${year}/${dateSlug}_${slug}.md`;
}

export function validateCalendarEventForm(values: CalendarEventFormValues) {
  if (!values.title.trim()) return "Add a title for this event.";
  if (!parseLocalDateKey(values.date)) return "Choose a valid event date.";
  if (!isTime(values.startTime)) return "Choose a valid start time.";
  if (values.endTime && !isTime(values.endTime)) return "Choose a valid end time.";
  if (values.endDate && !parseLocalDateKey(values.endDate)) {
    return "Choose a valid end date.";
  }
  if (values.endDate && !values.endTime) return "An end date also needs an end time.";
  if (values.recurrence === "none" && values.repeatUntil) {
    return "Choose weekly recurrence before setting an end date for repeats.";
  }
  if (values.repeatUntil && !parseLocalDateKey(values.repeatUntil)) {
    return "Choose a valid repeat-until date.";
  }
  if (values.repeatUntil && values.repeatUntil < values.date) {
    return "The repeat-until date cannot be before the event date.";
  }
  if (values.endDate && values.endDate < values.date) {
    return "The end date cannot be before the event date.";
  }
  if (
    values.endTime &&
    (!values.endDate || values.endDate === values.date) &&
    values.endTime === values.startTime
  ) {
    return "The end time must differ from the start time.";
  }
  if (
    values.endTime &&
    values.endDate === values.date &&
    values.endTime < values.startTime
  ) {
    return "The end time must be later when the event ends on the same day.";
  }
  return "";
}

export function addMinutesToClock(time: string, minutes: number) {
  const [hours, clockMinutes] = time.split(":").map(Number);
  const total = hours * 60 + clockMinutes + minutes;
  const normalized = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    time: `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
      normalized % 60,
    ).padStart(2, "0")}`,
    nextDay: total >= 24 * 60,
  };
}

function calendarEventSlug(value: string) {
  return oneLine(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function preservedFrontmatterBlock(markdown: string, key: string) {
  const match = /^---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/.exec(markdown);
  if (!match) return "";
  const lines = match[1].split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line));
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(lines[end])) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

function wikiLink(route: string, title: string) {
  const target = route.trimStart().replace(/^\/note\//, "").replace(/\/$/, "");
  return `[[${target}|${title}]]`;
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function oneLine(value: string) {
  return value.replace(/[\r\n]+/g, " ");
}

function isTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
