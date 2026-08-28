import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createPersonEditorDraft,
  PersonEditor,
} from "../src/features/relationships/PersonEditor.tsx";

const person = {
  id: "person:person_example",
  type: "person",
  label: "Example Person",
  categoryId: "friends",
  categoryIds: ["friends"],
  categoryLabel: "Friends",
  relation: "positive",
  relationLabel: "Positive",
  relationColor: "#22c55e",
  alignments: ["friend"],
  alignmentLabel: "Friend",
  knownFrom: ["friends"],
  knownFromLabel: "Friends",
  status: "active",
  tags: ["relationship"],
  href: "/note/people/example_person",
  color: "#3b82f6",
  radius: 10,
  x: 0,
  y: 0,
  labelX: 18,
  labelY: 4,
  textAnchor: "start",
};

const draft = createPersonEditorDraft({
  name: "Example Person",
  nickname: "Example",
  birthday: "2000-01-01",
  birthplace: "Exampleville",
  nationality: "Polish",
  status: "active",
  alignments: ["friend"],
  relation: "positive",
  knownFrom: ["friends"],
  company: "Castle",
  departments: ["Product"],
  location: "London, United Kingdom",
  avatar: "/assets/avatars/example.jpg",
  tags: ["relationship"],
  met: "At work",
  metThrough: "Alex",
  body: "# Example Person\n\nProfile notes.",
});

test("renders the full interactive person editor in the inspector", () => {
  const markup = renderToStaticMarkup(
    createElement(PersonEditor, {
      node: person,
      draft,
      dirty: true,
      error: "",
      loading: false,
      saving: false,
      onCancel: () => {},
      onChange: () => {},
      onDismissError: () => {},
      onRetry: () => {},
      onSave: () => {},
    }),
  );

  assert.match(markup, /aria-label="Edit Example Person"/);
  assert.match(markup, /Editing profile/);
  assert.match(markup, /Save changes/);
  assert.match(markup, /Known from/);
  assert.match(markup, /Alignment/);
  assert.match(markup, /Primary location/);
  assert.match(markup, /Profile notes/);
  assert.match(markup, /<textarea[^>]*># Example Person/);
  assert.doesNotMatch(markup, /disabled=""[^>]*>Save changes/);
});
