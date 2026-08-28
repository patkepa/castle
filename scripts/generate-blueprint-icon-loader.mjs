import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const castleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconPathsRoot = path.join(
  castleRoot,
  "node_modules/@blueprintjs/icons/lib/esm/generated/16px/paths",
);
const outputPath = path.join(
  castleRoot,
  "src/generated/blueprint_icon_paths.ts",
);
const scanRoots = [
  path.join(castleRoot, "src"),
  path.join(castleRoot, "node_modules/@patkepa/kantzen-ui"),
];
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const quotedToken = /(["'])([a-z][a-z0-9-]+)\1/g;
// These are the only icons that must be present in the first app frame: compact
// navigation hides every label, so a lazy-loaded glyph leaves an empty sidebar.
const sidebarIconNames = [
  "home",
  "folder-open",
  "graph",
  "tick-circle",
  "calendar",
  "grid-view",
  "inbox",
];

const availableIcons = new Set(
  (await readdir(iconPathsRoot))
    .filter((file) => file.endsWith(".js"))
    .map((file) => file.slice(0, -3)),
);
const usedIcons = new Set();

for (const root of scanRoots) {
  for (const sourcePath of await sourceFiles(root)) {
    if (sourcePath === outputPath) continue;
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(quotedToken)) {
      if (availableIcons.has(match[2])) usedIcons.add(match[2]);
    }
  }
}

try {
  const catalog = JSON.parse(
    await readFile(path.join(castleRoot, "public/generated/catalog.json"), "utf8"),
  );
  for (const section of catalog.sections ?? []) {
    if (availableIcons.has(section.icon)) usedIcons.add(section.icon);
  }
} catch {
  // Source scanning is sufficient before the first catalog has been generated.
}

const iconNames = [...usedIcons].sort();
const eagerSidebarIconNames = sidebarIconNames.filter((iconName) =>
  availableIcons.has(iconName),
);
const sidebarImports = eagerSidebarIconNames.map((iconName) => {
  const identifier = iconName.replaceAll("-", "_");
  return `import icon16_${identifier} from "@blueprintjs/icons/lib/esm/generated/16px/paths/${iconName}.js";`;
});
const sidebarEntries = eagerSidebarIconNames.map((iconName) => {
  const identifier = iconName.replaceAll("-", "_");
  return `  "${iconName}": icon16_${identifier},`;
});
const entries = iconNames.map(
  (iconName) =>
    `  "${iconName}": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/${iconName}.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/${iconName}.js"),
  ],`,
);
const output = `import { IconSize, Icons, type IconName, type IconPaths } from "@patkepa/kantzen-ui/icons";
${sidebarImports.join("\n")}

interface IconPathsModule {
  default: IconPaths;
}

type IconPathsImporter = () => Promise<IconPathsModule>;

const castleSidebarIconNames: IconName[] = [${eagerSidebarIconNames.map((iconName) => `"${iconName}"`).join(", ")}];

const castleSidebarIconPaths: Readonly<Record<string, IconPaths>> = {
${sidebarEntries.join("\n")}
};

const castleIconPaths: Readonly<
  Record<string, readonly [IconPathsImporter, IconPathsImporter]>
> = {
${entries.join("\n")}
};

export function configureCastleIconLoader() {
  Icons.setLoaderOptions({
    loader: async (iconName, iconSize) => {
      const sidebarPaths =
        iconSize < IconSize.LARGE ? castleSidebarIconPaths[iconName] : undefined;
      if (sidebarPaths) return sidebarPaths;
      const importers = castleIconPaths[iconName];
      if (!importers) throw new Error(\`Castle has no generated paths for icon "\${iconName}".\`);
      const module = await importers[iconSize >= IconSize.LARGE ? 1 : 0]();
      return module.default;
    },
  });
}

export function preloadCastleSidebarIcons() {
  return Icons.load(castleSidebarIconNames, IconSize.STANDARD);
}
`;

await writeFile(outputPath, output);
console.log(`Generated Blueprint paths for ${iconNames.length} Castle icons.`);

async function sourceFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(entryPath)));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}
