import { type CSSProperties } from "react";
import { Icon, type IconName } from "@patkepa/kantzen-ui/primitives";
import { SearchField } from "@patkepa/kantzen-ui";
import { Link } from "react-router-dom";
import type {
  GraphGroupingMode,
  GraphNode,
  RelationshipGraphData,
} from "../../types";
import { shortcutDisplayText } from "../../keyboard/shortcut_catalog";

export function GraphSearchBar({
  query,
  matchCount,
  inputRef,
  onQueryChange,
  onSubmit,
  controlsOpen,
  onToggleControls,
}: {
  query: string;
  matchCount: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  controlsOpen: boolean;
  onToggleControls: () => void;
}) {
  return (
    <div className="graph-floating-toolbar">
      <form
        className="graph-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <SearchField
          className="graph-search-field"
          inputRef={inputRef}
          value={query}
          placeholder="Search people"
          onChange={onQueryChange}
        />
        {query ? (
          <span className="graph-search-count">
            {matchCount} {matchCount === 1 ? "match" : "matches"}
          </span>
        ) : (
          <kbd>{shortcutDisplayText("relationshipSearch")}</kbd>
        )}
      </form>
      <button
        type="button"
        className={["graph-toolbar-filter", controlsOpen && "is-active"]
          .filter(Boolean)
          .join(" ")}
        aria-label={
          controlsOpen
            ? "Close people category filters"
            : "Open people category filters"
        }
        aria-expanded={controlsOpen}
        onClick={onToggleControls}
      >
        <Icon icon="filter-list" size={15} />
      </button>
    </div>
  );
}

export function GraphControls({
  graph,
  groupingMode,
  onGroupingModeChange,
  activeCategories,
  onToggleCategory,
  onToggleAllCategories,
  showConnections,
  onToggleConnections,
  showDepartments,
  onToggleDepartments,
  showPersonRelations,
  onTogglePersonRelations,
  showNoteLinks,
  onToggleNoteLinks,
}: {
  graph: RelationshipGraphData;
  groupingMode: GraphGroupingMode;
  onGroupingModeChange: (mode: GraphGroupingMode) => void;
  activeCategories: Set<string>;
  onToggleCategory: (categoryId: string) => void;
  onToggleAllCategories: () => void;
  showConnections: boolean;
  onToggleConnections: () => void;
  showDepartments: boolean;
  onToggleDepartments: () => void;
  showPersonRelations: boolean;
  onTogglePersonRelations: () => void;
  showNoteLinks: boolean;
  onToggleNoteLinks: () => void;
}) {
  const allGroupsVisible = activeCategories.size === graph.categories.length;
  const departmentCount = graph.nodes.filter(
    (node) => node.type === "department",
  ).length;

  return (
    <aside className="graph-control-panel" aria-label="Relationship graph filters">
      <div className="graph-grouping-control">
        <span>Group people by</span>
        <div className="graph-grouping-switcher">
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
      <div className="graph-category-heading">
        <div>
          <span>
            {groupingMode === "relation" ? "Relationship tone" : "Known from"}
          </span>
          <small>Visible groups</small>
        </div>
        <button
          type="button"
          className="graph-section-action"
          onClick={onToggleAllCategories}
        >
          {allGroupsVisible ? "Hide all" : "Show all"}
        </button>
      </div>
      <div className="graph-group-list">
        {graph.categories.map((category) => (
          <label className="graph-group-option" key={category.id}>
            <input
              type="checkbox"
              checked={activeCategories.has(category.id)}
              onChange={() => onToggleCategory(category.id)}
            />
            <span
              className="graph-checkbox"
              style={{ "--group-color": category.color } as CSSProperties}
              aria-hidden="true"
            >
              <Icon icon="tick" size={10} />
            </span>
            <span
              className="graph-group-dot"
              style={{ "--group-color": category.color } as CSSProperties}
              aria-hidden="true"
            />
            <span className="graph-group-label">{category.label}</span>
            <span className="graph-group-count mono-data">{category.count}</span>
          </label>
        ))}
      </div>
      <div className="graph-connection-setting">
        <span>Connections</span>
        <GraphSetting
          checked={showConnections}
          color="#a0aab9"
          count={
            graph.edges.filter(
              (edge) =>
                edge.type !== "note-link" && edge.type !== "person-relation",
            ).length
          }
          label="Show hierarchy"
          onChange={onToggleConnections}
        />
        {departmentCount > 0 ? (
          <GraphSetting
            checked={showDepartments}
            color="#a78bfa"
            count={departmentCount}
            label="Show departments"
            onChange={onToggleDepartments}
          />
        ) : null}
        {graph.personRelationCount > 0 ? (
          <GraphSetting
            checked={showPersonRelations}
            color="#22c55e"
            count={graph.personRelationCount}
            label="Person relations"
            onChange={onTogglePersonRelations}
          />
        ) : null}
        {graph.noteLinkCount > 0 ? (
          <GraphSetting
            checked={showNoteLinks}
            color="#94a3b8"
            count={graph.noteLinkCount}
            label="Show dotted links"
            onChange={onToggleNoteLinks}
          />
        ) : null}
      </div>
    </aside>
  );
}

