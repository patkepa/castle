import type { CanvasNode, CanvasSide } from "./jsonCanvas";

export function connectionTargetAtPoint(
  nodes: readonly CanvasNode[],
  sourceNodeId: string,
  point: { x: number; y: number },
) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (
      node.id === sourceNodeId ||
      node.type === "group" ||
      point.x < node.x - 8 ||
      point.x > node.x + node.width + 8 ||
      point.y < node.y - 8 ||
      point.y > node.y + node.height + 8
    ) {
      continue;
    }
    return { node, side: nearestNodeSide(node, point) };
  }
  return undefined;
}

function nearestNodeSide(
  node: CanvasNode,
  point: { x: number; y: number },
): CanvasSide {
  const distances: readonly [CanvasSide, number][] = [
    ["top", Math.abs(point.y - node.y)],
    ["right", Math.abs(point.x - (node.x + node.width))],
    ["bottom", Math.abs(point.y - (node.y + node.height))],
    ["left", Math.abs(point.x - node.x)],
  ];
  let nearest = distances[0];
  for (const candidate of distances.slice(1)) {
    if (candidate[1] < nearest[1]) nearest = candidate;
  }
  return nearest[0];
}
