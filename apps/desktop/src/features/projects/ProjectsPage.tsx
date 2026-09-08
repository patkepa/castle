import { Icon } from "@patkepa/kantzen-ui/primitives";
import { InspectorWorkspace, SelectableList } from "@patkepa/kantzen-ui";
import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createProjectContextMenu } from "../context_menu/context_menu_models";
import { ContextMenuTarget } from "../context_menu/CastleContextMenu";
import {
  useGeneratedResource,
  validateNoteContent,
} from "../../lib/generatedData";
import type {
  CalendarEvent,
  Note,
  Project,
  ProjectStatus,
  Task,
} from "../../types";
import { NoteMarkdown } from "../../components/NoteMarkdown";

type ProjectFilter = "all" | ProjectStatus;

const projectStatuses: ProjectStatus[] = [
  "active",
  "planned",
  "idea",
  "paused",
  "completed",
  "archived",
];
const statusLabels: Record<ProjectStatus, string> = {
  idea: "Idea",
  planned: "Planned",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived",
};
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function ProjectsPage({
  projects,
  tasks,
  events,
  notes,
}: {
  projects: Project[];
  tasks: Task[];
  events: CalendarEvent[];
  notes: Note[];
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [selectedId, setSelectedId] = useState(
    () => projects.find((project) => project.status === "active")?.id ?? projects[0]?.id ?? "",
  );
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const visibleProjects = useMemo(
    () =>
      projects.filter((project) => {
        if (filter !== "all" && project.status !== filter) return false;
        if (!deferredQuery) return true;
        return projectSearchText(project).includes(deferredQuery);
      }),
    [deferredQuery, filter, projects],
  );
  const selectedProject =
    visibleProjects.find((project) => project.id === selectedId) ??
    visibleProjects[0] ??
    null;
  const notesById = useMemo(
    () => new Map(notes.map((note) => [note.id, note])),
    [notes],
  );
  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const eventsById = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events],
  );

  return (
    <main className="projects-page">
      <header className="projects-header">
        <div>
          <span>File-based workspace</span>
          <h1>Projects</h1>
          <p>Outcomes, people, tasks, and events connected through Markdown.</p>
        </div>
        <Link className="projects-source-link" to="/browse/projects">
          <Icon icon="folder-open" aria-hidden="true" />
          <span>
            <small>Markdown source</small>
            library/projects/
          </span>
          <Icon icon="arrow-right" aria-hidden="true" />
        </Link>
      </header>

      <InspectorWorkspace
        className="projects-workspace"
        ariaLabel="Projects workspace"
      >
        <aside className="projects-browser" aria-label="Project browser">
          <div className="projects-browser-toolbar">
            <label className="projects-search">
              <Icon icon="search" aria-hidden="true" />
              <span className="sr-only">Search projects</span>
              <input
                type="search"
                value={query}
                placeholder="Search projects"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="projects-status-filter">
              <span className="sr-only">Filter projects by status</span>
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as ProjectFilter)}
              >
                <option value="all">All statuses</option>
                {projectStatuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
              <Icon icon="chevron-down" size={12} aria-hidden="true" />
            </label>
          </div>

          <div className="projects-result-count" aria-live="polite">
            {visibleProjects.length}{" "}
            {visibleProjects.length === 1 ? "project" : "projects"}
          </div>

          <SelectableList
            items={visibleProjects}
            selectedId={selectedProject?.id ?? null}
            ariaLabel="All projects"
            className="projects-list"
            rowClassName="projects-list-row"
            empty={<ProjectEmptyState filtered={projects.length > 0} />}
            onSelect={(project) => setSelectedId(project.id)}
            renderItem={(project) => (
              <>
                <span
                  className={`projects-status-dot projects-status-dot--${project.status}`}
                  aria-hidden="true"
                />
                <span className="projects-list-copy">
                  <strong>{project.title}</strong>
                  <small>{project.description || "No project summary yet."}</small>
                </span>
                <span className="projects-list-activity">
                  {project.taskIds.length} tasks
                </span>
              </>
            )}
            wrapItem={(project, row) => (
              <ContextMenuTarget
                menu={createProjectContextMenu(project)}
                onOpen={() => setSelectedId(project.id)}
              >
                {row}
              </ContextMenuTarget>
            )}
          />
        </aside>

        <ProjectInspector
          project={selectedProject}
          note={selectedProject ? notesById.get(selectedProject.noteId) : undefined}
          notes={notes}
          tasks={
            selectedProject
              ? selectedProject.taskIds.flatMap((id) => {
                  const task = tasksById.get(id);
                  return task ? [task] : [];
                })
              : []
          }
          events={
            selectedProject
              ? selectedProject.eventIds.flatMap((id) => {
                  const event = eventsById.get(id);
                  return event ? [event] : [];
                })
              : []
          }
        />
      </InspectorWorkspace>
    </main>
  );
}

