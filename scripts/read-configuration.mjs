import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const defaults = Object.freeze({
  schemaVersion: 1,
  applicationName: "Castle",
  applicationBundleId: "app.castle.desktop",
  libraryPath: "examples/library",
  repositoryPath: ".",
  ownerNoteId: "",
  ownerDisplayName: "Owner",
  ownerAvatarUrl: "",
});

export function readCastleConfiguration({
  castleRoot = path.resolve(import.meta.dirname, ".."),
} = {}) {
  const configurationPath = findConfigurationPath(castleRoot);
  const configurationDirectory = path.dirname(configurationPath);
  const localConfigurationPath = path.join(
    configurationDirectory,
    "CONFIGURATION.local.md",
  );
  const base = readFrontmatter(configurationPath);
  const local = readFrontmatter(localConfigurationPath);
  const merged = mergeConfiguration(base, local);

  const configuration = {
    schemaVersion: integer(merged.schema_version, defaults.schemaVersion),
    applicationName: text(merged.application?.name, defaults.applicationName),
    applicationBundleId: text(
      merged.application?.bundle_id,
      defaults.applicationBundleId,
    ),
    libraryPath: resolveConfiguredPath(
      configurationDirectory,
      text(merged.library?.path, defaults.libraryPath),
    ),
    repositoryPath: resolveConfiguredPath(
      configurationDirectory,
      text(merged.library?.repository_path, defaults.repositoryPath),
    ),
    ownerNoteId: optionalText(merged.owner?.note_id),
    ownerDisplayName: text(
      merged.owner?.display_name,
      defaults.ownerDisplayName,
    ),
    ownerAvatarUrl: optionalText(merged.owner?.avatar_url),
  };

  validateConfiguration(configuration, configurationPath);
  return Object.freeze(configuration);
}

function findConfigurationPath(startingRoot) {
  if (process.env.CASTLE_CONFIGURATION_PATH) {
    return path.resolve(process.env.CASTLE_CONFIGURATION_PATH);
  }
  const candidates = [];
  let current = path.resolve(startingRoot);
  for (let depth = 0; depth < 4; depth += 1) {
    candidates.push(path.join(current, "CONFIGURATION.md"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  candidates.push(path.join(process.cwd(), "CONFIGURATION.md"));
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function readFrontmatter(filePath) {
  if (!existsSync(filePath)) return {};
  const data = matter(readFileSync(filePath, "utf8")).data;
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

function mergeConfiguration(base, local) {
  return {
    ...base,
    ...local,
    application: { ...base.application, ...local.application },
    library: { ...base.library, ...local.library },
    owner: { ...base.owner, ...local.owner },
  };
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function resolveConfiguredPath(root, value) {
  return path.resolve(root, value);
}

function validateConfiguration(configuration, configurationPath) {
  if (configuration.schemaVersion !== 1) {
    throw new Error(
      `${configurationPath} uses unsupported schema_version ${configuration.schemaVersion}.`,
    );
  }
  if (!/^[A-Za-z0-9.-]+$/u.test(configuration.applicationBundleId)) {
    throw new Error(
      `${configurationPath} application.bundle_id must be a reverse-DNS identifier.`,
    );
  }
  if (
    configuration.ownerNoteId.startsWith("/") ||
    configuration.ownerNoteId.split("/").includes("..") ||
    configuration.ownerNoteId.endsWith(".md")
  ) {
    throw new Error(
      `${configurationPath} owner.note_id must be a library-relative note ID without .md.`,
    );
  }
}
