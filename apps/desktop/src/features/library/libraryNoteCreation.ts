import type { CreateCastleSourceInput } from "../../platform/castle_platform";
import { noteStem } from "../../lib/noteFilenames";

export { noteStem } from "../../lib/noteFilenames";

export function createLibraryNoteSourceInput(
  title: string,
  sectionId: string,
  directory: readonly string[],
  existingSourceFiles: ReadonlySet<string>,
): CreateCastleSourceInput {
  const normalizedTitle = title.trim().replace(/\s+/gu, " ");
  const baseStem = noteStem(normalizedTitle);
  if (!baseStem) {
    throw new Error("Use at least one letter or number in the note title.");
  }

  const sourceDirectory = [sectionId, ...directory].join("/");
  let stem = baseStem;
  let sourceFile = `${sourceDirectory}/${stem}.md`;
  let collisionIndex = 2;

  while (existingSourceFiles.has(sourceFile)) {
    stem = `${baseStem}_${collisionIndex}`;
    sourceFile = `${sourceDirectory}/${stem}.md`;
    collisionIndex += 1;
  }

  return {
    noteId: sourceFile.slice(0, -".md".length),
    sourceFile,
    markdown: `# ${normalizedTitle}\n`,
  };
}
