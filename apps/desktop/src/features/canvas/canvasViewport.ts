export interface CanvasViewTransform {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasViewportPoint {
  x: number;
  y: number;
}

export interface CanvasPinchGesture {
  anchor: CanvasViewportPoint;
  startDistance: number;
  startZoom: number;
}

export function canvasPointBetween(
  first: CanvasViewportPoint,
  second: CanvasViewportPoint,
): CanvasViewportPoint {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

export function createCanvasPinchGesture(
  transform: CanvasViewTransform,
  first: CanvasViewportPoint,
  second: CanvasViewportPoint,
): CanvasPinchGesture {
  const midpoint = canvasPointBetween(first, second);
  return {
    anchor: {
      x: (midpoint.x - transform.x) / transform.zoom,
      y: (midpoint.y - transform.y) / transform.zoom,
    },
    startDistance: Math.max(1, canvasPointDistance(first, second)),
    startZoom: transform.zoom,
  };
}

export function canvasPinchTransform(
  gesture: CanvasPinchGesture,
  first: CanvasViewportPoint,
  second: CanvasViewportPoint,
  minimumZoom: number,
  maximumZoom: number,
): CanvasViewTransform {
  const midpoint = canvasPointBetween(first, second);
  const zoom = clampCanvasZoom(
    gesture.startZoom * (canvasPointDistance(first, second) / gesture.startDistance),
    minimumZoom,
    maximumZoom,
  );
  return {
    x: midpoint.x - gesture.anchor.x * zoom,
    y: midpoint.y - gesture.anchor.y * zoom,
    zoom,
  };
}

export function canvasZoomTransform(
  transform: CanvasViewTransform,
  zoom: number,
  point: CanvasViewportPoint,
): CanvasViewTransform {
  const ratio = zoom / transform.zoom;
  return {
    zoom,
    x: point.x - (point.x - transform.x) * ratio,
    y: point.y - (point.y - transform.y) * ratio,
  };
}

export function canvasWheelZoomTransform(
  transform: CanvasViewTransform,
  delta: number,
  point: CanvasViewportPoint,
  sensitivity: number,
  minimumZoom: number,
  maximumZoom: number,
): CanvasViewTransform {
  const zoom = clampCanvasZoom(
    transform.zoom * Math.exp(-delta * sensitivity),
    minimumZoom,
    maximumZoom,
  );
  return canvasZoomTransform(transform, zoom, point);
}

export function normalizedWheelDelta(
  delta: number,
  deltaMode: number,
  pageSize: number,
) {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * pageSize;
  return delta;
}

function canvasPointDistance(
  first: CanvasViewportPoint,
  second: CanvasViewportPoint,
) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function clampCanvasZoom(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
