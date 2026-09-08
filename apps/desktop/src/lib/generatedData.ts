import {
  useCallback,
  useEffect,
  useState,
} from "react";
import type {
  CalendarResource,
  GeneratedResourceManifest,
  NotesResource,
  ProjectsResource,
  TasksResource,
} from "@castle/contracts";
import type {
  KnowledgeBase,
  NoteContent,
  RelationshipGraphData,
  SearchIndex,
} from "../types";
import type {
  CastleContentDelta,
  CastleEntityDelta,
} from "../platform/castle_platform";
import { parseCastleContract } from "@castle/contracts";

type Validator<T> = (value: unknown) => asserts value is T;

interface GeneratedRequestOptions {
  fetchImpl?: typeof fetch;
  fresh?: boolean;
  label?: string;
}

interface GeneratedResourceState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  resolvedPath: string | null;
}

const resourceRequests = new Map<string, Promise<unknown>>();
const maximumCachedResourceCount = 256;
const generatedContentChangedEvent = "castle:generated-content-changed";
const immutableGeneratedResourcePattern =
  /^\/generated\/(?:notes\/[a-f0-9]{64}|domains\/[a-z]+-[a-f0-9]{64})\.json$/;

export async function fetchGeneratedJson<T>(
  path: string,
  validate: Validator<T>,
  {
    fetchImpl = fetch,
    fresh = false,
    label = "Generated resource",
  }: GeneratedRequestOptions = {},
): Promise<T> {
  const useCache = fetchImpl === fetch;
  if (fresh) resourceRequests.delete(path);

  const existing = useCache ? resourceRequests.get(path) : undefined;
  if (existing) {
    resourceRequests.delete(path);
    resourceRequests.set(path, existing);
  }
  const requestPath = fetchImpl === fetch ? resolveCastlePublicPath(path) : path;
  const request = existing ?? fetchImpl(requestPath).then(async (response) => {
    if (!response.ok) throw new Error(`${label} returned ${response.status}`);
    const value: unknown = await response.json();
    validate(value);
    return value;
  });

  if (useCache && !existing) {
    resourceRequests.set(
      path,
      request.catch((reason) => {
        resourceRequests.delete(path);
        throw reason;
      }),
    );
    while (resourceRequests.size > maximumCachedResourceCount) {
      const oldestPath = resourceRequests.keys().next().value;
      if (typeof oldestPath !== "string") break;
      resourceRequests.delete(oldestPath);
    }
  }
  return request as Promise<T>;
}

export function resolveCastlePublicPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const baseUrl = import.meta.env?.BASE_URL ?? "/";
  return baseUrl === "/" ? path : `${baseUrl}${path.slice(1)}`;
}

export function invalidateGeneratedResource(path: string) {
  resourceRequests.delete(path);
}

export function announceGeneratedContentChange(paths?: readonly string[]) {
  const selectedPaths = paths ? new Set(paths) : null;
  for (const path of resourceRequests.keys()) {
    if (
      !immutableGeneratedResourcePattern.test(path) &&
      (!selectedPaths || selectedPaths.has(path))
    ) {
      resourceRequests.delete(path);
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(generatedContentChangedEvent, {
        detail: { paths: paths ?? null },
      }),
    );
  }
}

export function useGeneratedResource<T>(
  path: string | null,
  validate: Validator<T>,
  label: string,
) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<GeneratedResourceState<T>>({
    data: null,
    error: null,
    loading: Boolean(path),
    resolvedPath: null,
  });

  useEffect(() => {
    let active = true;
    if (!path) {
      setState({ data: null, error: null, loading: false, resolvedPath: null });
      return;
    }

    setState((current) => ({ ...current, error: null, loading: true }));
    fetchGeneratedJson(path, validate, { fresh: revision > 0, label })
      .then((data) => {
        if (active) {
          setState({ data, error: null, loading: false, resolvedPath: path });
        }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        const error = reason instanceof Error ? reason : new Error(String(reason));
        setState((current) => ({ ...current, error, loading: false }));
      });

    return () => {
      active = false;
    };
  }, [label, path, revision, validate]);

  useEffect(() => {
    if (!path || immutableGeneratedResourcePattern.test(path)) return;
    const handleGeneratedContentChange = (event: Event) => {
      const paths = event instanceof CustomEvent
        ? (event.detail as { paths?: unknown } | undefined)?.paths
        : null;
      if (Array.isArray(paths) && !paths.includes(path)) return;
      setRevision((current) => current + 1);
    };
    window.addEventListener(
      generatedContentChangedEvent,
      handleGeneratedContentChange,
    );
    return () =>
      window.removeEventListener(
        generatedContentChangedEvent,
        handleGeneratedContentChange,
      );
  }, [path]);

  const reload = useCallback(() => {
    if (path) invalidateGeneratedResource(path);
    setRevision((current) => current + 1);
  }, [path]);

  const updateData = useCallback((update: (current: T) => T) => {
    setState((current) => {
      if (!current.data) return current;
      const data = update(current.data);
      if (path) resourceRequests.set(path, Promise.resolve(data));
      return { ...current, data, loading: false };
    });
  }, [path]);

  return { ...state, reload, updateData };
}

