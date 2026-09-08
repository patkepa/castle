---
title: Markdown help
tags:
  - castle
  - help
  - markdown
---

Castle stores your knowledge as Markdown. The same renderer powers regular notes, built-in documents, and the home page.

## Text and headings

Use `##` through `####` for sections below a document title. Add **bold**, *italic*, or `inline code` wherever it helps.

```md
## A section

Write ordinary paragraphs here.
```

## Links

Standard Markdown links work for the web and for Castle routes.

```md
[Tasks](/tasks)
[A website](https://example.com)
```

You can also use Obsidian links such as `[[wiki/my_note]]` in library files. Castle resolves them when it generates the catalog.

## Checklists

```md
- [ ] Something to do
- [x] Something finished
```

- [ ] Something to do
- [x] Something finished

## Quotes, tables, and code

> A blockquote is useful for a thought worth setting apart.

| Element | Markdown |
| --- | --- |
| Heading | `## Heading` |
| Link | `[Label](destination)` |
| Image | `![Description](path)` |

Fenced code blocks keep formatting and are horizontally scrollable when needed.

## Built-in documents and overrides

Castle ships this help page with the application. It is always available, even in a new library. When you choose Edit in the note workspace, Castle creates a normal Markdown file in your library and uses it instead of the built-in version from then on.

This guide overrides to `notes/castle_help.md`.

Deleting an override reveals the built-in document again.
