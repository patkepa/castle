import GithubSlugger, { slug } from "github-slugger";

export interface MarkdownDocument {
  sourceFile: string;
}

export interface MarkdownLinkTarget extends MarkdownDocument {
  route: string;
}

export interface MarkdownHeading {
  depth: number;
  label: string;
  id: string;
  line: number;
}

const markdownHeadingPattern = /^(#{2,4})[\t ]+([^\r\n]+?)[\t ]*#*[\t ]*$/gm;

export function markdownBodyFromSource(markdown: string) {
  const frontmatter = markdown.match(
    /^\uFEFF?---[\t ]*\r?\n[\s\S]*?\r?\n---[\t ]*(?:\r?\n|$)/,
  );
  return (frontmatter ? markdown.slice(frontmatter[0].length) : markdown).trim();
}

export function markdownHeadings(markdown: string): MarkdownHeading[] {
  const slugger = new GithubSlugger();
  const headings: MarkdownHeading[] = [];
  for (const match of markdown.matchAll(markdownHeadingPattern)) {
    const label = match[2].trim();
    const offset = match.index ?? 0;
    headings.push({
      depth: match[1].length,
      id: slugger.slug(label),
      label,
      line: markdown.slice(0, offset).split("\n").length,
    });
  }
  return headings;
}

export function resolveMarkdownLink<Target extends MarkdownLinkTarget>(
  document: MarkdownDocument,
  href: string,
  sourceLookup: ReadonlyMap<string, Target>,
) {
  if (!href || href.startsWith("#") || href.startsWith("/") || /^[a-z]+:/i.test(href)) {
    return href;
  }

  const [pathname, hash] = href.split("#");
  if (!/\.mdx?$/i.test(pathname)) return href;

  const sourceDirectory = document.sourceFile.split("/").slice(0, -1);
  const resolvedSource = normalizeContentPath([...sourceDirectory, pathname].join("/"));
  const target = sourceLookup.get(resolvedSource);
  return target ? `${target.route}${hash ? `#${slug(hash)}` : ""}` : href;
}

export function resolveMarkdownAsset(document: MarkdownDocument, source: string) {
  if (!source || source.startsWith("/") || /^(data:|https?:)/i.test(source)) return source;
  if (source.startsWith("assets/")) return `/${source}`;

  const sourceDirectory = document.sourceFile.split("/").slice(0, -1);
  const resolved = normalizeContentPath([...sourceDirectory, source].join("/"));
  return resolved.startsWith("assets/")
    ? `/${resolved}`
    : `/content-assets/${resolved}`;
}

export function normalizeContentPath(value: string) {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}
