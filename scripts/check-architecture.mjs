import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repositoryRoot, "src");
const featuresRoot = path.join(sourceRoot, "features");
const webSourceRoot = path.join(repositoryRoot, "apps", "web", "src");
const appsRoot = path.join(repositoryRoot, "apps");
const packagesRoot = path.join(repositoryRoot, "packages");
const electronRoot = path.join(repositoryRoot, "electron");
const sharedFeatures = new Set(["context_menu", "records"]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const violations = [];

for (const filePath of sourceFiles(sourceRoot)) {
  const relativePath = path.relative(sourceRoot, filePath).replaceAll(path.sep, "/");
  const imports = importedPaths(readFileSync(filePath, "utf8"));
  const topLevelArea = relativePath.split("/")[0];

  for (const importPath of imports) {
    if (!importPath.startsWith(".")) continue;
    const targetPath = path.resolve(path.dirname(filePath), importPath);
    if (["app", "lib", "platform"].includes(topLevelArea)) {
      if (isWithin(targetPath, featuresRoot) || isWithin(targetPath, path.join(sourceRoot, "components"))) {
        violations.push(`${relativePath}: core layer cannot import UI/domain module ${importPath}`);
      }
    }

    if (!isWithin(filePath, featuresRoot) || !isWithin(targetPath, featuresRoot)) {
      continue;
    }
    const owner = path.relative(featuresRoot, filePath).split(path.sep)[0];
    const targetOwner = path.relative(featuresRoot, targetPath).split(path.sep)[0];
    if (
      owner !== targetOwner &&
      !sharedFeatures.has(owner) &&
      !sharedFeatures.has(targetOwner)
    ) {
      violations.push(
        `${relativePath}: feature ${owner} cannot reach into feature ${targetOwner} (${importPath})`,
      );
    }
  }
}

for (const filePath of sourceFiles(webSourceRoot)) {
  const relativePath = path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
  const source = readFileSync(filePath, "utf8");
  const imports = importedPaths(source);

  if (source.includes("window.castleDesktop")) {
    violations.push(`${relativePath}: the static web app cannot access the desktop bridge`);
  }

  for (const importPath of imports) {
    if (importPath === "electron" || importPath.startsWith("electron/")) {
      violations.push(`${relativePath}: the static web app cannot import Electron`);
      continue;
    }
    if (!importPath.startsWith(".")) continue;
    const targetPath = path.resolve(path.dirname(filePath), importPath);
    if (isWithin(targetPath, electronRoot) || isWithin(targetPath, sourceRoot)) {
      violations.push(
        `${relativePath}: the static web app must depend on snapshot contracts or shared packages (${importPath})`,
      );
    }
  }
}

for (const filePath of sourceFiles(packagesRoot)) {
  const relativePath = path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
  for (const importPath of importedPaths(readFileSync(filePath, "utf8"))) {
    if (importPath === "electron" || importPath.startsWith("electron/")) {
      violations.push(`${relativePath}: shared packages cannot import Electron`);
      continue;
    }
    if (!importPath.startsWith(".")) continue;
    const targetPath = path.resolve(path.dirname(filePath), importPath);
    if (
      isWithin(targetPath, appsRoot) ||
      isWithin(targetPath, electronRoot) ||
      isWithin(targetPath, sourceRoot)
    ) {
      violations.push(
        `${relativePath}: shared packages cannot depend on application source (${importPath})`,
      );
    }
  }
}

for (const obsoleteRoute of [
  "CalendarPage.tsx",
  "ProjectsPage.tsx",
  "RelationshipGraph.tsx",
  "TasksPage.tsx",
]) {
  const obsoletePath = path.join(sourceRoot, "components", obsoleteRoute);
  if (existsSync(obsoletePath)) {
    violations.push(`components/${obsoleteRoute}: domain route pages belong under src/features`);
  }
}

if (violations.length > 0) {
  console.error(`Castle architecture checks failed:\n${violations.map((item) => `- ${item}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Castle architecture boundaries are valid.");
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(candidate);
    return sourceExtensions.has(path.extname(entry.name)) ? [candidate] : [];
  });
}

function importedPaths(source) {
  const imports = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\()\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) imports.push(match[1]);
  return imports;
}

function isWithin(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}
