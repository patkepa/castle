import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { Icon } from "@patkepa/kantzen-ui/primitives";
import { InspectorWorkspace, SearchField } from "@patkepa/kantzen-ui";
import type {
  CalendarEvent,
  GraphEdge,
  GraphGroupingMode,
  GraphNode,
  Note,
  RelationshipGraphData,
} from "../../types";
import {
  ForceGraphCanvas,
  type ForceGraphHandle,
} from "@patkepa/kantzen-ui/graph";
import {
  createConnectionsMap,
  createRelationshipVisibility,
  filterRelationshipPeople,
  findRelationshipSearchMatches,
} from "./relationshipSelectors";
import {
  createRelationshipWorkspaceState,
  relationshipWorkspaceReducer,
  shouldClearSelectionWhenHidingConnections,
  type PeopleBrowserView,
  type RelationshipWorkspaceMode,
} from "./relationshipWorkspace";
import {
  useGeneratedResource,
  validateRelationshipGraph,
} from "../../lib/generatedData";
import {
  getRelationshipCenterWeight,
  getRelationshipEdgeDistanceMultiplier,
  getRelationshipEdgeStyle,
  getRelationshipFitPadding,
  getRelationshipInitialPosition,
  getRelationshipLabelStyle,
  getRelationshipNodeRadius,
  getRelationshipNodeStyle,
  isRelationshipLabelVisible,
  RELATIONSHIP_GRAPH_DISPLAY,
  RELATIONSHIP_GRAPH_FORCES,
} from "./relationshipGraphPresentation";
import {
  GraphControls,
  GraphInspector,
  GraphSearchBar,
  GraphStatusBar,
  GraphToolStrip,
} from "./RelationshipGraphChrome";
import {
  PeopleList,
  PeopleTree,
} from "./RelationshipPeopleBrowser";
import { PersonDetailPanel } from "./PersonDetailPanel";
import { RelationshipHierarchyView } from "./RelationshipHierarchyView";
import { TopbarTabs, type TopbarTab } from "../../components/TopbarTabs";
import { useRelationshipPageKeyboardNavigation } from "./relationship_page_keyboard_navigation";
import { useCastleContextMenu } from "../context_menu/CastleContextMenu";
import { createGraphNodeContextMenu } from "../context_menu/context_menu_models";

interface RelationshipGraphProps {
  graph: RelationshipGraphData;
  notes: Note[];
  events: CalendarEvent[];
  onGraphRefresh: () => void;
}

interface RelationshipGraphPageProps {
  notes: Note[];
  events: CalendarEvent[];
}

const EMPTY_CONNECTIONS = new Set<string>();
const LazyRelationshipMapView = lazy(() =>
  import("../../components/map/RelationshipMapView").then((module) => ({
    default: module.RelationshipMapView,
  })),
);
const relationshipWorkspaceTabs = [
  { id: "split", label: "Split view" },
  { id: "hierarchy", label: "Hierarchy view" },
  { id: "graph", label: "Graph view" },
  { id: "map", label: "Map" },
] as const satisfies readonly TopbarTab<RelationshipWorkspaceMode>[];

export function RelationshipGraphPage({
  notes,
  events,
}: RelationshipGraphPageProps) {
  const { data: latestGraph, error, reload } = useGeneratedResource(
    "/generated/relationship-graph.json",
    validateRelationshipGraph,
    "Relationship graph",
  );
  const displayedGraph = useRef<RelationshipGraphData | null>(null);
  if (latestGraph) displayedGraph.current = latestGraph;
  const graph = latestGraph ?? displayedGraph.current;

  if (error && !graph) {
    return (
      <div className="graph-load-state graph-load-state--error" role="alert">
        <Icon icon="warning-sign" size={28} />
        <h1>Graph unavailable</h1>
        <p>The relationship graph could not be loaded.</p>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="graph-load-state" role="status">
        <Icon icon="graph" size={28} />
        <h1>Building the relationship view…</h1>
      </div>
    );
  }

  return (
    <RelationshipGraph
      graph={graph}
      notes={notes}
      events={events}
      onGraphRefresh={reload}
    />
  );
}

