import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readCastleConfiguration } from "../../../scripts/read-configuration.mjs";

test("loads portable Castle settings and resolves relative library paths", async () => {
  const castleRoot = await mkdtemp(path.join(os.tmpdir(), "castle-configuration-"));
  await writeFile(
    path.join(castleRoot, "CONFIGURATION.md"),
    `---
schema_version: 1
application:
  name: Example Castle
  bundle_id: org.example.castle
library:
  path: ../example-library
  repository_path: ..
owner:
  note_id: people/alex_morgan
  display_name: Alex Morgan
---
`,
  );

  const configuration = readCastleConfiguration({ castleRoot });
  assert.equal(configuration.applicationName, "Example Castle");
  assert.equal(configuration.applicationBundleId, "org.example.castle");
  assert.equal(configuration.ownerNoteId, "people/alex_morgan");
  assert.equal(configuration.ownerDisplayName, "Alex Morgan");
  assert.equal(
    configuration.libraryPath,
    path.resolve(castleRoot, "../example-library"),
  );
});

test("local configuration overrides private values without replacing defaults", async () => {
  const castleRoot = await mkdtemp(path.join(os.tmpdir(), "castle-configuration-"));
  await writeFile(
    path.join(castleRoot, "CONFIGURATION.md"),
    `---
schema_version: 1
application:
  name: Castle
owner:
  display_name: Owner
---
`,
  );
  await writeFile(
    path.join(castleRoot, "CONFIGURATION.local.md"),
    `---
owner:
  display_name: Private Owner
---
`,
  );

  const configuration = readCastleConfiguration({ castleRoot });
  assert.equal(configuration.applicationName, "Castle");
  assert.equal(configuration.ownerDisplayName, "Private Owner");
});
