import assert from "node:assert/strict";
import test from "node:test";
import { buildRelationshipHierarchy } from "../apps/desktop/src/features/relationships/relationshipHierarchy.ts";
import {
  createRelationshipVisibility,
  filterRelationshipPeople,
} from "../apps/desktop/src/features/relationships/relationshipSelectors.ts";
import {
  createRelationshipWorkspaceState,
  relationshipWorkspaceReducer,
} from "../apps/desktop/src/features/relationships/relationshipWorkspace.ts";

const root = node("root:owner", "root", "Library Owner", []);
const business = node("category:businesses", "category", "Businesses", ["businesses"]);
const friends = node("category:friends", "category", "Friends", ["friends"]);
const company = node("company:businesses:example", "company", "Example", ["businesses"]);
const department = node(
  "department:businesses:example:engineering",
  "department",
  "Engineering",
  ["businesses"],
);
const alice = node("person:people/alice", "person", "Alice", ["businesses"]);
alice.knownFromLabel = "Businesses / Example";
alice.departmentLabel = "Engineering";
const bob = node("person:people/bob", "person", "Bob", ["friends"]);
const knownFrom = {
  width: 1600,
  height: 1000,
  centerX: 800,
  centerY: 500,
  mode: "known_from",
  noteLinkCount: 0,
  categories: [
    { id: "businesses", label: "Businesses", path: "businesses", color: "#5b9cf6", count: 1 },
    { id: "friends", label: "Friends", path: "friends", color: "#a78bfa", count: 1 },
  ],
  nodes: [root, business, company, department, alice, friends, bob],
  edges: [
    edge("edge:root:businesses", "category", root.id, business.id),
    edge("edge:category:example", "company", business.id, company.id),
    edge("edge:company:engineering", "department", company.id, department.id),
    edge("edge:department:alice", "person", department.id, alice.id),
    edge("edge:root:friends", "category", root.id, friends.id),
    edge("edge:friends:bob", "person", friends.id, bob.id),
  ],
};
const relation = {
  ...knownFrom,
  mode: "relation",
  categories: [
    { id: "positive", label: "Positive", path: "positive", color: "#22c55e", count: 1 },
    { id: "neutral", label: "Neutral", path: "neutral", color: "#38bdf8", count: 1 },
  ],
};
const graph = {
  ...knownFrom,
  peopleCount: 2,
  personRelationCount: 0,
  relations: [],
  alignments: [],
  views: { relation, known_from: knownFrom },
};

test("builds one canonical category, company, department, and person hierarchy", () => {
  const view = graph.views.known_from;
  const people = view.nodes.filter((node) => node.type === "person");
  const hierarchy = buildRelationshipHierarchy(
    { ...graph, ...view },
    people,
    new Set(view.categories.map((category) => category.id)),
  );
  const business = hierarchy.categories.find(
    (category) => category.node.label === "Businesses",
  );

  assert.equal(hierarchy.peopleCount, 2);
  assert.equal(business.peopleCount, 1);
  assert.equal(business.companies[0].node.label, "Example");
  assert.equal(business.companies[0].departments[0].node.label, "Engineering");
  assert.equal(business.companies[0].departments[0].people[0].label, "Alice");
});

test("keeps workspace view transitions and category resets atomic", () => {
  const initial = createRelationshipWorkspaceState(graph);
  const relationCategories = graph.views.relation.categories.map(({ id }) => id);
  const grouped = relationshipWorkspaceReducer(initial, {
    type: "set-grouping",
    mode: "relation",
    categoryIds: relationCategories,
  });
  const split = relationshipWorkspaceReducer(grouped, {
    type: "set-workspace-mode",
    mode: "split",
    knownFromCategoryIds: graph.views.known_from.categories.map(({ id }) => id),
  });

  assert.equal(grouped.groupingMode, "relation");
  assert.deepEqual([...grouped.activeCategories], relationCategories);
  assert.equal(split.workspaceMode, "split");
  assert.equal(split.groupingMode, "known_from");
});

test("opens the relationship graph with no selection or group sidebar", () => {
  const initial = createRelationshipWorkspaceState(graph);

  assert.equal(initial.workspaceMode, "graph");
  assert.equal(initial.selectedNodeId, null);
  assert.equal(initial.controlsOpen, false);
});

test("opens the map as an independent relationship workspace", () => {
  const initial = createRelationshipWorkspaceState(graph);
  const map = relationshipWorkspaceReducer(initial, {
    type: "set-workspace-mode",
    mode: "map",
    knownFromCategoryIds: graph.views.known_from.categories.map(({ id }) => id),
  });

  assert.equal(map.workspaceMode, "map");
  assert.equal(map.groupingMode, "known_from");
});

test("derives filtered people and graph visibility without UI state", () => {
  const view = { ...graph, ...graph.views.known_from };
  const activeCategories = new Set(["businesses"]);
  const people = view.nodes.filter((node) => node.type === "person");
  const filtered = filterRelationshipPeople(people, activeCategories, "alice");
  const visibility = createRelationshipVisibility({
    graph: view,
    activeCategories,
    showConnections: true,
    showDepartments: false,
    showPersonRelations: true,
    showNoteLinks: false,
  });

  assert.deepEqual(filtered.map(({ label }) => label), ["Alice"]);
  assert.equal(
    [...visibility.canvasVisibleNodeIds].some((id) => id.startsWith("department:")),
    false,
  );
  assert.ok(
    visibility.visibleEdges.some((edge) => edge.id.endsWith(":without-department")),
  );
});

function node(id, type, label, categoryIds) {
  return {
    id,
    type,
    label,
    categoryId: categoryIds[0] ?? "",
    categoryIds,
    categoryLabel: "",
    relation: "",
    relationLabel: "",
    relationColor: "",
    alignments: [],
    alignmentLabel: "",
    knownFrom: [],
    knownFromLabel: "",
    status: "",
    tags: [],
    href: "",
    avatarUrl: "",
    color: "#5b9cf6",
    radius: 10,
    x: 0,
    y: 0,
    labelX: 0,
    labelY: 0,
    textAnchor: "middle",
  };
}

function edge(id, type, source, target) {
  return { id, type, source, target, path: "" };
}
