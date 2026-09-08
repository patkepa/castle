import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { canvasMediaKind, type CanvasMediaKind } from "../src/features/canvas/canvasMedia";
import type { CastleImportedCanvasMedia } from "../src/platform/desktop_bridge";

export interface CanvasMediaImport {
  name: string;
  mimeType: string;
  data: ArrayBuffer;
}

const canvasMediaDirectory = ["assets", "canvas"];

export async function importCanvasMedia(
  libraryRoot: string,
  input: CanvasMediaImport,
): Promise<CastleImportedCanvasMedia> {
  const kind = canvasMediaKind(input.name, input.mimeType);
  if (!kind) throw new Error("Canvas supports PNG, JPEG, GIF, WebP, and PDF files.");

  const bytes = new Uint8Array(input.data);
  assertCanvasMediaSignature(bytes, kind, input.name);

  const canonicalLibraryRoot = await realpath(libraryRoot);
  const requestedAssetsRoot = path.join(canonicalLibraryRoot, "assets");
  await mkdir(requestedAssetsRoot, { recursive: true, mode: 0o700 });
  const canonicalAssetsRoot = await realpath(requestedAssetsRoot);
  assertInsideRoot(canonicalLibraryRoot, canonicalAssetsRoot, true);
  const requestedMediaRoot = path.join(canonicalAssetsRoot, "canvas");
  await mkdir(requestedMediaRoot, { recursive: true, mode: 0o700 });
  const canonicalMediaRoot = await realpath(requestedMediaRoot);
  assertInsideRoot(canonicalLibraryRoot, canonicalMediaRoot, true);

  const name = mediaFileName(input.name);
  const candidate = path.join(canonicalMediaRoot, name);
  await writeFile(candidate, bytes, { flag: "wx", mode: 0o600 });
  return {
    file: [...canvasMediaDirectory, name].join("/"),
    kind,
  };
}

export async function resolveCanvasMedia(
  libraryRoot: string,
  relativePath: string,
) {
  const canonicalLibraryRoot = await realpath(libraryRoot);
  const requestedPath = path.resolve(canonicalLibraryRoot, ...relativePath.split("/"));
  assertInsideRoot(canonicalLibraryRoot, requestedPath);
  const candidate = await realpath(requestedPath);
  assertInsideRoot(canonicalLibraryRoot, candidate);
  const [metadata, linkMetadata] = await Promise.all([
    stat(candidate),
    lstat(requestedPath),
  ]);
  if (!metadata.isFile() || linkMetadata.isSymbolicLink()) {
    throw new Error("Castle can only open files stored in the library.");
  }
  return candidate;
}

function mediaFileName(value: string) {
  const extension = value.split(".").at(-1)?.toLocaleLowerCase() ?? "";
  const stem = value
    .slice(0, -(extension.length + 1))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "media";
  return `${randomUUID().replaceAll("-", "")}_${stem}.${extension}`;
}

function assertCanvasMediaSignature(
  bytes: Uint8Array,
  kind: CanvasMediaKind,
  name: string,
) {
  const extension = name.split(".").at(-1)?.toLocaleLowerCase();
  const matches = extension === "png"
    ? startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : extension === "jpg" || extension === "jpeg"
      ? startsWith(bytes, [0xff, 0xd8, 0xff])
      : extension === "gif"
        ? startsWith(bytes, [0x47, 0x49, 0x46, 0x38])
        : extension === "webp"
          ? startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && textAt(bytes, 8, 4) === "WEBP"
          : extension === "pdf"
            ? startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
            : false;
  if (!matches) {
    throw new Error(`The selected ${kind} does not match its file extension.`);
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function textAt(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function assertInsideRoot(root: string, candidate: string, allowEqual = false) {
  const relative = path.relative(root, candidate);
  if (
    (!allowEqual && relative === "") ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Castle rejected a media file outside the selected library.");
  }
}