export function validateKnowledgeBase(value: unknown): asserts value is KnowledgeBase {
  const catalog = requireRecord(value, "Knowledge-base catalog");
  requireNumber(catalog.contractVersion, "Knowledge-base catalog contractVersion");
  requireString(catalog.generatedAt, "Knowledge-base catalog generatedAt");
  requireArray(catalog.sections, "Knowledge-base catalog sections").forEach(
    validateSection,
  );
  requireArray(catalog.notes, "Knowledge-base catalog notes").forEach(
    validateNote,
  );
  requireArray(
    catalog.calendarEvents,
    "Knowledge-base catalog calendarEvents",
  ).forEach(validateCalendarEvent);
  requireArray(catalog.tasks, "Knowledge-base catalog tasks").forEach(
    validateTask,
  );
  requireArray(catalog.projects, "Knowledge-base catalog projects").forEach(
    validateProject,
  );
  requireArray(
    catalog.shortcutCollections,
    "Knowledge-base catalog shortcutCollections",
  ).forEach(validateShortcutCollection);
  parseCastleContract("KnowledgeBase", value);
}

export function validateGeneratedResourceManifest(
  value: unknown,
): asserts value is GeneratedResourceManifest {
  parseCastleContract("GeneratedResourceManifest", value);
}

export function validateNotesResource(value: unknown): asserts value is NotesResource {
  parseCastleContract("NotesResource", value);
}

export function validateTasksResource(value: unknown): asserts value is TasksResource {
  parseCastleContract("TasksResource", value);
}

export function validateProjectsResource(
  value: unknown,
): asserts value is ProjectsResource {
  parseCastleContract("ProjectsResource", value);
}

export function validateCalendarResource(
  value: unknown,
): asserts value is CalendarResource {
  parseCastleContract("CalendarResource", value);
}

export function applyKnowledgeBaseDelta(
  current: KnowledgeBase,
  delta: CastleContentDelta,
): KnowledgeBase {
  const candidate: unknown = {
    contractVersion: delta.contractVersion,
    generatedAt: delta.generatedAt,
    sections: delta.sections,
    folders: delta.folders,
    notes: applyEntityDelta(current.notes, delta.notes),
    calendarEvents: applyEntityDelta(current.calendarEvents, delta.calendarEvents),
    tasks: applyEntityDelta(current.tasks, delta.tasks),
    projects: applyEntityDelta(current.projects, delta.projects),
    shortcutCollections: delta.shortcutCollections,
  };
  validateKnowledgeBase(candidate);
  return candidate;
}

function applyEntityDelta<T extends { id: string }>(
  current: T[],
  delta: CastleEntityDelta,
) {
  const removed = new Set(delta.removedIds);
  const byId = new Map(
    current
      .filter((value) => !removed.has(value.id))
      .map((value) => [value.id, value] as const),
  );
  for (const value of delta.upserted) {
    const id = entityId(value);
    if (!id) throw new Error("Castle received an entity delta without an ID.");
    byId.set(id, value as T);
  }
  if (delta.orderedIds) {
    return delta.orderedIds.map((id) => {
      const value = byId.get(id);
      if (!value) throw new Error(`Castle content delta is missing entity “${id}”.`);
      return value;
    });
  }
  const retainedIds = new Set(current.map((value) => value.id));
  return [
    ...current.flatMap((value) => {
      if (removed.has(value.id)) return [];
      const replacement = byId.get(value.id);
      return replacement ? [replacement] : [];
    }),
    ...delta.upserted.flatMap((value) => {
      const id = entityId(value);
      return id && !retainedIds.has(id) ? [value as T] : [];
    }),
  ];
}

function entityId(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? typeof (value as Record<string, unknown>).id === "string"
      ? (value as Record<string, string>).id
      : null
    : null;
}

