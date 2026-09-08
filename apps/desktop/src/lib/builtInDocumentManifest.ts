export type BuiltInDocumentKey = "markdown_help";

export interface BuiltInDocumentDefinition {
  contentPath: `builtin:${BuiltInDocumentKey}`;
  id: string;
  key: BuiltInDocumentKey;
  overrideSourceFile: string;
  pinned: boolean;
  route: string;
  title: string;
}

export const builtInDocumentDefinitions = Object.freeze({
  markdown_help: createDefinition({
    key: "markdown_help",
    overrideSourceFile: "notes/castle_help.md",
    pinned: false,
    title: "Markdown help",
  }),
} satisfies Record<BuiltInDocumentKey, BuiltInDocumentDefinition>);

export const builtInDocumentDefinitionList = Object.freeze(
  Object.values(builtInDocumentDefinitions),
);

export function isBuiltInDocumentRoute(route: string) {
  return builtInDocumentDefinitionList.some(
    (document) => document.route === route,
  );
}

function createDefinition({
  key,
  overrideSourceFile,
  pinned,
  title,
}: {
  key: BuiltInDocumentKey;
  overrideSourceFile: string;
  pinned: boolean;
  title: string;
}): BuiltInDocumentDefinition {
  const id = overrideSourceFile.replace(/\.md$/i, "");
  return {
    contentPath: `builtin:${key}`,
    id,
    key,
    overrideSourceFile,
    pinned,
    route: `/note/${id}`,
    title,
  };
}
