export type CanvasColor = "1" | "2" | "3" | "4" | "5" | "6" | `#${string}`;
export type CanvasSide = "top" | "right" | "bottom" | "left";
export type CanvasEnd = "none" | "arrow";

interface CanvasNodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
  [key: string]: unknown;
}

export interface CanvasTextNode extends CanvasNodeBase {
  type: "text";
  text: string;
}

export interface CanvasFileNode extends CanvasNodeBase {
  type: "file";
  file: string;
  subpath?: string;
}

export interface CanvasLinkNode extends CanvasNodeBase {
  type: "link";
  url: string;
}

export interface CanvasGroupNode extends CanvasNodeBase {
  type: "group";
  label?: string;
  background?: string;
  backgroundStyle?: "cover" | "ratio" | "repeat";
}

export type CanvasNode =
  | CanvasTextNode
  | CanvasFileNode
  | CanvasLinkNode
  | CanvasGroupNode;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: CanvasSide;
  fromEnd?: CanvasEnd;
  toNode: string;
  toSide?: CanvasSide;
  toEnd?: CanvasEnd;
  color?: CanvasColor;
  label?: string;
  [key: string]: unknown;
}

export interface JsonCanvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [key: string]: unknown;
}

export const emptyJsonCanvas: JsonCanvas = Object.freeze({
  nodes: [],
  edges: [],
});

const nodeTypes = new Set(["text", "file", "link", "group"]);
const sides = new Set(["top", "right", "bottom", "left"]);
const ends = new Set(["none", "arrow"]);
const backgroundStyles = new Set(["cover", "ratio", "repeat"]);
const presetColors = new Set(["1", "2", "3", "4", "5", "6"]);
const maximumCanvasItems = 10_000;

export function parseJsonCanvas(source: string): JsonCanvas {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("This file is not valid JSON Canvas data.");
  }

  if (!isObject(parsed)) {
    throw new Error("A JSON Canvas file must contain an object.");
  }
  const nodesValue = parsed.nodes ?? [];
  const edgesValue = parsed.edges ?? [];
  if (!Array.isArray(nodesValue) || !Array.isArray(edgesValue)) {
    throw new Error("JSON Canvas nodes and edges must be arrays.");
  }
  if (nodesValue.length + edgesValue.length > maximumCanvasItems) {
    throw new Error("This canvas exceeds Castle's 10,000 item limit.");
  }

  const nodes = nodesValue.map(parseNode);
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`JSON Canvas contains duplicate node ID “${node.id}”.`);
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  const edges = edgesValue.map((edge, index) => {
    const parsedEdge = parseEdge(edge, index);
    if (edgeIds.has(parsedEdge.id)) {
      throw new Error(`JSON Canvas contains duplicate edge ID “${parsedEdge.id}”.`);
    }
    edgeIds.add(parsedEdge.id);
    if (!nodeIds.has(parsedEdge.fromNode) || !nodeIds.has(parsedEdge.toNode)) {
      throw new Error(`Edge “${parsedEdge.id}” references a missing node.`);
    }
    return parsedEdge;
  });

  return { ...parsed, nodes, edges };
}

export function serializeJsonCanvas(canvas: JsonCanvas) {
  return `${JSON.stringify(canvas, null, 2)}\n`;
}

export function createCanvasId(prefix: "node" | "edge" = "node") {
  const randomId = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  if (randomId) return `${prefix}-${randomId.slice(0, 16)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function canvasFileName(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return `${normalized || "untitled_canvas"}.canvas`;
}

export function normalizeCanvasUrl(value: string) {
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function parseNode(value: unknown, index: number): CanvasNode {
  if (!isObject(value)) throw invalidNode(index);
  const { id, type, x, y, width, height, color } = value;
  if (
    !isIdentifier(id) ||
    typeof type !== "string" ||
    !nodeTypes.has(type) ||
    !isInteger(x) ||
    !isInteger(y) ||
    !isPositiveInteger(width) ||
    !isPositiveInteger(height) ||
    !isCanvasColor(color)
  ) {
    throw invalidNode(index);
  }

  if (type === "text" && typeof value.text === "string") {
    return value as CanvasTextNode;
  }
  if (
    type === "file" &&
    typeof value.file === "string" &&
    value.file.length > 0 &&
    (value.subpath === undefined ||
      (typeof value.subpath === "string" && value.subpath.startsWith("#")))
  ) {
    return value as CanvasFileNode;
  }
  if (type === "link" && typeof value.url === "string" && value.url.length > 0) {
    return value as CanvasLinkNode;
  }
  if (
    type === "group" &&
    (value.label === undefined || typeof value.label === "string") &&
    (value.background === undefined || typeof value.background === "string") &&
    (value.backgroundStyle === undefined ||
      (typeof value.backgroundStyle === "string" &&
        backgroundStyles.has(value.backgroundStyle)))
  ) {
    return value as CanvasGroupNode;
  }
  throw invalidNode(index);
}

function parseEdge(value: unknown, index: number): CanvasEdge {
  if (!isObject(value)) throw invalidEdge(index);
  const { id, fromNode, fromSide, fromEnd, toNode, toSide, toEnd, color, label } =
    value;
  if (
    !isIdentifier(id) ||
    !isIdentifier(fromNode) ||
    !isIdentifier(toNode) ||
    !isOptionalEnum(fromSide, sides) ||
    !isOptionalEnum(toSide, sides) ||
    !isOptionalEnum(fromEnd, ends) ||
    !isOptionalEnum(toEnd, ends) ||
    !isCanvasColor(color) ||
    (label !== undefined && typeof label !== "string")
  ) {
    throw invalidEdge(index);
  }
  return value as CanvasEdge;
}

function invalidNode(index: number) {
  return new Error(`JSON Canvas node ${index + 1} is invalid.`);
}

function invalidEdge(index: number) {
  return new Error(`JSON Canvas edge ${index + 1} is invalid.`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}

function isOptionalEnum(value: unknown, values: ReadonlySet<string>) {
  return value === undefined || (typeof value === "string" && values.has(value));
}

function isCanvasColor(value: unknown): value is CanvasColor | undefined {
  return (
    value === undefined ||
    (typeof value === "string" &&
      (presetColors.has(value) || /^#[0-9a-f]{6}$/i.test(value)))
  );
}
