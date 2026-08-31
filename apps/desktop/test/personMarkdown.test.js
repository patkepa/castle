import assert from "node:assert/strict";
import test from "node:test";
import { readPersonMarkdown } from "../src/features/relationships/personMarkdown.ts";

const legacySource = `---
type: person
schema_version: 1
id: person_example
alignment:
  - close_friend
  - coworker
relation: positive
known_from:
  - "example_collective/engineering"
name: "Old Name"
location: "Old address"
department: Firmware
tags: ["relationship", "work"]
---

# Old Name

Body copy.
`;

test("reads editable person fields and Markdown body", () => {
  const person = readPersonMarkdown(legacySource);
  assert.equal(person.name, "Old Name");
  assert.deepEqual(person.alignments, ["close_friend", "coworker"]);
  assert.deepEqual(person.knownFrom, ["example_collective/engineering"]);
  assert.deepEqual(person.departments, ["Firmware"]);
  assert.deepEqual(person.tags, ["relationship", "work"]);
  assert.equal(person.location, "Old address");
  assert.match(person.body, /^# Old Name/);
});

test("reads the primary address from structured person locations", () => {
  const source = `---
type: person
schema_version: 1
id: person_locations
name: "Location Person"
alignment: ["friend"]
relation: neutral
known_from: ["unknown"]
locations:
  - label: "Office"
    address: "Secondary"
  - label: "Home"
    address: "Primary address"
    primary: true
---

# Location Person
`;
  assert.equal(readPersonMarkdown(source).location, "Primary address");
});
