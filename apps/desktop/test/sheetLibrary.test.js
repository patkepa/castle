import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  listManagedSheets,
  readManagedSheet,
  saveManagedSheet,
} from "../electron/sheet_library.ts";

test("lists and reads ODS files from the managed sheets folder", async () => {
  const libraryRoot = mkdtempSync(path.join(os.tmpdir(), "castle-sheets-"));
  try {
    mkdirSync(path.join(libraryRoot, "sheets", "planning"), { recursive: true });
    writeFileSync(path.join(libraryRoot, "sheets", "overview.ods"), "overview");
    writeFileSync(
      path.join(libraryRoot, "sheets", "planning", "roadmap.ods"),
      "roadmap",
    );
    writeFileSync(path.join(libraryRoot, "sheets", "ignored.txt"), "ignored");
    writeFileSync(path.join(libraryRoot, "sheets", ".hidden.ods"), "hidden");

    const sheets = await listManagedSheets(libraryRoot);
    assert.deepEqual(sheets.map((sheet) => sheet.relativePath), [
      "overview.ods",
      "planning/roadmap.ods",
    ]);
    assert.deepEqual(
      new TextDecoder().decode(
        await readManagedSheet(libraryRoot, "planning/roadmap.ods"),
      ),
      "roadmap",
    );
  } finally {
    rmSync(libraryRoot, { recursive: true, force: true });
  }
});

test("saves a managed ODS in place without changing its library path", async () => {
  const libraryRoot = mkdtempSync(path.join(os.tmpdir(), "castle-sheets-"));
  try {
    mkdirSync(path.join(libraryRoot, "sheets", "planning"), { recursive: true });
    writeFileSync(path.join(libraryRoot, "sheets", "planning", "roadmap.ods"), "before");
    const saved = await saveManagedSheet(
      libraryRoot,
      "planning/roadmap.ods",
      new TextEncoder().encode("after").buffer,
    );
    assert.equal(saved.relativePath, "planning/roadmap.ods");
    assert.equal(
      new TextDecoder().decode(await readManagedSheet(libraryRoot, "planning/roadmap.ods")),
      "after",
    );
  } finally {
    rmSync(libraryRoot, { recursive: true, force: true });
  }
});

test("rejects managed sheet paths that resolve outside the sheets folder", async () => {
  const libraryRoot = mkdtempSync(path.join(os.tmpdir(), "castle-sheets-"));
  try {
    mkdirSync(path.join(libraryRoot, "sheets"), { recursive: true });
    writeFileSync(path.join(libraryRoot, "private.ods"), "private");
    await assert.rejects(
      readManagedSheet(libraryRoot, "../private.ods"),
      /outside library\/sheets/,
    );
  } finally {
    rmSync(libraryRoot, { recursive: true, force: true });
  }
});
