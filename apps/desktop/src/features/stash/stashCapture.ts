import type { CreateCastleSourceInput } from "../../platform/castle_platform";

const maximumStemLabelLength = 48;

export function createStashSourceInput(
  draft: string,
  existingSourceFiles: ReadonlySet<string>,
  createdAt = new Date(),
): CreateCastleSourceInput {
  const markdown = normalizeStashMarkdown(draft);
  const timestamp = formatStashTimestamp(createdAt);
  const label = stashFileLabel(markdown);
  const baseStem = label ? `${timestamp}_${label}` : timestamp;
  let stem = baseStem;
  let collisionIndex = 2;

  while (existingSourceFiles.has(`stash/${stem}.md`)) {
    stem = `${baseStem}_${collisionIndex}`;
    collisionIndex += 1;
  }

  return {
    noteId: `stash/${stem}`,
    sourceFile: `stash/${stem}.md`,
    markdown,
  };
}

export function normalizeStashMarkdown(draft: string) {
  const content = draft.trim();
  return content ? `${content}\n` : "";
}

function formatStashTimestamp(date: Date) {
  const part = (value: number, length = 2) => String(value).padStart(length, "0");
  return [
    part(date.getFullYear(), 4),
    part(date.getMonth() + 1),
    part(date.getDate()),
    part(date.getHours()),
    part(date.getMinutes()),
    part(date.getSeconds()),
    part(date.getMilliseconds(), 3),
  ].join("_");
}

function stashFileLabel(markdown: string) {
  const firstLine = markdown
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "";

  return firstLine
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^[-*+]\s+/u, "")
    .toLocaleLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, maximumStemLabelLength)
    .replace(/_+$/u, "");
}