export function validateSearchIndex(value: unknown): asserts value is SearchIndex {
  const index = requireRecord(value, "Search index");
  requireString(index.generatedAt, "Search index generatedAt");
  const entries = requireArray(index.entries, "Search index entries");
  for (const entryValue of entries) {
    const entry = requireRecord(entryValue, "Search index entry");
    requireString(entry.id, "Search index entry id");
    requireString(entry.text, "Search index entry text");
  }
}

export function validateNoteContent(value: unknown): asserts value is NoteContent {
  const note = requireRecord(value, "Note content");
  requireString(note.id, "Note content id");
  requireString(note.content, "Note content body");
  requireArray(note.headings, "Note content headings").forEach((value, index) => {
    const heading = requireRecord(value, `Note content heading ${index}`);
    requireNumber(heading.depth, `Note content heading ${index} depth`);
    requireString(heading.label, `Note content heading ${index} label`);
    requireString(heading.id, `Note content heading ${index} id`);
    requireNumber(heading.line, `Note content heading ${index} line`);
  });
  requireStringArray(note.outgoingNoteIds, "Note content outgoingNoteIds");
  requireStringArray(note.backlinkNoteIds, "Note content backlinkNoteIds");
  requireArray(note.backlinks, "Note content backlinks").forEach(
    (value, index) => {
      const backlink = requireRecord(value, `Note content backlink ${index}`);
      requireString(
        backlink.sourceNoteId,
        `Note content backlink ${index} sourceNoteId`,
      );
      requireArray(
        backlink.occurrences,
        `Note content backlink ${index} occurrences`,
      ).forEach((value, occurrenceIndex) => {
        const occurrence = requireRecord(
          value,
          `Note content backlink ${index} occurrence ${occurrenceIndex}`,
        );
        requireString(
          occurrence.anchorId,
          `Note content backlink ${index} occurrence ${occurrenceIndex} anchorId`,
        );
        requireString(
          occurrence.context,
          `Note content backlink ${index} occurrence ${occurrenceIndex} context`,
        );
      });
    },
  );
  requireStringArray(note.relatedNoteIds, "Note content relatedNoteIds");
}

export function validateRelationshipGraph(
  value: unknown,
): asserts value is RelationshipGraphData {
  const graph = requireRecord(value, "Relationship graph");
  validateGraphView(graph, "Relationship graph");
  requireNumber(graph.peopleCount, "Relationship graph peopleCount");
  requireNumber(
    graph.personRelationCount,
    "Relationship graph personRelationCount",
  );
  requireArray(graph.relations, "Relationship graph relations").forEach(
    (relation, index) => validateGraphCount(relation, `Graph relation ${index}`),
  );
  requireArray(graph.alignments, "Relationship graph alignments").forEach(
    (alignment, index) => validateGraphCount(alignment, `Graph alignment ${index}`),
  );
  const views = requireRecord(graph.views, "Relationship graph views");
  validateGraphView(views.known_from, "Relationship graph known_from view");
  validateGraphView(views.relation, "Relationship graph relation view");
}

function validateSection(value: unknown, index: number) {
  const section = requireRecord(value, `Catalog section ${index}`);
  requireString(section.id, `Catalog section ${index} id`);
  requireString(section.label, `Catalog section ${index} label`);
  requireString(section.icon, `Catalog section ${index} icon`);
  requireNumber(section.count, `Catalog section ${index} count`);
}

function validateNote(value: unknown, index: number) {
  const note = requireRecord(value, `Catalog note ${index}`);
  for (const field of [
    "id",
    "section",
    "sectionLabel",
    "relativePath",
    "sourceFile",
    "route",
    "title",
    "excerpt",
    "status",
    "avatarUrl",
    "modifiedAt",
    "contentPath",
  ]) {
    requireString(note[field], `Catalog note ${index} ${field}`);
  }
  requireOptionalString(note.preview, `Catalog note ${index} preview`);
  requireOptionalString(note.createdAt, `Catalog note ${index} createdAt`);
  requireStringArray(note.tags, `Catalog note ${index} tags`);
  requireStringArray(note.aliases, `Catalog note ${index} aliases`);
  requireNumber(note.wordCount, `Catalog note ${index} wordCount`);
  requireNumber(note.readingMinutes, `Catalog note ${index} readingMinutes`);
  requireBoolean(note.pinned, `Catalog note ${index} pinned`);
  if (note.sidebar !== undefined) validateNoteSidebar(note.sidebar, index);
}

