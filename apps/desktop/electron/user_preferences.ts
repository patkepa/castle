import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  parseCastleUserPreferences,
  type CastleUserPreferences,
} from "../src/platform/user_preferences";

export function userPreferencesPath(libraryRoot: string) {
  return path.join(libraryRoot, ".castle", "settings.toml");
}

export function readUserPreferences(
  libraryRoot: string,
): CastleUserPreferences | null {
  const settingsPath = userPreferencesPath(libraryRoot);
  if (!existsSync(settingsPath)) return null;
  try {
    return parseCastleUserPreferences(parsePreferencesToml(readFileSync(settingsPath, "utf8")));
  } catch {
    return null;
  }
}

export function writeUserPreferences(
  libraryRoot: string,
  preferences: CastleUserPreferences,
) {
  const settingsPath = userPreferencesPath(libraryRoot);
  mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${settingsPath}.tmp`;
  writeFileSync(temporaryPath, serializePreferencesToml(preferences), {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, settingsPath);
}

function serializePreferencesToml(preferences: CastleUserPreferences) {
  const taskGroups = Object.entries(preferences.taskGroups)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([workspace, groups]) => `${JSON.stringify(workspace)} = ${JSON.stringify(groups)}`)
    .join("\n");
  return [
    "# Castle interface preferences. This file is local to this library.",
    "# Castle updates it atomically; it is also safe to edit while Castle is closed.",
    `schema_version = ${preferences.schemaVersion}`,
    `sidebar_collapsed = ${preferences.sidebarCollapsed}`,
    `auto_hide_sidebar = ${preferences.autoHideSidebar}`,
    `hidden_navigation_tabs = ${JSON.stringify(preferences.hiddenNavigationTabs)}`,
    `sidebar_note_view = ${JSON.stringify(preferences.sidebarNoteView)}`,
    `pinned_note_ids = ${JSON.stringify(preferences.pinnedNoteIds)}`,
    `pinned_folder_routes = ${JSON.stringify(preferences.pinnedFolderRoutes)}`,
    `library_view_mode = ${JSON.stringify(preferences.libraryViewMode)}`,
    `task_view_mode = ${JSON.stringify(preferences.taskViewMode)}`,
    `task_project_folders = ${JSON.stringify(preferences.taskProjectFolders)}`,
    `task_project_order = ${JSON.stringify(preferences.taskProjectOrder)}`,
    `reading_progress = ${preferences.readingProgress}`,
    `table_of_contents = ${preferences.tableOfContents}`,
    "",
    "[task_groups]",
    taskGroups,
    "",
  ].join("\n");
}

function parsePreferencesToml(source: string): unknown {
  const result: Record<string, unknown> = { taskGroups: {} };
  let section = "";
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === "[task_groups]") {
      section = "task_groups";
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) throw new Error("Invalid Castle preferences TOML.");
    const rawKey = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const key = parseTomlKey(rawKey);
    const value = parseTomlValue(rawValue);
    if (section === "task_groups") {
      (result.taskGroups as Record<string, unknown>)[key] = value;
      continue;
    }
    if (section) throw new Error("Invalid Castle preferences TOML.");
    result[toCamelCase(key)] = value;
  }
  return result;
}

function parseTomlKey(value: string) {
  if (/^[a-z_]+$/.test(value)) return value;
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value) as string;
  throw new Error("Invalid Castle preferences TOML key.");
}

function parseTomlValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return JSON.parse(value);
}

function toCamelCase(value: string) {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
