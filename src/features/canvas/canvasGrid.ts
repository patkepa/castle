export const canvasSnapGridSize = 10;

export function snapCanvasValue(value: number) {
  const snapped = Math.round(value / canvasSnapGridSize) * canvasSnapGridSize;
  return Object.is(snapped, -0) ? 0 : snapped;
}

export function snapCanvasValueInDirection(origin: number, target: number) {
  const movement = target - origin;
  if (movement === 0) return origin;
  const snapped = snapCanvasValue(target);
  return Math.sign(snapped - origin) === Math.sign(movement) ? snapped : origin;
}

export function snappedCanvasDragDelta(
  anchor: { x: number; y: number },
  movement: { x: number; y: number },
) {
  return {
    x: snapCanvasValueInDirection(anchor.x, anchor.x + movement.x) - anchor.x,
    y: snapCanvasValueInDirection(anchor.y, anchor.y + movement.y) - anchor.y,
  };
}
