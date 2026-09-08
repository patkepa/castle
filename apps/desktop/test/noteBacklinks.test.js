import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { NoteMarkdown } from "../src/components/NoteMarkdown.tsx";
import {
  NOTE_LINK_PREVIEW_HOVER_DELAY_MS,
  NoteLinkPreview,
} from "../src/components/MarkdownRenderer.tsx";
import { NoteSidebar } from "../src/components/note-sidebar/NoteSidebar.tsx";

function note(overrides) {
  return {
    id: "note",
    route: "/note/notes/note",
    sectionLabel: "Notes",
    sourceFile: "notes/note.md",
    title: "Note",
    ...overrides,
  };
}

function renderInRouter(component) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, component),
  );
}

test("renders stable anchors on internal note link occurrences", () => {
  const source = note({
    id: "source",
    route: "/note/notes/source",
    sourceFile: "notes/folder/source.md",
    title: "Source",
  });
  const target = note({
    id: "target",
    route: "/note/notes/target",
    sourceFile: "notes/target.md",
    title: "Target",
  });

  const markup = renderInRouter(
    createElement(NoteMarkdown, {
      content: "Zażółć 😀 [Target](../target.md)",
      note: source,
      notes: [source, target],
    }),
  );

  assert.match(markup, /id="link-occurrence-1-11"/);
  assert.match(markup, /class="backlink-occurrence"/);
  assert.match(markup, /href="\/note\/notes\/target"/);
  assert.match(
    markup,
    /aria-describedby="note-link-preview-target-link-occurrence-1-11"/,
  );
});

test("groups repeated backlink mentions and links to each occurrence", () => {
  const current = note({ id: "target", title: "Target" });
  const source = note({
    id: "source",
    route: "/note/notes/source",
    sectionLabel: "Journal",
    title: "Source note",
  });

  const markup = renderInRouter(
    createElement(NoteSidebar, {
      activeHeading: "",
      backlinks: [
        {
          note: source,
          occurrences: [
            {
              anchorId: "link-occurrence-2-4",
              context: "The first contextual sentence.",
            },
            {
              anchorId: "link-occurrence-8-12",
              context: "The second contextual sentence.",
            },
          ],
        },
      ],
      headings: [],
      note: current,
      onClose() {},
      onHeadingClick() {},
      open: true,
    }),
  );

  assert.match(markup, /2 mentions from 1 note/);
  assert.match(markup, /Journal · 2 mentions/);
  assert.match(markup, /The first contextual sentence\./);
  assert.match(markup, /The second contextual sentence\./);
  assert.match(
    markup,
    /href="\/note\/notes\/source#link-occurrence-2-4"/,
  );
  assert.match(
    markup,
    /href="\/note\/notes\/source#link-occurrence-8-12"/,
  );
});

test("shows an Obsidian-style target note preview after the configured hover delay", () => {
  const target = note({
    excerpt: "A compact preview of the linked note.",
    id: "target",
    readingMinutes: 4,
    sectionLabel: "Wiki",
    title: "Linked note",
  });

  const markup = renderToStaticMarkup(
    createElement(NoteLinkPreview, {
      id: "note-link-preview-target-link-occurrence-2-4",
      note: target,
    }),
  );

  assert.equal(NOTE_LINK_PREVIEW_HOVER_DELAY_MS, 500);
  assert.match(markup, /role="tooltip"/);
  assert.match(markup, /Wiki/);
  assert.match(markup, /Linked note/);
  assert.match(markup, /4 min read/);
  assert.match(markup, /A compact preview of the linked note\./);
  assert.match(markup, /Open note/);
});