function ProjectInspector({
  project,
  note,
  notes,
  tasks,
  events,
}: {
  project: Project | null;
  note?: Note;
  notes: Note[];
  tasks: Task[];
  events: CalendarEvent[];
}) {
  const { data: noteContent, error } = useGeneratedResource(
    note?.contentPath ?? null,
    validateNoteContent,
    "Project note",
  );

  if (!project) {
    return (
      <section className="project-inspector project-inspector-empty">
        <Icon icon="projects" size={30} aria-hidden="true" />
        <h2>Select a project</h2>
        <p>Choose a project to inspect its note and connected activity.</p>
      </section>
    );
  }

  return (
    <section className="project-inspector" aria-label={`${project.title} details`}>
      <header className="project-inspector-header">
        <div>
          <span className={`project-status project-status--${project.status}`}>
            <i aria-hidden="true" />
            {statusLabels[project.status]}
          </span>
          <h2>{project.title}</h2>
          {project.description ? <p>{project.description}</p> : null}
        </div>
        <Link to={project.route}>
          <Icon icon="document-open" size={14} aria-hidden="true" />
          Open note
        </Link>
      </header>

      <div className="project-inspector-scroll">
        <dl className="project-metrics">
          <div>
            <dt>Tasks</dt>
            <dd>{tasks.length}</dd>
          </div>
          <div>
            <dt>Events</dt>
            <dd>{events.length}</dd>
          </div>
          <div>
            <dt>People</dt>
            <dd>{project.people.length}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDate(project.modifiedAt)}</dd>
          </div>
        </dl>

        {project.people.length > 0 ? (
          <section className="project-inspector-section">
            <span>People</span>
            <div className="project-people">
              {project.people.map((person) => (
                <Link key={person.noteId} to={person.route}>
                  {person.avatarUrl ? (
                    <img src={person.avatarUrl} alt="" loading="lazy" />
                  ) : (
                    <i aria-hidden="true">{initials(person.name)}</i>
                  )}
                  {person.name}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <ProjectActivity title="Tasks" empty="No project tasks yet.">
          {tasks.map((task) => (
            <Link key={task.id} to={task.route}>
              <Icon icon="tick-circle" size={13} aria-hidden="true" />
              <span>
                <strong>{task.title}</strong>
                <small>{task.status.replace("_", " ")}</small>
              </span>
            </Link>
          ))}
        </ProjectActivity>

        <ProjectActivity title="Events" empty="No project events yet.">
          {events.map((event) => (
            <Link key={event.id} to={event.route || "/calendar"}>
              <Icon icon="calendar" size={13} aria-hidden="true" />
              <span>
                <strong>{event.title}</strong>
                <small>{event.date} · {event.startTime}</small>
              </span>
            </Link>
          ))}
        </ProjectActivity>

        <section className="project-inspector-section project-note-preview">
          <span>Project note</span>
          {!note ? (
            <p className="project-muted">No project note is linked.</p>
          ) : error ? (
            <p className="project-muted">The project note could not be loaded.</p>
          ) : !noteContent ? (
            <div className="project-note-loading" role="status">
              Loading project note…
            </div>
          ) : noteContent.content ? (
            <NoteMarkdown
              content={noteContent.content}
              note={note}
              notes={notes}
              headings={noteContent.headings}
            />
          ) : (
            <p className="project-muted">This project note is empty.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function ProjectActivity({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.some(Boolean);
  return (
    <section className="project-inspector-section project-activity">
      <span>{title}</span>
      {hasItems ? <div>{children}</div> : <p className="project-muted">{empty}</p>}
    </section>
  );
}

function ProjectEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="projects-empty">
      <Icon icon={filtered ? "filter" : "projects"} size={24} aria-hidden="true" />
      <strong>{filtered ? "No matching projects" : "No projects yet"}</strong>
      <span>
        {filtered
          ? "Try another search or status."
          : "Add a project record under library/projects/."}
      </span>
    </div>
  );
}

function projectSearchText(project: Project) {
  return [
    project.title,
    project.description,
    project.status,
    project.tags.join(" "),
    project.people.map((person) => person.name).join(" "),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("");
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dateFormatter.format(date);
}