function GraphSetting({
  checked,
  color,
  count,
  label,
  onChange,
}: {
  checked: boolean;
  color: string;
  count: number;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="graph-group-option">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span
        className="graph-checkbox"
        style={{ "--group-color": color } as CSSProperties}
        aria-hidden="true"
      >
        <Icon icon="tick" size={10} />
      </span>
      <span className="graph-group-label">{label}</span>
      <span className="graph-group-count mono-data">{count}</span>
    </label>
  );
}

export function GraphInspector({
  graph,
  node,
  connections,
  onClose,
}: {
  graph: RelationshipGraphData;
  node: GraphNode;
  connections: Set<string>;
  onClose: () => void;
}) {
  const typeLabel =
    node.type === "person"
      ? "Person"
      : node.type === "category"
        ? "Group"
        : node.type === "company"
          ? "Company"
          : node.type === "department"
            ? "Department"
            : "Graph root";
  const noteLinks = graph.edges.reduce(
    (count, edge) =>
      count +
      Number(
        edge.type === "note-link" &&
          (edge.source === node.id || edge.target === node.id),
      ),
    0,
  );

  return (
    <aside className="graph-inspector" aria-label="Selected node details">
      <div className="graph-inspector-header">
        <span>Details</span>
        <button
          type="button"
          className="graph-inspector-close"
          aria-label="Close selected node details"
          onClick={onClose}
        >
          <Icon icon="cross" size={14} />
        </button>
      </div>
      <div className="graph-inspector-profile">
        <div className="graph-inspector-title">
          <h2>{node.label}</h2>
          <p>
            {node.categoryLabel ||
              (node.type === "root" ? "Relationship graph root" : "Group node")}
          </p>
        </div>
        <div
          className="graph-inspector-avatar"
          style={{ "--node-color": node.color } as CSSProperties}
        >
          {node.avatarUrl ? (
            <img src={node.avatarUrl} alt={`${node.label} avatar`} />
          ) : (
            <Icon icon={getNodeIcon(node)} size={24} />
          )}
        </div>
      </div>
      <div className="graph-inspector-divider" />
      <span className="graph-inspector-kicker">Details</span>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{typeLabel}</dd>
        </div>
        {node.type === "root" ? (
          <div>
            <dt>Groups</dt>
            <dd>{graph.categories.length}</dd>
          </div>
        ) : null}
        <div>
          <dt>Connections</dt>
          <dd>{connections.size}</dd>
        </div>
        <div>
          <dt>Note links</dt>
          <dd>{noteLinks}</dd>
        </div>
        {node.status ? (
          <div>
            <dt>Status</dt>
            <dd>{node.status}</dd>
          </div>
        ) : null}
      </dl>
      {node.href ? (
        <>
          <div className="graph-inspector-divider" />
          <span className="graph-inspector-kicker">Actions</span>
          <Link className="graph-open-note" to={node.href}>
            <Icon icon="document" size={14} />
            <span>Open note</span>
            <Icon icon="arrow-top-right" size={13} />
          </Link>
        </>
      ) : null}
    </aside>
  );
}

function getNodeIcon(node: GraphNode): IconName {
  if (node.type === "person") return "person";
  if (node.type === "company") return "office";
  if (node.type === "department") return "folder-close";
  return "people";
}

export function GraphToolStrip({
  running,
  onZoomIn,
  onZoomOut,
  onFit,
  onToggleSimulation,
}: {
  running: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onToggleSimulation: () => void;
}) {
  const buttons: Array<{
    label: string;
    icon: IconName;
    action: () => void;
    active?: boolean;
  }> = [
    { label: "Zoom in", icon: "plus", action: onZoomIn },
    { label: "Zoom out", icon: "minus", action: onZoomOut },
    { label: "Fit graph", icon: "zoom-to-fit", action: onFit },
    {
      label: running ? "Pause simulation" : "Resume simulation",
      icon: running ? "pause" : "play",
      action: onToggleSimulation,
      active: running,
    },
  ];

  return (
    <div className="graph-tool-strip" aria-label="Graph canvas controls">
      {buttons.map((button) => (
        <button
          type="button"
          key={button.label}
          title={button.label}
          aria-label={button.label}
          aria-pressed={
            button.label.includes("simulation") ? button.active : undefined
          }
          className={button.active ? "is-active" : ""}
          onClick={button.action}
        >
          <Icon icon={button.icon} size={15} />
        </button>
      ))}
    </div>
  );
}

export function GraphStatusBar({
  visibleNodeCount,
  visibleEdgeCount,
  simulationRunning,
}: {
  visibleNodeCount: number;
  visibleEdgeCount: number;
  simulationRunning: boolean;
}) {
  return (
    <footer className="graph-status-bar" aria-label="Graph status">
      <span className="graph-status-live">
        <i className={simulationRunning ? "is-running" : ""} aria-hidden="true" />
        <span>{simulationRunning ? "Layout running" : "Layout paused"}</span>
      </span>
      <span className="graph-status-item">
        Nodes <strong className="mono-data">{visibleNodeCount}</strong>
      </span>
      <span className="graph-status-item">
        Connections <strong className="mono-data">{visibleEdgeCount}</strong>
      </span>
      <span className="graph-status-shortcut">
        Press {shortcutDisplayText("relationshipFitGraph")} to fit
      </span>
      <span className="graph-status-touch-hint">Drag · pinch · tap nodes</span>
    </footer>
  );
}
