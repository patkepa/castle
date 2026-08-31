import { useMemo } from "react";
import type {
  CalendarResource,
  GeneratedResourceManifest,
  NotesResource,
  ProjectsResource,
  TasksResource,
} from "@castle/contracts";
import {
  useGeneratedResource,
  validateCalendarResource,
  validateGeneratedResourceManifest,
  validateKnowledgeBase,
  validateNotesResource,
  validateProjectsResource,
  validateTasksResource,
} from "../lib/generatedData";
import type { KnowledgeBase } from "../types";
import { isBuiltInDocumentRoute } from "../lib/builtInDocumentManifest";

const manifestPath = "/generated/manifest.json";

export function useRouteKnowledgeSnapshot(
  pathname: string,
  notesExplicitlyRequested: boolean,
) {
  const required = useMemo(
    () => requiredDomains(pathname, notesExplicitlyRequested),
    [notesExplicitlyRequested, pathname],
  );
  const manifestRequest = useGeneratedResource(
    manifestPath,
    validateGeneratedResourceManifest,
    "Generated resource manifest",
  );
  const manifest = manifestRequest.data;
  const bootstrapPath = resourcePath(manifest, "bootstrap");
  const notesPath = required.has("notes") ? resourcePath(manifest, "notes") : null;
  const tasksPath = required.has("tasks") ? resourcePath(manifest, "tasks") : null;
  const projectsPath = required.has("projects")
    ? resourcePath(manifest, "projects")
    : null;
  const calendarPath = required.has("calendar")
    ? resourcePath(manifest, "calendar")
    : null;
  const bootstrapRequest = useGeneratedResource(
    bootstrapPath,
    validateKnowledgeBase,
    "Castle bootstrap",
  );
  const notesRequest = useGeneratedResource(
    notesPath,
    validateNotesResource,
    "Notes catalog",
  );
  const tasksRequest = useGeneratedResource(
    tasksPath,
    validateTasksResource,
    "Tasks resource",
  );
  const projectsRequest = useGeneratedResource(
    projectsPath,
    validateProjectsResource,
    "Projects resource",
  );
  const calendarRequest = useGeneratedResource(
    calendarPath,
    validateCalendarResource,
    "Calendar resource",
  );

  const bootstrap = currentData(bootstrapRequest, bootstrapPath);
  const notes = currentData(notesRequest, notesPath);
  const tasks = currentData(tasksRequest, tasksPath);
  const projects = currentData(projectsRequest, projectsPath);
  const calendar = currentData(calendarRequest, calendarPath);
  const generationError = generationMismatch(manifest, [
    bootstrap,
    notes,
    tasks,
    projects,
    calendar,
  ]);
  const snapshot = bootstrap && !generationError
    ? mergeResources(bootstrap, { notes, tasks, projects, calendar })
    : null;
  const missingDescriptor = manifest
    ? [...required, "bootstrap"].find((name) => !manifest.resources[name])
    : undefined;
  const error = manifestRequest.error ??
    currentError(bootstrapRequest, bootstrapPath) ??
    currentError(notesRequest, notesPath) ??
    currentError(tasksRequest, tasksPath) ??
    currentError(projectsRequest, projectsPath) ??
    currentError(calendarRequest, calendarPath) ??
    (missingDescriptor
      ? new Error(`Castle manifest is missing its ${missingDescriptor} resource.`)
      : generationError);
  const loading = !error && (
    !manifest ||
    !bootstrap ||
    (required.has("notes") && !notes) ||
    (required.has("tasks") && !tasks) ||
    (required.has("projects") && !projects) ||
    (required.has("calendar") && !calendar)
  );

  return {
    error,
    loading,
    notesComplete: Boolean(notes),
    reload() {
      manifestRequest.reload();
      bootstrapRequest.reload();
      notesRequest.reload();
      tasksRequest.reload();
      projectsRequest.reload();
      calendarRequest.reload();
    },
    snapshot,
  };
}

type DomainName = "notes" | "tasks" | "projects" | "calendar";
type DomainResource =
  | KnowledgeBase
  | NotesResource
  | TasksResource
  | ProjectsResource
  | CalendarResource;

export function requiredDomains(pathname: string, notesRequested: boolean) {
  const domains = new Set<DomainName>();
  if (
    notesRequested ||
    pathname === "/library" ||
    pathname === "/canvas" ||
    (pathname.startsWith("/browse/") && !pathname.startsWith("/browse/sheets")) ||
    (pathname.startsWith("/note/") && !isBuiltInDocumentRoute(pathname))
  ) {
    domains.add("notes");
  }
  if (pathname === "/relationship-graph") {
    domains.add("notes");
    domains.add("calendar");
  }
  if (pathname === "/tasks") {
    domains.add("notes");
    domains.add("tasks");
    domains.add("projects");
  }
  if (pathname === "/projects") {
    domains.add("notes");
    domains.add("tasks");
    domains.add("projects");
    domains.add("calendar");
  }
  if (pathname === "/calendar") {
    domains.add("notes");
    domains.add("tasks");
    domains.add("projects");
    domains.add("calendar");
  }
  return domains;
}

function resourcePath(
  manifest: GeneratedResourceManifest | null,
  name: string,
) {
  return manifest?.resources[name]?.path ?? null;
}

function currentData<T>(
  request: { data: T | null; resolvedPath: string | null },
  requestedPath: string | null,
) {
  return requestedPath && request.resolvedPath === requestedPath
    ? request.data
    : null;
}

function currentError(
  request: { error: Error | null },
  requestedPath: string | null,
) {
  return requestedPath ? request.error : null;
}

function generationMismatch(
  manifest: GeneratedResourceManifest | null,
  resources: Array<DomainResource | null>,
) {
  if (!manifest) return null;
  const mismatch = resources.find(
    (resource) => resource && resource.generatedAt !== manifest.generatedAt,
  );
  return mismatch
    ? new Error("Castle loaded resources from different snapshot generations.")
    : null;
}

function mergeResources(
  bootstrap: KnowledgeBase,
  resources: {
    notes: NotesResource | null;
    tasks: TasksResource | null;
    projects: ProjectsResource | null;
    calendar: CalendarResource | null;
  },
): KnowledgeBase {
  return {
    ...bootstrap,
    notes: resources.notes?.notes ?? bootstrap.notes,
    tasks: resources.tasks?.tasks ?? bootstrap.tasks,
    projects: resources.projects?.projects ?? bootstrap.projects,
    calendarEvents:
      resources.calendar?.calendarEvents ?? bootstrap.calendarEvents,
  };
}
