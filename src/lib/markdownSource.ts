import GithubSlugger from "github-slugger";
import type { Heading } from "../types";

const markdownHeadingPattern = /^(#{2,4})[\t ]+([^\r\n]+?)[\t ]*#*[\t ]*$/gm;

export function markdownBodyFromSource(markdown: string) {
  const frontmatter = markdown.match(
    /^\uFEFF?---[\t ]*\r?\n[\s\S]*?\r?\n---[\t ]*(?:\r?\n|$)/,
  );
  return (frontmatter ? markdown.slice(frontmatter[0].length) : markdown).trim();
}

export function markdownHeadings(markdown: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
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
