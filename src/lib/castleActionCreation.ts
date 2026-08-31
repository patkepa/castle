import type { TaskFields } from "@castle/contracts";
import type { CreateCastleSourceInput } from "../platform/castle_platform";
import { noteStem } from "./noteFilenames";

export function createQuickTaskFields(title: string): TaskFields {
  return {
    title: requiredTitle(title),
    description: "",
    status: "todo",
    targetDate: "",
    targetTime: "",
    estimateMinutes: 0,
    projectId: "",
    peopleIds: [],
    tags: [],
  };
}

export function createPersonSourceInput(
  name: string,
  existingIds: ReadonlySet<string>,
): CreateCastleSourceInput {
  const normalizedName = requiredTitle(name);
  const baseSlug = noteStem(normalizedName) || "new_person";
  let slug = baseSlug;
  let id = `person_${slug}`;
  let suffix = 2;
  while (existingIds.has(id)) {
    slug = `${baseSlug}_${suffix}`;
    id = `person_${slug}`;
    suffix += 1;
  }

  return {
    noteId: id,
    sourceFile: `people/${slug}.md`,
    markdown: [
      "---",
      "type: person",
      "schema_version: 1",
      `id: ${id}`,
      "alignment:",
      "  - unknown",
      "relation: neutral",
      "known_from:",
      '  - "unknown"',
      `name: ${JSON.stringify(normalizedName)}`,
      'location: "unknown"',
      "tags:",
      "  - relationship",
      "---",
      "",
      `# ${normalizedName}`,
      "",
    ].join("\n"),
  };
}

export function createJournalSourceInput(date: string): CreateCastleSourceInput {
  const year = date.slice(0, 4);
  const noteId = `journal/${year}/${date}`;
  return {
    noteId,
    sourceFile: `${noteId}.md`,
    markdown: `# ${date}\n\n`,
  };
}

function requiredTitle(value: string) {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized) throw new Error("Add a title before creating this item.");
  return normalized;
}
