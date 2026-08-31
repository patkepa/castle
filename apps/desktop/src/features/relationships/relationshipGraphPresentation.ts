import type { GraphEdge, GraphNode } from "../../types";
import type {
  ForceGraphCanvasSize,
  ForceGraphDisplay,
  ForceGraphEdgeState,
  ForceGraphForces,
  ForceGraphLabelStyle,
  ForceGraphNodeState,
  ForceGraphNodeStyle,
} from "@patkepa/kantzen-ui/graph";

export const ROOT_NODE_ID = "root:owner";
export const RELATIONSHIP_GRAPH_FORCES: ForceGraphForces = {
  center: 0.22,
  repel: 180,
  link: 0.9,
  distance: 180,
};
export const RELATIONSHIP_GRAPH_DISPLAY: ForceGraphDisplay = {
  arrows: false,
  labels: true,
  nodeSize: 1,
};

export function getRelationshipInitialPosition(
  node: GraphNode,
  centerX: number,
  centerY: number,
) {
  if (node.id === ROOT_NODE_ID) return { x: 0, y: 0 };
  const hash = hashString(node.id);
  return {
    x: (node.x - centerX) * 0.78 + ((hash % 17) - 8) * 1.6,
    y: (node.y - centerY) * 0.86 + (((hash >> 4) % 17) - 8) * 1.6,
  };
}

export function getRelationshipFitPadding(
  { width }: ForceGraphCanvasSize,
  controlsOpen: boolean,
  inspectorOpen: boolean,
) {
  return {
    left: controlsOpen && width > 760 ? 284 : 48,
    right: inspectorOpen && width > 900 ? 294 : 48,
    top: width > 760 ? 92 : 80,
    bottom: 66,
  };
}

export function getRelationshipCenterWeight(node: GraphNode) {
  return node.type === "root" ? 4.8 : 1;
}

export function getRelationshipEdgeDistanceMultiplier(edge: GraphEdge) {
  return edge.type === "category"
    ? 1.22
    : edge.type === "company"
      ? 0.96
      : edge.type === "department"
        ? 0.82
        : edge.type === "person-relation"
          ? 1.35
          : edge.type === "note-link"
            ? 1.55
            : 0.88;
}

export function getRelationshipNodeRadius(node: GraphNode) {
  return node.type === "root"
    ? 22
    : node.type === "category"
      ? 13
      : node.type === "company"
        ? 9
        : node.type === "department"
          ? 7
          : 5.2;
}

export function getRelationshipNodeStyle(
  node: GraphNode,
  state: ForceGraphNodeState,
): ForceGraphNodeStyle {
  if (node.type === "root") {
    return {
      fill: "#000000",
      stroke: state.focused ? "#60a5fa" : "#3b82f6",
      strokeWidth: 1.6,
      shape: "square",
    };
  }
  if (node.type === "category") {
    return {
      fill: mixColor(node.color, "#171717", 0.14),
      stroke: node.color,
      strokeWidth: 1.35,
      shape: "square",
    };
  }
  if (node.type === "company") {
    return {
      fill: mixColor(node.color, "#171717", 0.24),
      stroke: lightenColor(node.color, 0.12),
      strokeWidth: 1.1,
      shape: "square",
    };
  }
  if (node.type === "department") {
    return {
      fill: mixColor(node.color, "#171717", 0.38),
      stroke: lightenColor(node.color, 0.2),
      strokeWidth: 1,
      shape: "square",
    };
  }
  return {
    fill: mixColor(node.color, "#171717", 0.62),
    stroke: state.faded ? node.color : lightenColor(node.color, 0.2),
    strokeWidth: 1.05,
  };
}

export function getRelationshipEdgeStyle(
  edge: GraphEdge,
  state: ForceGraphEdgeState,
) {
  return {
    stroke:
      edge.type === "person-relation"
        ? state.focused
          ? "rgba(178, 188, 201, 0.82)"
          : state.searched
            ? "rgba(178, 188, 201, 0.62)"
            : state.faded
              ? "rgba(178, 188, 201, 0.08)"
              : "rgba(178, 188, 201, 0.42)"
        : state.focused
          ? edge.color ?? "rgba(96, 165, 250, 0.84)"
          : state.searched
            ? "rgba(59, 130, 246, 0.58)"
            : edge.type === "note-link"
              ? "rgba(178, 188, 201, 0.34)"
              : state.faded
                ? "rgba(196, 204, 214, 0.05)"
                : edge.type === "category"
                  ? "rgba(200, 210, 222, 0.32)"
                  : edge.type === "company"
                    ? "rgba(200, 210, 222, 0.25)"
                    : edge.type === "department"
                      ? "rgba(200, 210, 222, 0.21)"
                      : "rgba(200, 210, 222, 0.18)",
    width: state.focused
      ? 1.55
      : edge.type === "person-relation"
        ? 1.3
        : edge.type === "category"
          ? 1.1
          : edge.type === "company"
            ? 0.95
            : edge.type === "department"
              ? 0.85
              : 0.75,
    dash:
      edge.type === "note-link" || edge.type === "person-relation"
        ? [4, 5]
        : undefined,
  };
}

export function getRelationshipLabelStyle(
  node: GraphNode,
  state: ForceGraphNodeState,
): ForceGraphLabelStyle {
  return {
    color: node.type === "root" ? "#ffffff" : "#e7eaee",
    fontSize:
      node.type === "root"
        ? 14
        : node.type === "category"
          ? 11.5
          : node.type === "company"
            ? 10.5
            : node.type === "department"
              ? 10
              : 9.5,
    fontWeight: node.type === "person" ? 500 : 600,
    opacity: state.faded
      ? 0.12
      : state.focused || state.connected || state.searched
        ? 1
        : 0.72,
  };
}

export function isRelationshipLabelVisible(
  node: GraphNode,
  state: ForceGraphNodeState,
) {
  const alwaysLabel = node.type !== "person";
  const compactCategory =
    (node.type === "category" ||
      node.type === "company" ||
      node.type === "department") &&
    state.scale < 0.4 &&
    !state.focused &&
    !state.connected &&
    !state.searched;
  if (compactCategory) return false;
  return (
    alwaysLabel ||
    state.scale >= 0.68 ||
    state.focused ||
    state.connected ||
    state.searched
  );
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function mixColor(color: string, background: string, amount: number) {
  const foregroundRgb = hexToRgb(color);
  const backgroundRgb = hexToRgb(background);
  if (!foregroundRgb || !backgroundRgb) return color;
  const mix = (foreground: number, backdrop: number) =>
    Math.round(foreground * amount + backdrop * (1 - amount));
  return `rgb(${mix(foregroundRgb.r, backgroundRgb.r)}, ${mix(foregroundRgb.g, backgroundRgb.g)}, ${mix(foregroundRgb.b, backgroundRgb.b)})`;
}

function lightenColor(color: string, amount: number) {
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  const lighten = (channel: number) =>
    Math.round(channel + (255 - channel) * amount);
  return `rgb(${lighten(rgb.r)}, ${lighten(rgb.g)}, ${lighten(rgb.b)})`;
}

function hexToRgb(color: string) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (!match) return null;
  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16),
  };
}