export function RelationshipGraph({
  graph: relationshipGraph,
  notes,
  events,
  onGraphRefresh,
}: RelationshipGraphProps) {
  const { openMenu } = useCastleContextMenu();
  const [workspace, dispatch] = useReducer(
    relationshipWorkspaceReducer,
    relationshipGraph,
    createRelationshipWorkspaceState,
  );
  const {
    groupingMode,
    workspaceMode,
    leftView,
    query,
    activeCategories,
    selectedNodeId,
    hoveredNodeId,
    controlsOpen,
    simulationRunning,
    showConnections,
    showDepartments,
    showPersonRelations,
    showNoteLinks,
  } = workspace;
  const graph = useMemo(
    () => ({
      ...relationshipGraph,
      ...relationshipGraph.views[groupingMode],
    }),
    [groupingMode, relationshipGraph],
  );
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const graphCanvasRef = useRef<ForceGraphHandle | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const personEditorState = useRef({
    active: false,
    dirty: false,
    saving: false,
  });
  const canLeavePersonEditor = useCallback(() => {
    if (personEditorState.current.saving) return false;
    return (
      !personEditorState.current.dirty ||
      window.confirm("Discard the unsaved changes to this person?")
    );
  }, []);
  const handlePersonEditorStateChange = useCallback(
    (state: { active: boolean; dirty: boolean; saving: boolean }) => {
      personEditorState.current = state;
    },
    [],
  );
  const getInitialPosition = useCallback(
    (node: GraphNode) =>
      getRelationshipInitialPosition(node, graph.centerX, graph.centerY),
    [graph.centerX, graph.centerY],
  );

  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const connectedByNode = useMemo(
    () => createConnectionsMap(graph.edges),
    [graph.edges],
  );
  const notesByRoute = useMemo(
    () => new Map(notes.map((note) => [note.route, note])),
    [notes],
  );
  const people = useMemo(
    () =>
      graph.nodes
        .filter((node) => node.type === "person")
        .sort((left, right) => left.label.localeCompare(right.label)),
    [graph.nodes],
  );
  const { visibleEdges, canvasVisibleNodeIds } = useMemo(
    () =>
      createRelationshipVisibility({
        graph,
        activeCategories,
        showConnections,
        showDepartments,
        showPersonRelations,
        showNoteLinks,
      }),
    [
      activeCategories,
      graph,
      showConnections,
      showDepartments,
      showNoteLinks,
      showPersonRelations,
    ],
  );
  const searchMatches = useMemo(
    () =>
      findRelationshipSearchMatches(
        graph.nodes,
        canvasVisibleNodeIds,
        deferredQuery,
      ),
    [canvasVisibleNodeIds, deferredQuery, graph.nodes],
  );
  const filteredPeople = useMemo(
    () => filterRelationshipPeople(people, activeCategories, deferredQuery),
    [activeCategories, deferredQuery, people],
  );

  const handleGroupingModeChange = useCallback((mode: GraphGroupingMode) => {
    const nextGraph = relationshipGraph.views[mode];
    dispatch({
      type: "set-grouping",
      mode,
      categoryIds: nextGraph.categories.map((category) => category.id),
    });
    graphCanvasRef.current?.reheat();
  }, [relationshipGraph.views]);
  const handleWorkspaceModeChange = useCallback(
    (mode: RelationshipWorkspaceMode) => {
      if (mode !== workspaceMode && !canLeavePersonEditor()) return;
      dispatch({
        type: "set-workspace-mode",
        mode,
        knownFromCategoryIds: relationshipGraph.views.known_from.categories.map(
          (category) => category.id,
        ),
      });
      if (mode === "split") graphCanvasRef.current?.reheat();
    },
    [
      canLeavePersonEditor,
      relationshipGraph.views.known_from.categories,
      workspaceMode,
    ],
  );
  const handleLeftViewChange = useCallback(
    (view: PeopleBrowserView) => {
      dispatch({
        type: "set-left-view",
        view,
        knownFromCategoryIds: relationshipGraph.views.known_from.categories.map(
          (category) => category.id,
        ),
      });
      if (view !== "graph") graphCanvasRef.current?.reheat();
    },
    [relationshipGraph.views.known_from.categories],
  );
  const handleQueryChange = useCallback(
    (nextQuery: string) => dispatch({ type: "set-query", query: nextQuery }),
    [],
  );
  const handleSelectNode = useCallback(
    (nodeId: string | null) => {
      if (nodeId !== selectedNodeId && !canLeavePersonEditor()) return;
      dispatch({ type: "select-node", nodeId });
    },
    [canLeavePersonEditor, selectedNodeId],
  );
  const handleContextNode = useCallback(
    (node: GraphNode, point: { left: number; top: number }) => {
      handleSelectNode(node.id);
      openMenu(
        createGraphNodeContextMenu(node, () => {
          handleSelectNode(node.id);
          graphCanvasRef.current?.focusNode(node.id);
        }),
        point,
      );
    },
    [handleSelectNode, openMenu],
  );
  const handleHoverNode = useCallback(
    (nodeId: string | null) => dispatch({ type: "hover-node", nodeId }),
    [],
  );
  const handleCategoryChange = useCallback(
    (categoryId: string) => {
      dispatch({
        type: "select-category",
        categoryIds:
          categoryId === "all"
            ? graph.categories.map((category) => category.id)
            : [categoryId],
      });
      graphCanvasRef.current?.reheat();
    },
    [graph.categories],
  );
  const toggleSimulation = useCallback(
    () => dispatch({ type: "toggle-simulation" }),
    [],
  );
  const clearRelationshipSelection = useCallback(
    () => {
      if (personEditorState.current.active || !canLeavePersonEditor()) return;
      dispatch({ type: "escape" });
    },
    [canLeavePersonEditor],
  );
  useRelationshipPageKeyboardNavigation({
    graphCanvasRef,
    graphVisible: workspaceMode === "graph" || leftView === "graph",
    onEscape: clearRelationshipSelection,
    onToggleSimulation: toggleSimulation,
    searchInputRef: searchRef,
  });

  const selectedNode = selectedNodeId
    ? nodesById.get(selectedNodeId) ?? null
    : null;

  const handleSearchSubmit = () => {
    const firstMatch = searchMatches.values().next().value as
      | string
      | undefined;
    if (!firstMatch) return;
    handleSelectNode(firstMatch);
    graphCanvasRef.current?.focusNode(firstMatch);
  };

  const toggleAllCategories = () => {
    dispatch({
      type: "toggle-all-categories",
      categoryIds: graph.categories.map((category) => category.id),
    });
    graphCanvasRef.current?.reheat();
  };

  if (workspaceMode === "split") {
    return (
      <>
        <TopbarTabs
          ariaLabel="Relationship workspace view"
          onSelect={handleWorkspaceModeChange}
          selectedId={workspaceMode}
          tabs={relationshipWorkspaceTabs}
        />
        <RelationshipSplitView
          graph={graph}
          notes={notes}
          groupingMode={groupingMode}
          onGroupingModeChange={handleGroupingModeChange}
          nodesById={nodesById}
          notesByRoute={notesByRoute}
          events={events}
          people={filteredPeople}
          query={query}
          onQueryChange={handleQueryChange}
          inputRef={searchRef}
          activeCategories={activeCategories}
          onCategoryChange={handleCategoryChange}
          leftView={leftView}
          onLeftViewChange={handleLeftViewChange}
          selectedNode={selectedNode}
          onSelectNode={handleSelectNode}
          onContextNode={handleContextNode}
          connections={
            selectedNode
              ? connectedByNode.get(selectedNode.id) ?? EMPTY_CONNECTIONS
              : EMPTY_CONNECTIONS
          }
          visibleNodeIds={canvasVisibleNodeIds}
          visibleEdges={visibleEdges}
          searchMatches={searchMatches}
          hoveredNodeId={hoveredNodeId}
          onHoverNode={handleHoverNode}
          simulationRunning={simulationRunning}
          graphCanvasRef={graphCanvasRef}
          getInitialPosition={getInitialPosition}
          onToggleSimulation={toggleSimulation}
          onPersonSaved={onGraphRefresh}
          onEditorStateChange={handlePersonEditorStateChange}
        />
      </>
    );
  }

  if (workspaceMode === "hierarchy") {
    return (
      <>
        <TopbarTabs
          ariaLabel="Relationship workspace view"
          onSelect={handleWorkspaceModeChange}
          selectedId={workspaceMode}
          tabs={relationshipWorkspaceTabs}
        />
        <RelationshipHierarchyView
          graph={graph}
          groupingMode={groupingMode}
          onGroupingModeChange={handleGroupingModeChange}
          people={filteredPeople}
          query={query}
          onQueryChange={handleQueryChange}
          inputRef={searchRef}
          activeCategories={activeCategories}
          onCategoryChange={handleCategoryChange}
          selectedNode={selectedNode}
          onSelectNode={handleSelectNode}
        />
      </>
    );
  }

  if (workspaceMode === "map") {
    return (
      <>
        <TopbarTabs
          ariaLabel="Relationship workspace view"
          onSelect={handleWorkspaceModeChange}
          selectedId={workspaceMode}
          tabs={relationshipWorkspaceTabs}
        />
        <main className="graph-page relationship-map-page">
          <Suspense
            fallback={
              <div className="graph-load-state" role="status">
                <Icon icon="map" size={28} />
                <h1>Opening the map…</h1>
              </div>
            }
          >
            <LazyRelationshipMapView people={people} />
          </Suspense>
        </main>
      </>
    );
  }

  return (
    <>
      <TopbarTabs
        ariaLabel="Relationship workspace view"
        onSelect={handleWorkspaceModeChange}
        selectedId={workspaceMode}
        tabs={relationshipWorkspaceTabs}
      />
      <main className="graph-page">
        <section className="graph-stage" aria-label="Relationship graph workspace">
          <ForceGraphCanvas
            ref={graphCanvasRef}
            nodes={graph.nodes}
            edges={visibleEdges}
            visibleNodeIds={canvasVisibleNodeIds}
            selectedNodeId={selectedNodeId}
            hoveredNodeId={hoveredNodeId}
            searchMatches={searchMatches}
            forces={RELATIONSHIP_GRAPH_FORCES}
            display={RELATIONSHIP_GRAPH_DISPLAY}
            running={simulationRunning}
            className="graph-canvas"
            ariaLabel="Interactive force-directed relationship graph. Tap a node to inspect it, drag nodes to pin them, drag the background to pan, and pinch or use the mouse wheel to zoom."
            getFitPadding={(size) =>
              getRelationshipFitPadding(
                size,
                controlsOpen,
                Boolean(selectedNode),
              )
            }
            getInitialPosition={getInitialPosition}
            getCenterWeight={getRelationshipCenterWeight}
            getEdgeDistanceMultiplier={getRelationshipEdgeDistanceMultiplier}
            getNodeRadius={getRelationshipNodeRadius}
            getNodeStyle={getRelationshipNodeStyle}
            getNodeImageUrl={(node) => node.avatarUrl}
            getEdgeStyle={getRelationshipEdgeStyle}
            getLabelStyle={getRelationshipLabelStyle}
            isLabelVisible={isRelationshipLabelVisible}
            onSelectNode={handleSelectNode}
            onHoverNode={handleHoverNode}
            onContextNode={handleContextNode}
          />

          <GraphSearchBar
            query={query}
            matchCount={searchMatches.size}
            inputRef={searchRef}
            onQueryChange={handleQueryChange}
            onSubmit={handleSearchSubmit}
            controlsOpen={controlsOpen}
            onToggleControls={() => dispatch({ type: "toggle-controls" })}
          />

          {controlsOpen ? (
            <GraphControls
              graph={graph}
              groupingMode={groupingMode}
              onGroupingModeChange={handleGroupingModeChange}
              activeCategories={activeCategories}
              onToggleCategory={(categoryId) => {
                dispatch({ type: "toggle-category", categoryId });
                graphCanvasRef.current?.reheat();
              }}
              onToggleAllCategories={toggleAllCategories}
              showConnections={showConnections}
              onToggleConnections={() => {
                dispatch({
                  type: "toggle-connections",
                  clearSelection:
                    showConnections &&
                    shouldClearSelectionWhenHidingConnections(selectedNode),
                });
                graphCanvasRef.current?.reheat();
              }}
              showDepartments={showDepartments}
              onToggleDepartments={() => {
                dispatch({
                  type: "toggle-departments",
                  clearSelection:
                    showDepartments && selectedNode?.type === "department",
                });
                graphCanvasRef.current?.reheat();
              }}
              showPersonRelations={showPersonRelations}
              onTogglePersonRelations={() => {
                dispatch({ type: "toggle-person-relations" });
                graphCanvasRef.current?.reheat();
              }}
              showNoteLinks={showNoteLinks}
              onToggleNoteLinks={() => {
                dispatch({ type: "toggle-note-links" });
                graphCanvasRef.current?.reheat();
              }}
            />
          ) : null}

          {selectedNode ? (
            <GraphInspector
              graph={graph}
              node={selectedNode}
              connections={
                connectedByNode.get(selectedNode.id) ?? EMPTY_CONNECTIONS
              }
              onClose={() => handleSelectNode(null)}
            />
          ) : null}

          <GraphToolStrip
            running={simulationRunning}
            onZoomIn={() => graphCanvasRef.current?.zoomBy(1.2)}
            onZoomOut={() => graphCanvasRef.current?.zoomBy(0.84)}
            onFit={() => graphCanvasRef.current?.fit()}
            onToggleSimulation={toggleSimulation}
          />

          <GraphStatusBar
            visibleNodeCount={canvasVisibleNodeIds.size}
            visibleEdgeCount={visibleEdges.length}
            simulationRunning={simulationRunning}
          />
        </section>
      </main>
    </>
  );
}

