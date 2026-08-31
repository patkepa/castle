import { readFile } from "node:fs/promises";
import path from "node:path";

const supportedContractVersion = 2;
// Astro bundles this module before prerendering, so import.meta.url no longer
// points into src/ at route generation time. Workspace scripts run with
// apps/web as their working directory, which is the stable snapshot anchor.
const publicRoot = path.resolve(process.cwd(), ".castle/public");

export interface CastleSection {
  id: string;
  label: string;
  icon: string;
  count: number;
}

export interface CastleNote {
  id: string;
  section: string;
  sectionLabel: string;
  sourceFile: string;
  route: string;
  title: string;
  excerpt: string;
  tags: string[];
  modifiedAt: string;
  contentPath: string;
  wordCount: number;
  readingMinutes: number;
}

export interface CastleCatalog {
  contractVersion: number;
  generatedAt: string;
  sections: CastleSection[];
  notes: CastleNote[];
}

export interface CastleNoteContent {
  id: string;
  content: string;
  headings: Array<{ depth: number; label: string; id: string; line: number }>;
}

let catalogRequest: Promise<CastleCatalog> | undefined;

export function loadCatalog() {
  catalogRequest ??= readJson<CastleCatalog>("generated/catalog.json").then(
    (catalog) => {
      if (catalog.contractVersion !== supportedContractVersion) {
        throw new Error(
          `Castle web supports content contract ${supportedContractVersion}, received ${catalog.contractVersion}.`,
        );
      }
      if (!Array.isArray(catalog.sections) || !Array.isArray(catalog.notes)) {
        throw new Error("Castle generated an invalid web catalog.");
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
