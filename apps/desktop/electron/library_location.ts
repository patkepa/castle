import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const supportedLibraryDirectories = [
  "events",
  "journal",
  "notes",
  "people",
  "personal",
  "projects",
  "sheets",
  "stash",
  "tasks",
  "wiki",
] as const;

const maximumRecentLibraryCount = 12;

export interface DesktopSettings {
  schemaVersion: 2;
  activeLibraryRoot: string | null;
  recentLibraryRoots: string[];
}

export const emptyDesktopSettings: DesktopSettings = Object.freeze({
  schemaVersion: 2,
  activeLibraryRoot: null,
  recentLibraryRoots: [],
});

function isDirectory(directory: string) {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function isCompatibleLibraryRoot(directory: string) {
  return (
    isDirectory(directory) &&
    supportedLibraryDirectories.some((name) =>
      isDirectory(path.join(directory, name)),
    )
  );
}

export function resolveSelectedLibraryRoot(selection: string) {
  const selectedPath = path.resolve(selection);
  const candidates = [path.join(selectedPath, "library"), selectedPath];

  for (const candidate of candidates) {
    if (isCompatibleLibraryRoot(candidate)) return realpathSync(candidate);
  }
  return null;
}

export function repositoryRootForLibrary(libraryRoot: string) {
  return path.basename(libraryRoot).toLocaleLowerCase() === "library"
    ? path.dirname(libraryRoot)
    : libraryRoot;
}

export function libraryCacheKey(libraryRoot: string) {
  return createHash("sha256")
    .update(path.resolve(libraryRoot))
    .digest("hex")
    .slice(0, 24);
}

export function resolveDesktopDataRoot(
  userDataRoot: string,
  configuredRoot?: string,
) {
  return configuredRoot && path.isAbsolute(configuredRoot)
    ? path.resolve(configuredRoot)
    : path.join(userDataRoot, "castle_data");
}

export function readDesktopSettings(settingsPath: string): DesktopSettings {
  if (!existsSync(settingsPath)) return emptyDesktopSettings;

  try {
    const value: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return emptyDesktopSettings;
    }
    const settings = value as Record<string, unknown>;
    if (settings.schemaVersion === 1) {
      return typeof settings.libraryRoot === "string"
        ? migrateLegacyDesktopSettings(settings.libraryRoot)
        : emptyDesktopSettings;
    }
    if (settings.schemaVersion !== 2) return emptyDesktopSettings;

    const storedActiveRoot = normalizeStoredRoot(settings.activeLibraryRoot);
    const storedRecentRoots = Array.isArray(settings.recentLibraryRoots)
      ? settings.recentLibraryRoots.flatMap((value) => {
          const root = normalizeStoredRoot(value);
          return root ? [root] : [];
        })
      : [];
    const recentLibraryRoots = uniqueLibraryRoots([
      ...(storedActiveRoot ? [storedActiveRoot] : []),
      ...storedRecentRoots,
    ]);
    const activeLibraryRoot = storedActiveRoot
      ? resolveSelectedLibraryRoot(storedActiveRoot)
      : null;

    return {
      schemaVersion: 2,
      activeLibraryRoot,
      recentLibraryRoots: uniqueLibraryRoots([
        ...(activeLibraryRoot ? [activeLibraryRoot] : []),
        ...recentLibraryRoots,
      ]),
    };
  } catch {
    return emptyDesktopSettings;
  }
}

export function rememberDesktopLibrary(
  settings: DesktopSettings,
  libraryRoot: string,
): DesktopSettings {
  const resolvedRoot = resolveSelectedLibraryRoot(libraryRoot);
  if (!resolvedRoot) {
    throw new Error("The selected folder does not contain a compatible Castle library.");
  }

  return {
    schemaVersion: 2,
    activeLibraryRoot: resolvedRoot,
    recentLibraryRoots: uniqueLibraryRoots([
      resolvedRoot,
      ...settings.recentLibraryRoots,
    ]),
  };
}

export function writeDesktopSettings(
  settingsPath: string,
  settings: DesktopSettings,
) {
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  const temporaryPath = `${settingsPath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, settingsPath);
}

export function isLibraryContentPath(libraryRoot: string, filePath: string) {
  const relative = path.relative(libraryRoot, path.resolve(filePath));
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative) &&
    !relative.split(path.sep).some((segment) => segment.startsWith("."))
  );
}

function migrateLegacyDesktopSettings(libraryRoot: string): DesktopSettings {
  const storedRoot = normalizeStoredRoot(libraryRoot);
  if (!storedRoot) return emptyDesktopSettings;
  const activeLibraryRoot = resolveSelectedLibraryRoot(storedRoot);
  return {
    schemaVersion: 2,
    activeLibraryRoot,
    recentLibraryRoots: activeLibraryRoot ? [activeLibraryRoot] : [storedRoot],
  };
}

function normalizeStoredRoot(value: unknown) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 32_768 &&
    path.isAbsolute(value)
    ? path.resolve(value)
    : null;
}

function uniqueLibraryRoots(roots: readonly string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const root of roots) {
    const resolvedRoot = resolveSelectedLibraryRoot(root) ?? path.resolve(root);
    const key = process.platform === "win32"
      ? resolvedRoot.toLocaleLowerCase()
      : resolvedRoot;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(resolvedRoot);
    if (unique.length === maximumRecentLibraryCount) break;
  }
  return unique;
}
