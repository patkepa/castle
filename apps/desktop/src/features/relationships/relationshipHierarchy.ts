import type { GraphNode, RelationshipGraphData } from "../../types";

export interface RelationshipHierarchyDepartment {
  node: GraphNode;
  people: GraphNode[];
}

export interface RelationshipHierarchyCompany {
  node: GraphNode;
  directPeople: GraphNode[];
  departments: RelationshipHierarchyDepartment[];
  peopleCount: number;
}

export interface RelationshipHierarchyCategory {
  node: GraphNode;
  directPeople: GraphNode[];
  companies: RelationshipHierarchyCompany[];
  peopleCount: number;
}

export interface RelationshipHierarchyModel {
  root: GraphNode | null;
  categories: RelationshipHierarchyCategory[];
  peopleCount: number;
}

const hierarchyEdgeTypes = new Set(["company", "department", "person"]);

export function buildRelationshipHierarchy(
  graph: RelationshipGraphData,
  people: readonly GraphNode[],
  activeCategories: ReadonlySet<string>,
): RelationshipHierarchyModel {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const visiblePeopleById = new Map(people.map((person) => [person.id, person]));
  const childrenBySource = new Map<string, GraphNode[]>();

  for (const edge of graph.edges) {
    if (!hierarchyEdgeTypes.has(edge.type)) continue;
    const child = nodesById.get(edge.target);
    if (!child) continue;
    const children = childrenBySource.get(edge.source);
    if (children) children.push(child);
    else childrenBySource.set(edge.source, [child]);
  }

  const categories: RelationshipHierarchyCategory[] = [];
  for (const category of graph.categories) {
    if (!activeCategories.has(category.id)) continue;
    const categoryNode = nodesById.get(`category:${category.id}`);
    if (!categoryNode) continue;

    const categoryChildren = childrenBySource.get(categoryNode.id) ?? [];
    const directPeople = visiblePeople(
      categoryChildren,
      visiblePeopleById,
    );
    const companies = categoryChildren
      .filter((node) => node.type === "company")
      .map((companyNode): RelationshipHierarchyCompany => {
        const companyChildren = childrenBySource.get(companyNode.id) ?? [];
        const companyDirectPeople = visiblePeople(
          companyChildren,
          visiblePeopleById,
        );
        const departments = companyChildren
          .filter((node) => node.type === "department")
          .map((departmentNode): RelationshipHierarchyDepartment => ({
            node: departmentNode,
            people: visiblePeople(
              childrenBySource.get(departmentNode.id) ?? [],
              visiblePeopleById,
            ),
          }))
          .filter((department) => department.people.length > 0)
          .sort((left, right) => left.node.label.localeCompare(right.node.label));
        const peopleCount = countUniquePeople(
          companyDirectPeople,
          departments.flatMap((department) => department.people),
        );

        return {
          node: companyNode,
          directPeople: companyDirectPeople,
          departments,
          peopleCount,
        };
      })
      .filter((company) => company.peopleCount > 0)
      .sort((left, right) => left.node.label.localeCompare(right.node.label));
    const peopleCount = countUniquePeople(
      directPeople,
      companies.flatMap((company) => [
        ...company.directPeople,
        ...company.departments.flatMap((department) => department.people),
      ]),
    );

    if (peopleCount === 0) continue;
    categories.push({
      node: categoryNode,
      directPeople,
      companies,
      peopleCount,
    });
  }

  return {
    root: nodesById.get("root:owner") ?? null,
    categories,
    peopleCount: new Set(people.map((person) => person.id)).size,
  };
}

function visiblePeople(
  nodes: readonly GraphNode[],
  visiblePeopleById: ReadonlyMap<string, GraphNode>,
) {
  return nodes
    .filter((node) => node.type === "person" && visiblePeopleById.has(node.id))
    .map((node) => visiblePeopleById.get(node.id) as GraphNode)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function countUniquePeople(...groups: readonly GraphNode[][]) {
  const ids = new Set<string>();
  for (const group of groups) {
    for (const person of group) ids.add(person.id);
  }
  return ids.size;
}
