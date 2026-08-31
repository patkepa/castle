import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CASTLE_CONTENT_CONTRACT_VERSION,
  parseCastleContract,
  type CatalogNote,
  type KnowledgeBase,
} from "@castle/contracts";

// Astro bundles this module before prerendering, so import.meta.url no longer
// points into src/ at route generation time. Workspace scripts run with
// apps/web as their working directory, which is the stable snapshot anchor.
const publicRoot = path.resolve(process.cwd(), ".castle/public");

export type CastleNote = CatalogNote;
export type CastleCatalog = KnowledgeBase;

export interface CastleNoteContent {
  id: string;
  content: string;
  headings: Array<{ depth: number; label: string; id: string; line: number }>;
}

let catalogRequest: Promise<CastleCatalog> | undefined;

export function loadCatalog() {
  catalogRequest ??= readJson<unknown>("generated/catalog.json").then(
    (value) => {
      const catalog = parseCastleContract("KnowledgeBase", value);
      if (catalog.contractVersion !== CASTLE_CONTENT_CONTRACT_VERSION) {
        throw new Error(
          `Castle web supports content contract ${CASTLE_CONTENT_CONTRACT_VERSION}, received ${catalog.contractVersion}.`,
        );
      }
      return catalog;
    },
  );
  return catalogRequest;
}

export function loadNoteContent(note: CastleNote) {
  const resourcePath = note.contentPath.replace(/^\/+/, "");
  if (!/^generated\/notes\/[a-f0-9]{64}\.json$/.test(resourcePath)) {
    throw new Error(`Castle note ${note.id} has an invalid content path.`);
  }
  return readJson<CastleNoteContent>(resourcePath);
}

export function noteRoutePath(note: CastleNote) {
  const prefix = "/note/";
  if (!note.route.startsWith(prefix)) {
    throw new Error(`Castle note ${note.id} has an invalid route.`);
  }
  return note.route.slice(prefix.length);
}

export function withBase(pathname: string, base: string) {
  if (!pathname.startsWith("/")) return pathname;
  const normalizedBase = base === "/" ? "" : `/${base.split("/").filter(Boolean).join("/")}`;
  return `${normalizedBase}${pathname}` || "/";
}

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(publicRoot, relativePath), "utf8")) as T;
}
