import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repositoryRoot, "src");
const featuresRoot = path.join(sourceRoot, "features");
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

const nativeCrateRules = [
  {
    crate: "castle_contracts",
    allowedCastleDependencies: [],
    allowGpui: false,
  },
  {
    crate: "castle_core",
    allowedCastleDependencies: ["castle-contracts"],
    allowGpui: false,
  },
  {
    crate: "castle_index",
    allowedCastleDependencies: ["castle-contracts", "castle-core"],
    allowGpui: false,
  },
  {
    crate: "castle_runtime",
    allowedCastleDependencies: ["castle-contracts", "castle-core", "castle-index"],
    allowGpui: false,
  },
  {
    crate: "castle_desktop",
    allowedCastleDependencies: ["castle-runtime"],
    allowGpui: true,
  },
];

for (const rule of nativeCrateRules) {
  const manifestPath = path.join(repositoryRoot, "native", rule.crate, "Cargo.toml");
  if (!existsSync(manifestPath)) continue;
  const dependencies = manifestDependencies(readFileSync(manifestPath, "utf8"));
  const allowedCastleDependencies = new Set(rule.allowedCastleDependencies);
  for (const dependency of dependencies) {
    if (dependency.startsWith("castle-") && !allowedCastleDependencies.has(dependency)) {
      violations.push(
        `native/${rule.crate}: cannot depend on ${dependency}`,
      );
    }
    if (dependency === "gpui" && !rule.allowGpui) {
      violations.push(`native/${rule.crate}: only castle_desktop may depend on GPUI`);
    }
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

function manifestDependencies(source) {
  const dependencies = [];
  let dependencySection = false;
  for (const line of source.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1];
    if (section) {
      dependencySection = section.endsWith("dependencies");
      continue;
    }
    if (!dependencySection) continue;
    const dependency = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/)?.[1];
    if (dependency) dependencies.push(dependency);
  }
  return dependencies;
}

function isWithin(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}