function RelationshipSplitView({
  graph,
  notes,
  groupingMode,
  onGroupingModeChange,
  nodesById,
  notesByRoute,
  events,
  people,
  query,
  onQueryChange,
  inputRef,
  activeCategories,
  onCategoryChange,
  leftView,
  onLeftViewChange,
  selectedNode,
  onSelectNode,
  onContextNode,
  connections,
  visibleNodeIds,
  visibleEdges,
  searchMatches,
  hoveredNodeId,
  onHoverNode,
  simulationRunning,
  graphCanvasRef,
  getInitialPosition,
  onToggleSimulation,
  onPersonSaved,
  onEditorStateChange,
}: {
  graph: RelationshipGraphData;
  notes: Note[];
  groupingMode: GraphGroupingMode;
  onGroupingModeChange: (mode: GraphGroupingMode) => void;
  nodesById: Map<string, GraphNode>;
  notesByRoute: Map<string, Note>;
  events: CalendarEvent[];
  people: GraphNode[];
  query: string;
  onQueryChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  activeCategories: Set<string>;
  onCategoryChange: (categoryId: string) => void;
  leftView: PeopleBrowserView;
  onLeftViewChange: (view: PeopleBrowserView) => void;
  selectedNode: GraphNode | null;
  onSelectNode: (nodeId: string | null) => void;
  onContextNode: (
    node: GraphNode,
    point: { left: number; top: number },
  ) => void;
  connections: Set<string>;
  visibleNodeIds: Set<string>;
  visibleEdges: GraphEdge[];
  searchMatches: Set<string>;
  hoveredNodeId: string | null;
  onHoverNode: (nodeId: string | null) => void;
  simulationRunning: boolean;
  graphCanvasRef: React.RefObject<ForceGraphHandle | null>;
  getInitialPosition: (node: GraphNode) => { x: number; y: number };
  onToggleSimulation: () => void;
  onPersonSaved: () => void;
  onEditorStateChange: (state: {
    active: boolean;
    dirty: boolean;
    saving: boolean;
  }) => void;
}) {
  const categorySelection =
    activeCategories.size === graph.categories.length
      ? "all"
      : activeCategories.size === 1
        ? (activeCategories.values().next().value ?? "all")
        : "custom";

  return (
    <main className="graph-page relationship-page">
      <InspectorWorkspace
        className="relationship-split-stage"
        ariaLabel="Relationships workspace"
      >
        <aside className="people-browser" aria-label="People browser">
          <header className="people-browser-header">
            <h1>People</h1>
            <div
              className="relationship-view-switcher"
              aria-label="People browser view"
            >
              <button
                type="button"
                className={leftView === "list" ? "is-active" : ""}
                aria-pressed={leftView === "list"}
                onClick={() => onLeftViewChange("list")}
              >
                <Icon icon="list" size={13} />
                List
              </button>
              <button
                type="button"
                className={leftView === "tree" ? "is-active" : ""}
                aria-pressed={leftView === "tree"}
                onClick={() => onLeftViewChange("tree")}
              >
                <Icon icon="diagram-tree" size={13} />
                Tree
              </button>
              <button
                type="button"
                className={leftView === "graph" ? "is-active" : ""}
                aria-pressed={leftView === "graph"}
                onClick={() => onLeftViewChange("graph")}
              >
                <Icon icon="graph" size={13} />
                Graph
              </button>
            </div>
          </header>

          <div className="people-browser-filters">
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
            {leftView === "graph" ? (
              <div
                className="relationship-grouping-switcher"
                aria-label="Group people by"
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
            ) : null}
          </div>

          <div className="people-browser-result-count" aria-live="polite">
            {people.length} {people.length === 1 ? "person" : "people"}
          </div>

          {leftView === "list" ? (
            <PeopleList
              people={people}
              selectedNodeId={selectedNode?.id ?? null}
              onSelectNode={onSelectNode}
            />
          ) : leftView === "tree" ? (
            <PeopleTree
              graph={graph}
              people={people}
              activeCategories={activeCategories}
              queryActive={Boolean(query.trim())}
              selectedNodeId={selectedNode?.id ?? null}
              onSelectNode={onSelectNode}
            />
          ) : (
            <div className="relationship-compact-graph">
              <ForceGraphCanvas
                ref={graphCanvasRef}
                nodes={graph.nodes}
                edges={visibleEdges}
                visibleNodeIds={visibleNodeIds}
                selectedNodeId={selectedNode?.id ?? null}
                hoveredNodeId={hoveredNodeId}
                searchMatches={searchMatches}
                forces={RELATIONSHIP_GRAPH_FORCES}
                display={RELATIONSHIP_GRAPH_DISPLAY}
                running={simulationRunning}
                className="graph-canvas"
                ariaLabel="Compact relationship graph. Select a person to inspect their profile."
                getFitPadding={() => ({
                  top: 54,
                  right: 38,
                  bottom: 54,
                  left: 38,
                })}
                getInitialPosition={getInitialPosition}
                getCenterWeight={getRelationshipCenterWeight}
                getEdgeDistanceMultiplier={
                  getRelationshipEdgeDistanceMultiplier
                }
                getNodeRadius={getRelationshipNodeRadius}
                getNodeStyle={getRelationshipNodeStyle}
                getNodeImageUrl={(node) => node.avatarUrl}
                getEdgeStyle={getRelationshipEdgeStyle}
                getLabelStyle={getRelationshipLabelStyle}
                isLabelVisible={isRelationshipLabelVisible}
                onSelectNode={(nodeId) => {
                  if (!nodeId || nodesById.get(nodeId)?.type === "person") {
                    onSelectNode(nodeId);
                  }
                }}
                onHoverNode={onHoverNode}
                onContextNode={onContextNode}
              />
              <GraphToolStrip
                running={simulationRunning}
                onZoomIn={() => graphCanvasRef.current?.zoomBy(1.2)}
                onZoomOut={() => graphCanvasRef.current?.zoomBy(0.84)}
                onFit={() => graphCanvasRef.current?.fit()}
                onToggleSimulation={onToggleSimulation}
              />
            </div>
          )}
        </aside>

        <PersonDetailPanel
          graph={graph}
          notes={notes}
          node={selectedNode}
          note={
            selectedNode?.href ? notesByRoute.get(selectedNode.href) : undefined
          }
          nodesById={nodesById}
          connections={connections}
          events={events}
          onSelectNode={onSelectNode}
          onPersonSaved={onPersonSaved}
          onEditorStateChange={onEditorStateChange}
        />
      </InspectorWorkspace>

      <footer
        className="relationship-workspace-status"
        aria-label="Workspace status"
      >
        <span className="graph-status-live">
          <i
            className={simulationRunning ? "is-running" : ""}
            aria-hidden="true"
          />
          <span>
            {leftView === "graph"
              ? "Graph ready"
              : leftView === "tree"
                ? "Tree ready"
                : "Directory ready"}
          </span>
        </span>
        <span>
          People <strong className="mono-data">{graph.peopleCount}</strong>
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
