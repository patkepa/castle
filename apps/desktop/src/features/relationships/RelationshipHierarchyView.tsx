import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Icon } from "@patkepa/kantzen-ui/primitives";
import { SearchField } from "@patkepa/kantzen-ui";
import { Link } from "react-router-dom";
import type {
  GraphGroupingMode,
  GraphNode,
  RelationshipGraphData,
} from "../../types";
import { buildRelationshipHierarchy } from "./relationshipHierarchy";
import { useCastleContextMenu } from "../context_menu/CastleContextMenu";
import { createPersonContextMenu } from "../context_menu/context_menu_models";

const ROOT_NODE_ID = "root:owner";

export function RelationshipHierarchyView({
  graph,
  groupingMode,
  onGroupingModeChange,
  people,
  query,
  onQueryChange,
  inputRef,
  activeCategories,
  onCategoryChange,
  selectedNode,
  onSelectNode,
}: {
  graph: RelationshipGraphData;
  groupingMode: GraphGroupingMode;
  onGroupingModeChange: (mode: GraphGroupingMode) => void;
  people: GraphNode[];
  query: string;
  onQueryChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  activeCategories: Set<string>;
  onCategoryChange: (categoryId: string) => void;
  selectedNode: GraphNode | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const categorySelection =
    activeCategories.size === graph.categories.length
      ? "all"
      : activeCategories.size === 1
        ? (activeCategories.values().next().value ?? "all")
        : "custom";

  return (
    <main className="graph-page relationship-page relationship-hierarchy-page">
      <header className="relationship-hierarchy-header">
        <div className="relationship-hierarchy-title">
          <span>Relationship structure</span>
          <h1>People hierarchy</h1>
        </div>

        <div className="relationship-hierarchy-controls">
          <SearchField
            className="people-search-field"
            inputRef={inputRef}
            value={query}
            placeholder="Search people"
            onChange={onQueryChange}
          />
          <label className="people-category-select">
            <span className="sr-only">
              Filter by {groupingMode === "relation" ? "relation" : "origin"}
            </span>
            <select
              value={categorySelection}
              onChange={(event) => onCategoryChange(event.target.value)}
            >
              <option value="all">
                {groupingMode === "relation" ? "All relations" : "All origins"}
              </option>
              {categorySelection === "custom" ? (
                <option value="custom" disabled>
                  Custom selection
                </option>
              ) : null}
              {graph.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
            <Icon icon="chevron-down" size={12} aria-hidden="true" />
          </label>
          <div
            className="relationship-grouping-switcher"
            aria-label="Group hierarchy by"
          >
            <button
              type="button"
              className={groupingMode === "known_from" ? "is-active" : ""}
              aria-pressed={groupingMode === "known_from"}
              onClick={() => onGroupingModeChange("known_from")}
            >
              Known from
            </button>
            <button
              type="button"
              className={groupingMode === "relation" ? "is-active" : ""}
              aria-pressed={groupingMode === "relation"}
              onClick={() => onGroupingModeChange("relation")}
            >
              Relation
            </button>
          </div>
        </div>
      </header>

      <section
        className="relationship-hierarchy-stage"
        aria-label="People hierarchy"
      >
        <div className="relationship-hierarchy-context">
          <span>
            <strong className="mono-data">{people.length}</strong>{" "}
            {people.length === 1 ? "person" : "people"}
          </span>
          <span>
            Grouped by{" "}
            <strong>
              {groupingMode === "relation" ? "relation" : "where you met"}
            </strong>
          </span>
          {selectedNode?.type === "person" && selectedNode.href ? (
            <Link className="relationship-hierarchy-open" to={selectedNode.href}>
              <Icon icon="document-open" size={12} />
              Open {selectedNode.label}
            </Link>
          ) : null}
        </div>

        <HierarchyOrgChart
          graph={graph}
          people={people}
          activeCategories={activeCategories}
          queryActive={Boolean(query.trim())}
          selectedNodeId={selectedNode?.id ?? null}
          onSelectNode={onSelectNode}
        />
      </section>

      <footer
        className="relationship-workspace-status"
        aria-label="Hierarchy status"
      >
        <span className="graph-status-live">
          <i aria-hidden="true" />
          <span>Hierarchy ready</span>
        </span>
        <span>
          Groups <strong className="mono-data">{graph.categories.length}</strong>
        </span>
        <span>
          Connections{" "}
          <strong className="mono-data">
            {graph.edges.length - graph.noteLinkCount}
          </strong>
        </span>
      </footer>
    </main>
  );
}

type HierarchyOrgNodeKind =
  | "root"
  | "category"
  | "company"
  | "department"
  | "group"
  | "person";

interface HierarchyOrgNode {
  id: string;
  dataId: string;
  kind: HierarchyOrgNodeKind;
  label: string;
  subtitle: string;
  color: string;
  children: HierarchyOrgNode[];
}

interface HierarchyOrgPositionedNode {
  node: HierarchyOrgNode;
  x: number;
  y: number;
}

interface HierarchyOrgConnector {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  color: string;
}

interface HierarchyOrgLayout {
  width: number;
  height: number;
  nodes: HierarchyOrgPositionedNode[];
  connectors: HierarchyOrgConnector[];
}

interface HierarchyViewport {
  width: number;
  height: number;
}

interface HierarchyViewTransform {
  x: number;
  y: number;
  scale: number;
}

const HIERARCHY_NODE_WIDTH = 190;
const HIERARCHY_NODE_HEIGHT = 58;
const HIERARCHY_LEVEL_GAP = 92;
const HIERARCHY_ROW_GAP = 18;
const HIERARCHY_LAYOUT_PADDING = 48;
const HIERARCHY_DIRECT_GROUP_THRESHOLD = 8;

function HierarchyOrgChart({
  graph,
  people,
  activeCategories,
  queryActive,
  selectedNodeId,
  onSelectNode,
}: {
  graph: RelationshipGraphData;
  people: GraphNode[];
  activeCategories: Set<string>;
  queryActive: boolean;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const { openMenu } = useCastleContextMenu();
  const containerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    viewX: number;
    viewY: number;
  } | null>(null);
  const chart = useMemo(
    () => buildHierarchyOrgChart(graph, people, activeCategories),
    [activeCategories, graph, people],
  );
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );
  const [expandedIds, setExpandedIds] = useState(
    () => new Set<string>([ROOT_NODE_ID]),
  );
  const [viewport, setViewport] = useState<HierarchyViewport>({
    width: 0,
    height: 0,
  });
  const [view, setView] = useState<HierarchyViewTransform>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const bounds = container.getBoundingClientRect();
      setViewport({ width: bounds.width, height: bounds.height });
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setExpandedIds((current) => {
      const next = new Set(current);

      if (queryActive) {
        addExpandableHierarchyNodes(chart, next);
      } else if (selectedNodeId) {
        const path = findHierarchyPath(chart, selectedNodeId);
        for (const node of path) {
          if (node.children.length > 0) next.add(node.id);
        }
      }

      return setsHaveSameValues(current, next) ? current : next;
    });
  }, [chart, queryActive, selectedNodeId]);

  const layout = useMemo(
    () => layoutHierarchyOrgChart(chart, expandedIds),
    [chart, expandedIds],
  );

  const fitChart = useCallback(() => {
    if (!viewport.width || !viewport.height) return;
    const horizontalScale = (viewport.width - 72) / layout.width;
    const verticalScale = (viewport.height - 72) / layout.height;
    const scale = Math.min(1.2, Math.max(0.12, Math.min(horizontalScale, verticalScale)));
    setView({
      scale,
      x: (viewport.width - layout.width * scale) / 2,
      y: (viewport.height - layout.height * scale) / 2,
    });
  }, [layout.height, layout.width, viewport.height, viewport.width]);

  useEffect(() => {
    fitChart();
  }, [fitChart]);

  const zoomAtCenter = useCallback(
    (multiplier: number) => {
      const centerX = viewport.width / 2;
      const centerY = viewport.height / 2;
      setView((current) => {
        const scale = Math.min(2.4, Math.max(0.12, current.scale * multiplier));
        const graphX = (centerX - current.x) / current.scale;
        const graphY = (centerY - current.y) / current.scale;
        return {
          scale,
          x: centerX - graphX * scale,
          y: centerY - graphY * scale,
        };
      });
    },
    [viewport.height, viewport.width],
  );

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const multiplier = Math.exp(-event.deltaY * 0.0012);

    setView((current) => {
      const scale = Math.min(2.4, Math.max(0.12, current.scale * multiplier));
      const graphX = (pointerX - current.x) / current.scale;
      const graphY = (pointerY - current.y) / current.scale;
      return {
        scale,
        x: pointerX - graphX * scale,
        y: pointerY - graphY * scale,
      };
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (
      event.button !== 0 ||
      (event.target as Element).closest("[data-hierarchy-node]")
    ) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewX: view.x,
      viewY: view.y,
    };
    setPanning(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setView((current) => ({
      ...current,
      x: pan.viewX + event.clientX - pan.startX,
      y: pan.viewY + event.clientY - pan.startY,
    }));
  };

  const finishPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleNodeClick = (node: HierarchyOrgNode) => {
    if (node.kind === "person") {
      onSelectNode(node.dataId);
      return;
    }
    if (node.children.length === 0) return;
    setExpandedIds((current) => toggleSetValue(current, node.id));
  };

  if (people.length === 0) {
    return (
      <div className="hierarchy-org-empty">
        <Icon icon="search" size={22} />
        <p>No people match these filters.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="hierarchy-org-chart">
      <svg
        className={[
          "hierarchy-org-canvas",
          panning && "is-panning",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label="Interactive people organization chart. Select group cards to expand or collapse them, drag to pan, and use the mouse wheel to zoom."
        onPointerCancel={finishPan}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPan}
        onWheel={handleWheel}
        role="tree"
      >
        <rect className="hierarchy-org-hit-area" width="100%" height="100%" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {layout.connectors.map((connector) => {
            const middleX = (connector.sourceX + connector.targetX) / 2;
            return (
              <path
                className="hierarchy-org-connector"
                d={`M ${connector.sourceX} ${connector.sourceY} C ${middleX} ${connector.sourceY}, ${middleX} ${connector.targetY}, ${connector.targetX} ${connector.targetY}`}
                key={connector.id}
                style={{ "--hierarchy-color": connector.color } as CSSProperties}
              />
            );
          })}

          {layout.nodes.map(({ node, x, y }) => {
            const expandable = node.children.length > 0;
            const expanded = expandedIds.has(node.id);
            const selected =
              node.kind === "person" && node.dataId === selectedNodeId;

            return (
              <g
                className={[
                  "hierarchy-org-node",
                  `hierarchy-org-node--${node.kind}`,
                  expandable && "is-expandable",
                  expanded && "is-expanded",
                  selected && "is-selected",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-hierarchy-node="true"
                key={node.id}
                onClick={() => handleNodeClick(node)}
                onContextMenu={(event) => {
                  if (node.kind !== "person") return;
                  const person = peopleById.get(node.dataId);
                  if (!person) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectNode(person.id);
                  openMenu(createPersonContextMenu(person), {
                    left: event.clientX,
                    top: event.clientY,
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  handleNodeClick(node);
                }}
                role="treeitem"
                style={{ "--hierarchy-color": node.color } as CSSProperties}
                tabIndex={0}
                transform={`translate(${x} ${y})`}
              >
                <rect
                  className="hierarchy-org-node-card"
                  height={HIERARCHY_NODE_HEIGHT}
                  rx="2"
                  width={HIERARCHY_NODE_WIDTH}
                  x={-HIERARCHY_NODE_WIDTH / 2}
                  y={-HIERARCHY_NODE_HEIGHT / 2}
                />
                <rect
                  className="hierarchy-org-node-accent"
                  height={HIERARCHY_NODE_HEIGHT}
                  width="4"
                  x={-HIERARCHY_NODE_WIDTH / 2}
                  y={-HIERARCHY_NODE_HEIGHT / 2}
                />
                <text className="hierarchy-org-node-kind" x={-77} y={-8}>
                  {getHierarchyKindLabel(node.kind)}
                </text>
                <text className="hierarchy-org-node-label" x={-77} y={10}>
                  {truncateHierarchyLabel(node.label, 24)}
                </text>
                <text className="hierarchy-org-node-subtitle" x={-77} y={24}>
                  {truncateHierarchyLabel(node.subtitle, 28)}
                </text>
                {expandable ? (
                  <g className="hierarchy-org-expand-control" transform="translate(78 0)">
                    <circle r="10" />
                    <path d={expanded ? "M -4 0 H 4" : "M -4 0 H 4 M 0 -4 V 4"} />
                  </g>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="hierarchy-org-help">
        <span>Drag to pan</span>
        <span>Scroll to zoom</span>
        <span>Select groups to expand</span>
      </div>

      <div className="graph-tool-strip hierarchy-org-tools">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAtCenter(1.2)}>
          <Icon icon="zoom-in" size={14} />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAtCenter(0.84)}>
          <Icon icon="zoom-out" size={14} />
        </button>
        <button type="button" aria-label="Fit hierarchy" onClick={fitChart}>
          <Icon icon="maximize" size={14} />
        </button>
      </div>
    </div>
  );
}

function buildHierarchyOrgChart(
  graph: RelationshipGraphData,
  people: GraphNode[],
  activeCategories: Set<string>,
): HierarchyOrgNode {
  const hierarchy = buildRelationshipHierarchy(graph, people, activeCategories);
  const categoryNodes = hierarchy.categories.map((category) => {
    const categoryNode = category.node;
    const companyNodes = category.companies.map((company) => {
        const companyId = `hierarchy:${categoryNode.id}:${company.node.id}`;
        const companyChildNodes: HierarchyOrgNode[] = company.departments.map(
          (department) =>
            createHierarchyBranchNode(
              `${companyId}:${department.node.id}`,
              department.node.id,
              "department",
              department.node.label,
              department.node.color,
              department.people,
            ),
        );

        if (company.directPeople.length > HIERARCHY_DIRECT_GROUP_THRESHOLD) {
          companyChildNodes.push(
            createHierarchyBranchNode(
              `${companyId}:direct-contacts`,
              company.node.id,
              "group",
              "Direct contacts",
              company.node.color,
              company.directPeople,
            ),
          );
        } else {
          companyChildNodes.push(
            ...company.directPeople.map((person) =>
              createHierarchyPersonNode(`${companyId}:${person.id}`, person),
            ),
          );
        }
        return {
          id: companyId,
          dataId: company.node.id,
          kind: "company" as const,
          label: company.node.label,
          subtitle: `${company.peopleCount} ${company.peopleCount === 1 ? "person" : "people"}`,
          color: company.node.color,
          children: companyChildNodes,
        };
      });
    const childNodes: HierarchyOrgNode[] = [...companyNodes];

    if (category.directPeople.length > HIERARCHY_DIRECT_GROUP_THRESHOLD) {
      childNodes.push(
        createHierarchyBranchNode(
          `hierarchy:${categoryNode.id}:direct-contacts`,
          categoryNode.id,
          "group",
          "Direct contacts",
          categoryNode.color,
          category.directPeople,
        ),
      );
    } else {
      childNodes.push(
        ...category.directPeople.map((person) =>
          createHierarchyPersonNode(
            `hierarchy:${categoryNode.id}:${person.id}`,
            person,
          ),
        ),
      );
    }

    return {
      id: `hierarchy:${categoryNode.id}`,
      dataId: categoryNode.id,
      kind: "category" as const,
      label: categoryNode.label,
      subtitle: `${category.peopleCount} ${category.peopleCount === 1 ? "person" : "people"}`,
      color: categoryNode.color,
      children: childNodes,
    };
  });

  return {
    id: ROOT_NODE_ID,
    dataId: ROOT_NODE_ID,
    kind: "root",
    label: hierarchy.root?.label ?? "Owner",
    subtitle: `${hierarchy.peopleCount} ${hierarchy.peopleCount === 1 ? "person" : "people"}`,
    color: hierarchy.root?.color ?? "#5b9cf6",
    children: categoryNodes,
  };
}

function createHierarchyBranchNode(
  id: string,
  dataId: string,
  kind: "department" | "group",
  label: string,
  color: string,
  people: GraphNode[],
): HierarchyOrgNode {
  return {
    id,
    dataId,
    kind,
    label,
    subtitle: `${people.length} ${people.length === 1 ? "person" : "people"}`,
    color,
    children: people.map((person) =>
      createHierarchyPersonNode(`${id}:${person.id}`, person),
    ),
  };
}

function createHierarchyPersonNode(
  id: string,
  person: GraphNode,
): HierarchyOrgNode {
  return {
    id,
    dataId: person.id,
    kind: "person",
    label: person.label,
    subtitle:
      person.alignmentLabel || person.relationLabel || person.status || "Person",
    color: person.color,
    children: [],
  };
}

function addExpandableHierarchyNodes(
  node: HierarchyOrgNode,
  result: Set<string>,
) {
  if (node.children.length > 0) result.add(node.id);
  for (const child of node.children) addExpandableHierarchyNodes(child, result);
}

function findHierarchyPath(
  node: HierarchyOrgNode,
  dataId: string,
): HierarchyOrgNode[] {
  if (node.dataId === dataId) return [node];
  for (const child of node.children) {
    const childPath = findHierarchyPath(child, dataId);
    if (childPath.length > 0) return [node, ...childPath];
  }
  return [];
}

function setsHaveSameValues(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function layoutHierarchyOrgChart(
  root: HierarchyOrgNode,
  expandedIds: Set<string>,
): HierarchyOrgLayout {
  const heights = new Map<string, number>();
  let maximumDepth = 0;

  const measureNode = (node: HierarchyOrgNode, depth: number): number => {
    maximumDepth = Math.max(maximumDepth, depth);
    const children = expandedIds.has(node.id) ? node.children : [];
    if (children.length === 0) {
      heights.set(node.id, HIERARCHY_NODE_HEIGHT);
      return HIERARCHY_NODE_HEIGHT;
    }
    const childrenHeight =
      children.reduce(
        (height, child) => height + measureNode(child, depth + 1),
        0,
      ) +
      HIERARCHY_ROW_GAP * (children.length - 1);
    const height = Math.max(HIERARCHY_NODE_HEIGHT, childrenHeight);
    heights.set(node.id, height);
    return height;
  };

  const treeHeight = measureNode(root, 0);
  const nodes: HierarchyOrgPositionedNode[] = [];
  const connectors: HierarchyOrgConnector[] = [];

  const placeNode = (
    node: HierarchyOrgNode,
    depth: number,
    top: number,
    parent?: HierarchyOrgPositionedNode,
  ) => {
    const height = heights.get(node.id) ?? HIERARCHY_NODE_HEIGHT;
    const positionedNode = {
      node,
      x:
        HIERARCHY_LAYOUT_PADDING +
        HIERARCHY_NODE_WIDTH / 2 +
        depth * (HIERARCHY_NODE_WIDTH + HIERARCHY_LEVEL_GAP),
      y: HIERARCHY_LAYOUT_PADDING + top + height / 2,
    };
    nodes.push(positionedNode);

    if (parent) {
      connectors.push({
        id: `${parent.node.id}:${node.id}`,
        sourceX: parent.x + HIERARCHY_NODE_WIDTH / 2,
        sourceY: parent.y,
        targetX: positionedNode.x - HIERARCHY_NODE_WIDTH / 2,
        targetY: positionedNode.y,
        color: node.color,
      });
    }

    const children = expandedIds.has(node.id) ? node.children : [];
    let childTop = top;
    for (const child of children) {
      placeNode(child, depth + 1, childTop, positionedNode);
      childTop +=
        (heights.get(child.id) ?? HIERARCHY_NODE_HEIGHT) + HIERARCHY_ROW_GAP;
    }
  };

  placeNode(root, 0, 0);
  return {
    width:
      HIERARCHY_LAYOUT_PADDING * 2 +
      HIERARCHY_NODE_WIDTH +
      maximumDepth * (HIERARCHY_NODE_WIDTH + HIERARCHY_LEVEL_GAP),
    height: treeHeight + HIERARCHY_LAYOUT_PADDING * 2,
    nodes,
    connectors,
  };
}

function getHierarchyKindLabel(kind: HierarchyOrgNodeKind) {
  if (kind === "root") return "You";
  if (kind === "category") return "Group";
  if (kind === "company") return "Organization";
  if (kind === "department") return "Department";
  if (kind === "group") return "Contact group";
  return "Person";
}

function truncateHierarchyLabel(label: string, maximumLength: number) {
  return label.length > maximumLength
    ? `${label.slice(0, maximumLength - 1)}…`
    : label;
}

function toggleSetValue<T>(current: Set<T>, value: T) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
