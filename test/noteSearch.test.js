import assert from "node:assert/strict";
import test from "node:test";
import {
  createSearchFolders,
  getMatchSegments,
  matchedSnippet,
  normalizeSearch,
  prepareSearchEntries,
  rankFolders,
  rankNotes,
  rankPages,
} from "../apps/desktop/src/lib/noteSearch.ts";
import { APP_SEARCH_PAGES } from "../apps/desktop/src/lib/appSearchPages.ts";

test("normalizes and ranks exact titles ahead of other matches", () => {
  const notes = [
    note("exact", "Łódź Plan", {
      aliases: ["Project outline"],
      modifiedAt: "2026-01-01T00:00:00.000Z",
    }),
    note("alias", "Unrelated title", {
      aliases: ["Lodz Plan"],
      modifiedAt: "2026-07-01T00:00:00.000Z",
    }),
    note("content", "Another note"),
  ];
  const entries = prepareSearchEntries([
    { id: "exact", text: "Łódź Plan project details" },
    { id: "alias", text: "Lodz Plan alias details" },
    { id: "content", text: "A paragraph about the Lodz plan" },
  ]);

  const results = rankNotes(
    "  LODZ   plan ",
    entries,
    new Map(notes.map((item) => [item.id, item])),
  );

  assert.deepEqual(
    results.map(({ note: resultNote, reason }) => [
      resultNote.id,
      reason,
    ]),
    [
      ["exact", "Exact title"],
      ["alias", "Alias"],
      ["content", "Note content"],
    ],
  );
});

test("builds bounded snippets around normalized content matches", () => {
  const prefix = "Before ".repeat(20);
  const suffix = " after".repeat(30);
  const snippet = matchedSnippet(`${prefix}Łódź${suffix}`, "lodz");

  assert.ok(snippet.startsWith("…"));
  assert.ok(snippet.endsWith("…"));
  assert.match(normalizeSearch(snippet), /lodz/);
  assert.ok(snippet.length < prefix.length + suffix.length);
});

test("classifies title, tag, path, and content matches", () => {
  const notes = [
    note("title", "A Lodz Roadmap"),
    note("tag", "Tagged note", { tags: ["lodz"] }),
    note("path", "Path note", { relativePath: "personal/lodz/note.md" }),
    note("content", "Content note"),
  ];
  const entries = prepareSearchEntries(
    notes.map((item) => ({
      id: item.id,
      text: `${item.title} ${item.tags.join(" ")} ${item.relativePath} ${
        item.id === "content" ? "lodz appears here" : ""
      }`,
    })),
  );

  assert.deepEqual(
    rankNotes(
      "lodz",
      entries,
      new Map(notes.map((item) => [item.id, item])),
    ).map(({ note: resultNote, reason }) => [resultNote.id, reason]),
    [
      ["title", "Title"],
      ["tag", "Tag"],
      ["path", "Path"],
      ["content", "Note content"],
    ],
  );
  assert.deepEqual(
    rankNotes(
      "lodz absent",
      entries,
      new Map(notes.map((item) => [item.id, item])),
    ),
    [],
  );
});

test("uses stable tie-breakers and caps results", () => {
  const notes = Array.from({ length: 14 }, (_, index) =>
    note(`note-${index}`, `Note ${String(index).padStart(2, "0")}`),
  );
  const entries = prepareSearchEntries(
    notes.map((item) => ({ id: item.id, text: "shared content token" })),
  );
  const results = rankNotes(
    "shared",
    entries,
    new Map(notes.map((item) => [item.id, item])),
  );

  assert.equal(results.length, 12);
  assert.deepEqual(
    results.map(({ note: resultNote }) => resultNote.title),
    notes.slice(0, 12).map((item) => item.title),
  );
});

test("builds and ranks navigable folders by name and path", () => {
  const notes = [
    note("guide", "Guide", {
      section: "wiki",
      sectionLabel: "Wiki",
      relativePath: "travel/italy/guide.md",
    }),
    note("plan", "Plan", {
      section: "projects",
      sectionLabel: "Projects",
      relativePath: "castle/roadmap/plan.md",
    }),
  ];
  const folders = createSearchFolders(notes, [
    { id: "wiki", label: "Wiki", icon: "book", count: 1 },
    { id: "projects", label: "Projects", icon: "folder-open", count: 1 },
  ]);

  assert.deepEqual(
    rankFolders("italy", folders).map(({ folder }) => [
      folder.label,
      folder.route,
      folder.noteCount,
    ]),
    [["Italy", "/browse/wiki/travel/italy", 1]],
  );
  assert.deepEqual(
    rankFolders("wiki travel", folders).map(
      ({ folder }) => folder.label,
    ),
    ["Travel", "Italy"],
  );
});

test("ranks matching app pages for quick navigation", () => {
  assert.deepEqual(
    rankPages("calendar", APP_SEARCH_PAGES).map(({ page }) => [
      page.label,
      page.route,
    ]),
    [["Calendar", "/calendar"]],
  );
  assert.deepEqual(
    rankPages("personal tasks", APP_SEARCH_PAGES).map(
      ({ page }) => page.label,
    ),
    ["Tasks"],
  );
  assert.deepEqual(
    rankPages("home", APP_SEARCH_PAGES).map(({ page }) => page.route),
    ["/"],
  );
  assert.deepEqual(
    rankPages("ods spreadsheet", APP_SEARCH_PAGES).map(({ page }) => page.route),
    ["/browse/sheets"],
  );
  assert.deepEqual(
    rankPages("obsidian whiteboard", APP_SEARCH_PAGES).map(({ page }) => page.route),
    ["/canvas"],
  );
});

test("marks matching title characters across words and diacritics", () => {
  assert.deepEqual(getMatchSegments("Renée Łódź", "ren lodz"), [
    { text: "Ren", matched: true },
    { text: "ée ", matched: false },
    { text: "Łódź", matched: true },
  ]);
  assert.equal(normalizeSearch("Łódź"), "lodz");
});

function note(id, title, overrides = {}) {
  return {
    id,
    title,
    aliases: [],
    tags: [],
    relativePath: `${id}.md`,
    modifiedAt: "2026-06-01T00:00:00.000Z",
    excerpt: `${title} excerpt`,
    ...overrides,
  };
}