function validateNoteSidebar(value: unknown, noteIndex: number) {
  const sidebar = requireRecord(value, `Catalog note ${noteIndex} sidebar`);
  requireEnum(sidebar.kind, ["person"], `Catalog note ${noteIndex} sidebar kind`);
  requireString(sidebar.title, `Catalog note ${noteIndex} sidebar title`);
  requireString(sidebar.avatarUrl, `Catalog note ${noteIndex} sidebar avatarUrl`);
  requireArray(sidebar.facts, `Catalog note ${noteIndex} sidebar facts`).forEach(
    (value, index) => {
      const fact = requireRecord(value, `Sidebar fact ${index}`);
      requireString(fact.label, `Sidebar fact ${index} label`);
      requireString(fact.value, `Sidebar fact ${index} value`);
      requireOptionalString(fact.href, `Sidebar fact ${index} href`);
    },
  );
  requireArray(
    sidebar.contacts,
    `Catalog note ${noteIndex} sidebar contacts`,
  ).forEach((value, index) => {
    const contact = requireRecord(value, `Sidebar contact ${index}`);
    requireEnum(
      contact.kind,
      ["phone", "email", "address", "website", "social", "other"],
      `Sidebar contact ${index} kind`,
    );
    for (const field of ["label", "value", "detail", "href"]) {
      requireString(contact[field], `Sidebar contact ${index} ${field}`);
    }
  });
}

function validateCalendarEvent(value: unknown, index: number) {
  const event = requireRecord(value, `Calendar event ${index}`);
  for (const field of [
    "id",
    "noteId",
    "route",
    "date",
    "startTime",
    "title",
    "description",
  ]) {
    requireString(event[field], `Calendar event ${index} ${field}`);
  }
  requireOptionalString(event.endTime, `Calendar event ${index} endTime`);
  requireOptionalString(event.endDate, `Calendar event ${index} endDate`);
  requireEnum(event.kind, ["work", "social"], `Calendar event ${index} kind`);
  requireArray(event.people, `Calendar event ${index} people`).forEach(
    (person, personIndex) =>
      validatePersonReference(person, `Calendar event ${index} person ${personIndex}`),
  );
  validateNullableProjectReference(event.project, `Calendar event ${index} project`);
}

function validateTask(value: unknown, index: number) {
  const task = requireRecord(value, `Task ${index}`);
  for (const field of [
    "id",
    "noteId",
    "route",
    "title",
    "description",
    "targetDate",
    "targetTime",
    "createdAt",
    "completedAt",
    "modifiedAt",
  ]) {
    requireString(task[field], `Task ${index} ${field}`);
  }
  requireEnum(
    task.status,
    ["todo", "in_progress", "blocked", "done"],
    `Task ${index} status`,
  );
  requireNumber(task.estimateMinutes, `Task ${index} estimateMinutes`);
  requireNumber(task.sortOrder, `Task ${index} sortOrder`);
  requireStringArray(task.tags, `Task ${index} tags`);
  requireArray(task.people, `Task ${index} people`).forEach(
    (person, personIndex) =>
      validateTaskPerson(person, `Task ${index} person ${personIndex}`),
  );
  validateNullableProjectReference(task.project, `Task ${index} project`);
  requireArray(task.subtasks, `Task ${index} subtasks`).forEach(
    (value, subtaskIndex) => {
      const subtask = requireRecord(value, `Task ${index} subtask ${subtaskIndex}`);
      requireString(subtask.id, `Task ${index} subtask ${subtaskIndex} id`);
      requireString(subtask.title, `Task ${index} subtask ${subtaskIndex} title`);
      requireBoolean(
        subtask.completed,
        `Task ${index} subtask ${subtaskIndex} completed`,
      );
    },
  );
}

function validateProject(value: unknown, index: number) {
  const project = requireRecord(value, `Project ${index}`);
  for (const field of [
    "id",
    "noteId",
    "route",
    "title",
    "description",
    "startedAt",
    "completedAt",
    "modifiedAt",
  ]) {
    requireString(project[field], `Project ${index} ${field}`);
  }
  requireEnum(
    project.status,
    ["idea", "planned", "active", "paused", "completed", "archived"],
    `Project ${index} status`,
  );
  requireStringArray(project.tags, `Project ${index} tags`);
  requireStringArray(project.taskIds, `Project ${index} taskIds`);
  requireStringArray(project.eventIds, `Project ${index} eventIds`);
  requireArray(project.people, `Project ${index} people`).forEach(
    (person, personIndex) =>
      validateTaskPerson(person, `Project ${index} person ${personIndex}`),
  );
}

