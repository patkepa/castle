import type { IconName } from "@patkepa/kantzen-ui/primitives";
import type { SearchPage } from "./noteSearch";

export interface AppSearchPage extends SearchPage {
  icon: IconName;
}

export const APP_SEARCH_PAGES = [
  {
    id: "home",
    label: "Home",
    description: "Saved links and quick actions",
    keywords: ["shortcuts", "links", "bookmarks", "quick actions", "start"],
    route: "/",
    icon: "home",
  },
  {
    id: "library",
    label: "Library",
    description: "Browse every note and folder",
    keywords: ["notes", "folders", "browse"],
    route: "/library",
    icon: "folder-open",
  },
  {
    id: "people",
    label: "People",
    description: "Relationships and contacts",
    keywords: ["relationships", "contacts", "graph"],
    route: "/relationship-graph",
    icon: "graph",
  },
  {
    id: "stash",
    label: "Stash",
    description: "Inbox for uncategorized notes",
    keywords: ["inbox", "uncategorized"],
    route: "/browse/stash",
    icon: "inbox",
  },
  {
    id: "projects",
    label: "Projects",
    description: "Project plans and progress",
    keywords: ["plans", "progress", "work"],
    route: "/projects",
    icon: "projects",
  },
  {
    id: "tasks",
    label: "Tasks",
    description: "Personal and project tasks",
    keywords: ["todos", "to do", "actions"],
    route: "/tasks",
    icon: "tick-circle",
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Schedule and events",
    keywords: ["schedule", "events", "dates"],
    route: "/calendar",
    icon: "calendar",
  },
  {
    id: "sheets",
    label: "Sheets",
    description: "Browse OpenDocument spreadsheets in the library",
    keywords: ["spreadsheet", "ods", "open document", "table"],
    route: "/browse/sheets",
    icon: "th",
  },
  {
    id: "canvas",
    label: "Canvas",
    description: "Create visual maps in JSON Canvas",
    keywords: ["whiteboard", "mind map", "obsidian", "json canvas"],
    route: "/canvas",
    icon: "grid-view",
  },
] as const satisfies readonly AppSearchPage[];
