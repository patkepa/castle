export const personAlignmentOptions = [
  "classmate",
  "close_friend",
  "coworker",
  "crush",
  "family",
  "former_friend",
  "friend",
  "partner",
  "unknown",
] as const;

export const personRelationOptions = [
  "positive",
  "neutral",
  "flirty",
  "mixed",
  "negative",
] as const;

export type PersonAlignment = (typeof personAlignmentOptions)[number];
export type PersonRelation = (typeof personRelationOptions)[number];
export type PersonStatus = "active" | "former";

export interface PersonFormValues {
  name: string;
  nickname: string;
  birthday: string;
  birthplace: string;
  nationality: string;
  status: PersonStatus;
  alignments: string[];
  relation: PersonRelation;
  knownFrom: string[];
  company: string;
  departments: string[];
  location: string;
  avatar: string;
  tags: string[];
  met: string;
  metThrough: string;
  body: string;
}

const frontmatterPattern =
  /^(\uFEFF?---[\t ]*\r?\n)([\s\S]*?)(\r?\n---[\t ]*(?:\r?\n|$))/;

export function readPersonMarkdown(markdown: string): PersonFormValues {
  const source = splitPersonSource(markdown);
  const relation = readScalar(source.frontmatter, "relation");

  return {
    name: readScalar(source.frontmatter, "name"),
    nickname: readScalar(source.frontmatter, "nickname"),
    birthday: readScalar(source.frontmatter, "birthday"),
    birthplace: readScalar(source.frontmatter, "birthplace"),
    nationality: readScalar(source.frontmatter, "nationality"),
    status:
      readScalar(source.frontmatter, "status") === "former"
        ? "former"
        : "active",
    alignments: normalizedList(
      readStringList(source.frontmatter, "alignment"),
      "unknown",
    ),
    relation: personRelationOptions.includes(relation as PersonRelation)
      ? (relation as PersonRelation)
      : "neutral",
    knownFrom: normalizedList(
      readStringList(source.frontmatter, "known_from"),
      "unknown",
    ),
    company: readScalar(source.frontmatter, "company"),
    departments: readStringList(source.frontmatter, "department"),
    location: readPrimaryLocation(source.frontmatter) || "unknown",
    avatar: readScalar(source.frontmatter, "avatar"),
    tags: readStringList(source.frontmatter, "tags"),
    met: readScalar(source.frontmatter, "met"),
    metThrough: readScalar(source.frontmatter, "met_through"),
    body: source.body.replace(/^\r?\n/, ""),
  };
}

function splitPersonSource(markdown: string) {
  const match = frontmatterPattern.exec(markdown);
  if (!match) throw new Error("This person is missing YAML frontmatter.");
  return {
    opening: match[1],
    frontmatter: match[2],
    closing: match[3],
    body: markdown.slice(match[0].length),
  };
}

function readPrimaryLocation(frontmatter: string) {
  const legacy = readScalar(frontmatter, "location");
  if (legacy) return legacy;

  const lines = frontmatter.split(/\r?\n/);
  const range = findFieldRange(lines, "locations");
  if (!range) return "";
  const blocks = itemRanges(lines, range.start + 1, range.end);
  const primary =
    blocks.find(({ start, end }) =>
      lines
        .slice(start, end)
        .some((line) => /^\s+primary\s*:\s*true\s*$/.test(line)),
    ) ?? blocks[0];
  if (!primary) return "";

  for (const line of lines.slice(primary.start, primary.end)) {
    const match = /^\s+address\s*:\s*(.*?)\s*$/.exec(line);
    if (match) return unquote(match[1]);
  }
  return "";
}

function readStringList(frontmatter: string, key: string) {
  const lines = frontmatter.split(/\r?\n/);
  const range = findFieldRange(lines, key);
  if (!range) return [];
  const firstLine = lines[range.start];
  const inline = firstLine.slice(firstLine.indexOf(":") + 1).trim();
  if (inline) {
    if (inline.startsWith("[") && inline.endsWith("]")) {
      try {
        const parsed: unknown = JSON.parse(inline);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean);
        }
      } catch {
        return inline
          .slice(1, -1)
          .split(",")
          .map((value) => unquote(value.trim()))
          .filter(Boolean);
      }
    }
    return [unquote(inline)].filter(Boolean);
  }

  return lines
    .slice(range.start + 1, range.end)
    .flatMap((line) => {
      const item = /^\s*-\s+(.*?)\s*$/.exec(line)?.[1];
      return item ? [unquote(item)] : [];
    })
    .filter(Boolean);
}

function findFieldRange(lines: string[], key: string) {
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:`);
  const start = lines.findIndex((line) => pattern.test(line));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z_][\w-]*\s*:/.test(lines[end])) {
    end += 1;
  }
  return { start, end };
}

function itemRanges(lines: string[], start: number, end: number) {
  const starts: number[] = [];
  for (let index = start; index < end; index += 1) {
    if (/^\s*-\s+/.test(lines[index])) starts.push(index);
  }
  return starts.map((itemStart, index) => ({
    start: itemStart,
    end: starts[index + 1] ?? end,
  }));
}

function readScalar(frontmatter: string, key: string) {
  const lines = frontmatter.split(/\r?\n/);
  const range = findFieldRange(lines, key);
  if (!range) return "";
  const line = lines[range.start];
  return unquote(line.slice(line.indexOf(":") + 1).trim());
}

function normalizedList(values: string[], fallback?: string) {
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : fallback ? [fallback] : [];
}

function unquote(value: string) {
  const normalized = value.trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    if (normalized.startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(normalized);
        return typeof parsed === "string" ? parsed : normalized.slice(1, -1);
      } catch {
        return normalized.slice(1, -1);
      }
    }
    return normalized.slice(1, -1).replace(/''/g, "'");
  }
  return normalized;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
