export type CanvasMediaKind = "image" | "pdf";

const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

export const canvasMediaAccept = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
].join(",");

export function canvasMediaKind(
  name: string,
  _mimeType = "",
): CanvasMediaKind | null {
  void _mimeType;
  const extension = name.split(".").at(-1)?.toLocaleLowerCase() ?? "";
  if (imageExtensions.has(extension)) return "image";
  if (extension === "pdf") return "pdf";
  return null;
}

export function canvasMediaUrl(file: string) {
  const normalized = normalizeCanvasMediaPath(file);
  if (!normalized) return "";
  const prefix = normalized.startsWith("assets/") ? "" : "/content-assets";
  return `${prefix}/${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeCanvasMediaPath(value: string) {
  if (!value || value.includes("\\") || value.startsWith("/")) return "";
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return "";
  }
  return segments.join("/");
}
