import { formatLocalDateKey } from "./calendarDate";
import type { CreateCastleSourceInput } from "../platform/castle_platform";

export function createProjectSeed(
  title: string,
  projects: readonly { id: string }[],
): {
  id: string;
  title: string;
  source: CreateCastleSourceInput;
} {
  const normalizedTitle = title.trim().replace(/\s+/gu, " ");
  if (!normalizedTitle) throw new Error("Add a project title.");
  const baseSlug = snakeCaseName(normalizedTitle) || "new_project";
  const existingIds = new Set(projects.map((project) => project.id));
  let slug = baseSlug;
  let suffix = 2;
  while (existingIds.has(`project_${slug}`)) {
    slug = `${baseSlug}_${suffix}`;
    suffix += 1;
  }
  const id = `project_${slug}`;
  const quotedTitle = JSON.stringify(normalizedTitle);
  const started = formatLocalDateKey(new Date());
  return {
    id,
    title: normalizedTitle,
    source: {
      noteId: id,
      sourceFile: `projects/${slug}/${slug}.md`,
      markdown: [
        "---",
        "type: project",
        "schema_version: 1",
        `id: ${id}`,
        `title: ${quotedTitle}`,
        "status: active",
        `started: ${started}`,
        "---",
        "",
        `# ${normalizedTitle}`,
        "",
      ].join("\n"),
    },
  };
}

function snakeCaseName(value: string) {
  return value
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}
