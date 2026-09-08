import { snapCanvasValueInDirection } from "./canvasGrid";
import type { CanvasNode } from "./jsonCanvas";

export type CanvasResizeDirection =
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left"
  | "top-left";

const minimumNodeWidth = 140;
const minimumNodeHeight = 80;

export function resizedCanvasNode(
  node: CanvasNode,
  direction: CanvasResizeDirection,
  movement: { x: number; y: number },
  preserveAspectRatio = false,
) {
  const movesLeft = direction.includes("left");
  const movesRight = direction.includes("right");
  const movesTop = direction.includes("top");
  const movesBottom = direction.includes("bottom");
  const isCorner = (movesLeft || movesRight) && (movesTop || movesBottom);

  if (preserveAspectRatio && isCorner) {
    const horizontalDirection = movesLeft ? -1 : 1;
    const verticalDirection = movesTop ? -1 : 1;
    const ratio = node.width / node.height;
    let width = Math.max(
      minimumNodeWidth,
      node.width + movement.x * horizontalDirection,
    );
    let height = Math.max(
      minimumNodeHeight,
      node.height + movement.y * verticalDirection,
    );

    if (width / height > ratio) {
      width = Math.max(
        minimumNodeWidth,
        minimumNodeHeight * ratio,
        snapCanvasValueInDirection(node.width, width),
      );
      height = width / ratio;
    } else {
      height = Math.max(
        minimumNodeHeight,
        minimumNodeWidth / ratio,
        snapCanvasValueInDirection(node.height, height),
      );
      width = height * ratio;
    }

    return {
      x: movesLeft ? node.x + node.width - width : node.x,
      y: movesTop ? node.y + node.height - height : node.y,
      width,
      height,
    };
  }

  const originalRight = node.x + node.width;
  const originalBottom = node.y + node.height;
  let x = node.x;
  let y = node.y;
  let right = originalRight;
  let bottom = originalBottom;

  if (movesLeft) {
    x = Math.min(
      originalRight - minimumNodeWidth,
      snapCanvasValueInDirection(node.x, node.x + movement.x),
    );
  } else if (movesRight) {
    right = Math.max(
      node.x + minimumNodeWidth,
      snapCanvasValueInDirection(originalRight, originalRight + movement.x),
    );
  }

  if (movesTop) {
    y = Math.min(
      originalBottom - minimumNodeHeight,
      snapCanvasValueInDirection(node.y, node.y + movement.y),
    );
  } else if (movesBottom) {
    bottom = Math.max(
      node.y + minimumNodeHeight,
      snapCanvasValueInDirection(originalBottom, originalBottom + movement.y),
    );
  }

  return { x, y, width: right - x, height: bottom - y };
}
