import type {
  CatalogNote,
  PersonNoteSidebar,
} from "@castle/contracts";

export type {
  CalendarEvent,
  CalendarEventPerson,
  KnowledgeBase,
  LibraryFolder,
  NoteSidebarFact,
  PersonContact,
  PersonContactKind,
  PersonNoteSidebar,
  Project,
  ProjectReference,
  ProjectStatus,
  SectionSummary,
  Shortcut,
  ShortcutCollection,
  Task,
  TaskPerson,
  TaskStatus,
  TaskSubtask,
} from "@castle/contracts";

export type Note = CatalogNote;
export type NoteSidebar = PersonNoteSidebar;

export interface Heading {
  depth: number;
  label: string;
  id: string;
  line: number;
}

export interface BacklinkOccurrence {
  anchorId: string;
  context: string;
}

export interface BacklinkGroup {
  sourceNoteId: string;
  occurrences: BacklinkOccurrence[];
}

export interface NoteContent {
  id: string;
  content: string;
  headings: Heading[];
  outgoingNoteIds: string[];
  backlinkNoteIds: string[];
  backlinks: BacklinkGroup[];
  relatedNoteIds: string[];
}

export interface SearchIndexEntry {
  id: string;
  text: string;
}

export interface SearchIndex {
  generatedAt: string;
  entries: SearchIndexEntry[];
}

export interface GraphCategory {
  id: string;
  label: string;
  path: string;
  count: number;
  color: string;
}

export interface GraphRelation {
  id: string;
  label: string;
  count: number;
  color: string;
}

export interface GraphAlignment {
  id: string;
  label: string;
  count: number;
  color: string;
}

export type GraphGroupingMode = "relation" | "known_from";

export interface GraphPersonLocation {
  id: string;
  label: string;
  address: string;
  primary: boolean;
  mapsUrl?: string;
  latitude?: number;
  longitude?: number;
}

export interface GraphNode {
  id: string;
  type: "root" | "category" | "company" | "department" | "person";
  label: string;
  categoryId: string;
  categoryIds: string[];
  categoryLabel: string;
  relation: string;
  relationLabel: string;
  relationColor: string;
  alignments: string[];
  alignmentLabel: string;
  knownFrom: string[];
  knownFromLabel: string;
  company?: string;
  departments?: string[];
  departmentLabel?: string;
  location?: string;
  locations?: GraphPersonLocation[];
  mapsUrl?: string;
  latitude?: number;
  longitude?: number;
  status: string;
  tags: string[];
  href: string;
  avatarUrl?: string;
  color: string;
  radius: number;
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  textAnchor: "start" | "middle" | "end";
}

export interface GraphEdge {
  id: string;
  type:
    | "category"
    | "company"
    | "department"
    | "person"
    | "person-relation"
    | "note-link";
  source: string;
  target: string;
  path: string;
  relation?: string;
  relationLabel?: string;
  relationship?: string;
  color?: string;
}

export interface RelationshipGraphViewData {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  mode: GraphGroupingMode;
  noteLinkCount: number;
  categories: GraphCategory[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RelationshipGraphData extends RelationshipGraphViewData {
  peopleCount: number;
  personRelationCount: number;
  relations: GraphRelation[];
  alignments: GraphAlignment[];
  views: Record<GraphGroupingMode, RelationshipGraphViewData>;
}
