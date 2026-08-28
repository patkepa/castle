import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  markdownBodyFromSource,
  NoteEditingSurface,
} from "../src/components/note_source_editor.tsx";
import { markdownHeadings } from "../src/lib/markdownSource.ts";

test("markdownBodyFromSource removes YAML frontmatter without changing the body", () => {
  const source = [
    "---",
    "title: Castle",
    "tags:",
    "  - electron",
    "---",
    "",
    "# Castle",
    "",
    "Desktop body.",
  ].join("\n");

  assert.equal(markdownBodyFromSource(source), "# Castle\n\nDesktop body.");
});

test("markdownBodyFromSource supports BOM and CRLF frontmatter", () => {
  const source = "\uFEFF---\r\ntitle: Castle\r\n---\r\n\r\nBody\r\n";
  assert.equal(markdownBodyFromSource(source), "Body");
});

test("markdownBodyFromSource leaves ordinary Markdown available for preview", () => {
  assert.equal(markdownBodyFromSource("\n# Note\n\nBody\n"), "# Note\n\nBody");
});

test("markdownHeadings gives reusable documents stable duplicate-aware anchors", () => {
  assert.deepEqual(markdownHeadings("Intro\n\n## Start\n\n### Start\n\n## Start"), [
    { depth: 2, id: "start", label: "Start", line: 3 },
    { depth: 3, id: "start-1", label: "Start", line: 5 },
    { depth: 2, id: "start-2", label: "Start", line: 7 },
  ]);
});

test("NoteEditingSurface exposes the complete source in one Markdown editor", () => {
  const source = "---\ntitle: Castle\n---\n\n# Castle\n\nEditable body.";
  const markup = renderToStaticMarkup(
    createElement(NoteEditingSurface, {
      draft: source,
      error: "",
      note: { title: "Castle" },
      onChange: () => {},
      onReload: () => {},
    }),
  );

  assert.match(markup, /aria-label="Markdown source"/);
  assert.match(markup, /title: Castle/);
  assert.match(markup, /Editable body\./);
  assert.doesNotMatch(markup, /Rendered preview|note-live-preview/);
});
