import assert from "node:assert/strict";
import test from "node:test";
import {
  createSheetFolderRoute,
  createSheetRoute,
  decodeSheetRoutePath,
  getSheetDirectoryContents,
} from "../src/features/sheets/sheet_library.ts";

const sheet = (relativePath) => ({
  relativePath,
  name: relativePath.split("/").at(-1),
  size: 1024,
  modifiedAt: "2026-08-20T10:00:00.000Z",
  readOnly: true,
});

test("creates library and file routes for nested spreadsheets", () => {
  assert.equal(createSheetFolderRoute(), "/browse/sheets");
  assert.equal(
    createSheetFolderRoute(["annual plans", "Łódź"]),
    "/browse/sheets/annual%20plans/%C5%81%C3%B3d%C5%BA",
  );
  assert.equal(
    createSheetRoute("annual plans/Łódź.ods"),
    "/sheet/annual%20plans/%C5%81%C3%B3d%C5%BA.ods",
  );
  assert.equal(
    decodeSheetRoutePath("annual%20plans/%C5%81%C3%B3d%C5%BA.ods"),
    "annual plans/Łódź.ods",
  );
});

test("lists direct spreadsheet files and immediate child folders", () => {
  const contents = getSheetDirectoryContents([
    sheet("overview.ods"),
    sheet("planning/budget.ods"),
    sheet("planning/quarterly/q1.ods"),
    sheet("planning/quarterly/q2.ods"),
  ], ["planning"]);

  assert.deepEqual(contents.files.map((file) => file.name), ["budget.ods"]);
  assert.deepEqual(contents.folders, [{ name: "quarterly", sheetCount: 2 }]);
});
