import type { GraphEdge, GraphNode, RelationshipGraphData } from "../../types";

export interface RelationshipVisibilityOptions {
  graph: RelationshipGraphData;
  activeCategories: ReadonlySet<string>;
  showConnections: boolean;
  showDepartments: boolean;
  showPersonRelations: boolean;
  showNoteLinks: boolean;
}

export interface RelationshipVisibility {
  visibleNodeIds: Set<string>;
  canvasVisibleNodeIds: Set<string>;
  visibleEdges: GraphEdge[];
}

export function createRelationshipVisibility({
  graph,
  activeCategories,
  showConnections,
  showDepartments,
  showPersonRelations,
  showNoteLinks,
}: RelationshipVisibilityOptions): RelationshipVisibility {
  const visibleNodeIds = new Set<string>(["root:owner"]);
  for (const node of graph.nodes) {
    if (
      node.type !== "root" &&
      node.categoryIds.some((categoryId) => activeCategories.has(categoryId))
    ) {
      visibleNodeIds.add(node.id);
    }
  }

  const departmentParents = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.type === "department") {
      departmentParents.set(edge.target, edge.source);
    }
  }

  const visibleEdges = graph.edges.flatMap((edge) => {
    if (
      !visibleNodeIds.has(edge.source) ||
      !visibleNodeIds.has(edge.target) ||
      (!showConnections &&
        edge.type !== "person-relation" &&
        edge.type !== "note-link") ||
      (!showPersonRelations && edge.type === "person-relation") ||
      (!showNoteLinks && edge.type === "note-link")
    ) {
      return [];
    }

    if (showDepartments || edge.type !== "department") {
      const departmentParent = departmentParents.get(edge.source);
      if (!showDepartments && departmentParent && edge.type === "person") {
        return [{
          ...edge,
          id: `${edge.id}:without-department`,
          source: departmentParent,
          path: "",
        }];
      }
      return [edge];
    }
    return [];
  });

  const canvasVisibleNodeIds = new Set(visibleNodeIds);
  for (const node of graph.nodes) {
    if (!showDepartments && node.type === "department") {
      canvasVisibleNodeIds.delete(node.id);
    }
    if (
      !showConnections &&
      (node.type === "category" ||
        node.type === "company" ||
        node.type === "department")
    ) {
      canvasVisibleNodeIds.delete(node.id);
    }
  }

  return { visibleNodeIds, canvasVisibleNodeIds, visibleEdges };
}

export function filterRelationshipPeople(
  people: readonly GraphNode[],
  activeCategories: ReadonlySet<string>,
  normalizedQuery: string,
) {
  return people.filter(
    (person) =>
      person.categoryIds.some((categoryId) => activeCategories.has(categoryId)) &&
      (!normalizedQuery || relationshipSearchText(person).includes(normalizedQuery)),
  );
}

export function findRelationshipSearchMatches(
  nodes: readonly GraphNode[],
  visibleNodeIds: ReadonlySet<string>,
  normalizedQuery: string,
) {
  if (!normalizedQuery) return new Set<string>();
  return new Set(
    nodes
      .filter(
        (node) =>
          visibleNodeIds.has(node.id) &&
          relationshipSearchText(node).includes(normalizedQuery),
      )
      .map((node) => node.id),
  );
}

export function relationshipSearchText(node: GraphNode) {
  return [
    node.label,
    node.categoryLabel,
    node.relationLabel,
    node.alignmentLabel,
    node.knownFromLabel,
    node.departmentLabel,
    node.status,
    ...node.tags,
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function createConnectionsMap(edges: readonly GraphEdge[]) {
  const connected = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!connected.has(edge.source)) connected.set(edge.source, new Set());
    if (!connected.has(edge.target)) connected.set(edge.target, new Set());
    connected.get(edge.source)?.add(edge.target);
    connected.get(edge.target)?.add(edge.source);
  }
  return connected;
}
