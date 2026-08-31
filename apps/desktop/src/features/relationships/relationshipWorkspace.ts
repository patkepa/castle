import type { GraphGroupingMode, GraphNode, RelationshipGraphData } from "../../types";

export type RelationshipWorkspaceMode = "split" | "hierarchy" | "graph" | "map";
export type PeopleBrowserView = "list" | "tree" | "graph";

export interface RelationshipWorkspaceState {
  groupingMode: GraphGroupingMode;
  workspaceMode: RelationshipWorkspaceMode;
  leftView: PeopleBrowserView;
  query: string;
  activeCategories: Set<string>;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  controlsOpen: boolean;
  simulationRunning: boolean;
  showConnections: boolean;
  showDepartments: boolean;
  showPersonRelations: boolean;
  showNoteLinks: boolean;
}

export type RelationshipWorkspaceAction =
  | { type: "set-grouping"; mode: GraphGroupingMode; categoryIds: string[] }
  | { type: "set-workspace-mode"; mode: RelationshipWorkspaceMode; knownFromCategoryIds: string[] }
  | { type: "set-left-view"; view: PeopleBrowserView; knownFromCategoryIds: string[] }
  | { type: "set-query"; query: string }
  | { type: "select-category"; categoryIds: string[] }
  | { type: "toggle-category"; categoryId: string }
  | { type: "toggle-all-categories"; categoryIds: string[] }
  | { type: "select-node"; nodeId: string | null }
  | { type: "hover-node"; nodeId: string | null }
  | { type: "toggle-controls" }
  | { type: "toggle-simulation" }
  | { type: "toggle-connections"; clearSelection: boolean }
  | { type: "toggle-departments"; clearSelection: boolean }
  | { type: "toggle-person-relations" }
  | { type: "toggle-note-links" }
  | { type: "escape" };

export function createRelationshipWorkspaceState(
  graph: RelationshipGraphData,
): RelationshipWorkspaceState {
  return {
    groupingMode: "known_from",
    workspaceMode: "graph",
    leftView: "tree",
    query: "",
    activeCategories: new Set(graph.categories.map((category) => category.id)),
    selectedNodeId: null,
    hoveredNodeId: null,
    controlsOpen: false,
    simulationRunning: true,
    showConnections: true,
    showDepartments: false,
    showPersonRelations: true,
    showNoteLinks: false,
  };
}

export function relationshipWorkspaceReducer(
  state: RelationshipWorkspaceState,
  action: RelationshipWorkspaceAction,
): RelationshipWorkspaceState {
  switch (action.type) {
    case "set-grouping":
      return {
        ...state,
        groupingMode: action.mode,
        activeCategories: new Set(action.categoryIds),
        hoveredNodeId: null,
      };
    case "set-workspace-mode":
      return action.mode === "split"
        ? {
            ...state,
            workspaceMode: action.mode,
            groupingMode: "known_from",
            activeCategories: new Set(action.knownFromCategoryIds),
            hoveredNodeId: null,
          }
        : { ...state, workspaceMode: action.mode };
    case "set-left-view":
      return action.view !== "graph"
        ? {
            ...state,
            leftView: action.view,
            groupingMode: "known_from",
            activeCategories: new Set(action.knownFromCategoryIds),
            hoveredNodeId: null,
          }
        : { ...state, leftView: action.view };
    case "set-query":
      return { ...state, query: action.query };
    case "select-category":
      return { ...state, activeCategories: new Set(action.categoryIds) };
    case "toggle-category":
      return {
        ...state,
        activeCategories: toggleSetValue(state.activeCategories, action.categoryId),
      };
    case "toggle-all-categories":
      return {
        ...state,
        activeCategories:
          state.activeCategories.size === action.categoryIds.length
            ? new Set()
            : new Set(action.categoryIds),
      };
    case "select-node":
      return { ...state, selectedNodeId: action.nodeId };
    case "hover-node":
      return { ...state, hoveredNodeId: action.nodeId };
    case "toggle-controls":
      return { ...state, controlsOpen: !state.controlsOpen };
    case "toggle-simulation":
      return { ...state, simulationRunning: !state.simulationRunning };
    case "toggle-connections":
      return {
        ...state,
        showConnections: !state.showConnections,
        selectedNodeId: action.clearSelection ? null : state.selectedNodeId,
      };
    case "toggle-departments":
      return {
        ...state,
        showDepartments: !state.showDepartments,
        selectedNodeId: action.clearSelection ? null : state.selectedNodeId,
      };
    case "toggle-person-relations":
      return { ...state, showPersonRelations: !state.showPersonRelations };
    case "toggle-note-links":
      return { ...state, showNoteLinks: !state.showNoteLinks };
    case "escape":
      return { ...state, workspaceMode: "split", query: "" };
  }
}

export function shouldClearSelectionWhenHidingConnections(node: GraphNode | null) {
  return Boolean(
    node &&
      (node.type === "category" ||
        node.type === "company" ||
        node.type === "department"),
  );
}

function toggleSetValue<T>(current: ReadonlySet<T>, value: T) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
