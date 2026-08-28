const lastOpenedCanvasStorageKey = "castle.canvas.last-opened.v1";

type CanvasPathStorage = Pick<Storage, "getItem" | "setItem">;

export function readLastOpenedCanvasPath(
  storage: CanvasPathStorage = window.localStorage,
) {
  try {
    return storage.getItem(lastOpenedCanvasStorageKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writeLastOpenedCanvasPath(
  relativePath: string,
  storage: CanvasPathStorage = window.localStorage,
) {
  try {
    storage.setItem(lastOpenedCanvasStorageKey, relativePath);
  } catch {
    // Canvas still works when browser storage is unavailable.
  }
}