function validateShortcutCollection(value: unknown, index: number) {
  const collection = requireRecord(value, `Shortcut collection ${index}`);
  requireString(collection.id, `Shortcut collection ${index} id`);
  requireString(collection.label, `Shortcut collection ${index} label`);
  requireNumber(collection.sortOrder, `Shortcut collection ${index} sortOrder`);
  requireArray(
    collection.shortcuts,
    `Shortcut collection ${index} shortcuts`,
  ).forEach((value, shortcutIndex) => {
    const shortcut = requireRecord(
      value,
      `Shortcut collection ${index} shortcut ${shortcutIndex}`,
    );
    for (const field of ["category", "label", "description", "href"]) {
      requireString(
        shortcut[field],
        `Shortcut collection ${index} shortcut ${shortcutIndex} ${field}`,
      );
    }
  });
}

function validatePersonReference(value: unknown, label: string) {
  const person = requireRecord(value, label);
  requireString(person.noteId, `${label} noteId`);
  requireString(person.name, `${label} name`);
  requireString(person.route, `${label} route`);
}

function validateTaskPerson(value: unknown, label: string) {
  const person = requireRecord(value, label);
  validatePersonReference(person, label);
  requireString(person.avatarUrl, `${label} avatarUrl`);
}

function validateNullableProjectReference(value: unknown, label: string) {
  if (value === null) return;
  const project = requireRecord(value, label);
  requireString(project.id, `${label} id`);
  requireString(project.title, `${label} title`);
  requireString(project.route, `${label} route`);
}

function validateGraphView(value: unknown, label: string) {
  const graph = requireRecord(value, label);
  for (const field of ["width", "height", "centerX", "centerY", "noteLinkCount"]) {
    requireNumber(graph[field], `${label} ${field}`);
  }
  requireEnum(graph.mode, ["relation", "known_from"], `${label} mode`);
  requireArray(graph.categories, `${label} categories`).forEach(
    (category, index) => validateGraphCount(category, `${label} category ${index}`, true),
  );
  requireArray(graph.nodes, `${label} nodes`).forEach((value, index) => {
    const node = requireRecord(value, `${label} node ${index}`);
    for (const field of [
      "id",
      "label",
      "categoryId",
      "categoryLabel",
      "relation",
      "relationLabel",
      "relationColor",
      "alignmentLabel",
      "knownFromLabel",
      "status",
      "href",
      "color",
    ]) {
      requireString(node[field], `${label} node ${index} ${field}`);
    }
    requireEnum(
      node.type,
      ["root", "category", "company", "department", "person"],
      `${label} node ${index} type`,
    );
    requireStringArray(node.categoryIds, `${label} node ${index} categoryIds`);
    requireStringArray(node.alignments, `${label} node ${index} alignments`);
    requireStringArray(node.knownFrom, `${label} node ${index} knownFrom`);
    requireStringArray(node.tags, `${label} node ${index} tags`);
    requireOptionalString(node.avatarUrl, `${label} node ${index} avatarUrl`);
    for (const field of ["radius", "x", "y", "labelX", "labelY"]) {
      requireNumber(node[field], `${label} node ${index} ${field}`);
    }
    requireEnum(
      node.textAnchor,
      ["start", "middle", "end"],
      `${label} node ${index} textAnchor`,
    );
  });
  requireArray(graph.edges, `${label} edges`).forEach((value, index) => {
    const edge = requireRecord(value, `${label} edge ${index}`);
    for (const field of ["id", "source", "target", "path"]) {
      requireString(edge[field], `${label} edge ${index} ${field}`);
    }
    requireEnum(
      edge.type,
      ["category", "company", "department", "person", "person-relation", "note-link"],
      `${label} edge ${index} type`,
    );
  });
}

function validateGraphCount(value: unknown, label: string, includePath = false) {
  const item = requireRecord(value, label);
  requireString(item.id, `${label} id`);
  requireString(item.label, `${label} label`);
  requireString(item.color, `${label} color`);
  requireNumber(item.count, `${label} count`);
  if (includePath) requireString(item.path, `${label} path`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} has an invalid shape`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
}

function requireOptionalString(value: unknown, label: string) {
  if (value !== undefined) requireString(value, label);
}

function requireStringArray(value: unknown, label: string) {
  requireArray(value, label).forEach((item, index) =>
    requireString(item, `${label} item ${index}`),
  );
}

function requireNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function requireBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
}

function requireEnum(value: unknown, options: readonly string[], label: string) {
  if (typeof value !== "string" || !options.includes(value)) {
    throw new Error(`${label} must be one of ${options.join(", ")}`);
  }
}
