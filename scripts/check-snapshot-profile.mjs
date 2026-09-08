import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const [profile, snapshotRoot] = process.argv.slice(2);
if (!snapshotRoot || !new Set(["desktop", "public"]).has(profile)) {
  throw new Error("Usage: check-snapshot-profile.mjs <desktop|public> <snapshot-root>");
}

const generatedRoot = path.resolve(snapshotRoot, "generated");
const catalog = readJson(path.join(generatedRoot, "catalog.json"));

if (profile === "desktop") {
  requirePaths([
    "bootstrap.json",
    "canvases/catalog.json",
    "manifest.json",
    "relationship-graph.json",
    "search-index.json",
    "sheets/catalog.json",
  ]);
  forbidPaths(["public-profile.json"]);
  requireKeys(catalog, [
    "calendarEvents",
    "contractVersion",
    "folders",
    "generatedAt",
    "notes",
    "projects",
    "sections",
    "shortcutCollections",
    "tasks",
  ]);
} else {
  requirePaths(["public-profile.json"]);
  forbidPaths([
    "bootstrap.json",
    "canvases",
    "domains",
    "manifest.json",
    "relationship-graph.json",
    "search-index.json",
    "sheets",
  ]);
  requireKeys(catalog, ["contractVersion", "generatedAt", "notes", "sections"]);
  const policy = readJson(path.join(generatedRoot, "public-profile.json"));
  if (policy.profile !== "public") throw new Error("Public snapshot policy is missing.");
  const firstNote = catalog.notes?.[0];
  if (firstNote) {
    requireKeys(firstNote, policy.noteFields);
    const notePath = firstNote.contentPath?.replace(/^\/+/, "");
    if (!notePath) throw new Error("Public note has no content path.");
    requireKeys(readJson(path.resolve(snapshotRoot, notePath)), policy.noteContentFields);
  }
  for (const assetRoot of ["assets", "content-assets"]) {
    const absoluteRoot = path.resolve(snapshotRoot, assetRoot);
    if (!existsSync(absoluteRoot)) continue;
    for (const file of filesUnder(absoluteRoot)) {
      const extension = path.extname(file).slice(1).toLowerCase();
      if (!policy.assetExtensions.includes(extension)) {
        throw new Error(`Public snapshot contains non-allowlisted asset ${file}.`);
      }
    }
  }
}

console.log(`${profile} snapshot profile is valid.`);

function requirePaths(relativePaths) {
  for (const relativePath of relativePaths) {
    if (!existsSync(path.join(generatedRoot, relativePath))) {
      throw new Error(`${profile} snapshot is missing generated/${relativePath}.`);
    }
  }
}

function forbidPaths(relativePaths) {
  for (const relativePath of relativePaths) {
    if (existsSync(path.join(generatedRoot, relativePath))) {
      throw new Error(`${profile} snapshot contains generated/${relativePath}.`);
    }
  }
}

function requireKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(allowed)) {
    throw new Error(`Unexpected ${profile} snapshot fields: ${actual.join(", ")}.`);
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(candidate) : [candidate];
  });
}
