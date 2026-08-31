import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import {
  parseOdsContentXml,
  parseOdsArrayBuffer,
  createOdsArchive,
  spreadsheetColumnLabel,
} from "../apps/desktop/src/features/sheets/ods.ts";
import {
  cellFromInput,
  recalculateWorkbook,
  updateWorkbookCell,
  updateWorkbookCells,
} from "../apps/desktop/src/features/sheets/calculations.ts";

test("formats spreadsheet column labels beyond Z", () => {
  assert.equal(spreadsheetColumnLabel(0), "A");
  assert.equal(spreadsheetColumnLabel(25), "Z");
  assert.equal(spreadsheetColumnLabel(26), "AA");
  assert.equal(spreadsheetColumnLabel(701), "ZZ");
  assert.equal(spreadsheetColumnLabel(702), "AAA");
});

test("parses sheet names, repeated cells, formulas, and typed ODS values", () => {
  const previousParser = globalThis.DOMParser;
  globalThis.DOMParser = DOMParser;
  try {
    const workbook = parseOdsContentXml(`<?xml version="1.0" encoding="UTF-8"?>
      <office:document-content
        xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
        xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
        xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
        <office:body><office:spreadsheet>
          <table:table table:name="Summary">
            <table:table-row>
              <table:table-cell office:value-type="string"><text:p>Item</text:p></table:table-cell>
              <table:table-cell office:value-type="string"><text:p>Total</text:p></table:table-cell>
            </table:table-row>
            <table:table-row>
              <table:table-cell table:number-columns-repeated="2" />
              <table:table-cell office:value-type="float" office:value="42.5" />
              <table:table-cell table:formula="of:=SUM([.C2])" office:value-type="float" office:value="42.5" />
              <table:table-cell office:value-type="date" office:date-value="2026-08-09" />
              <table:table-cell office:value-type="boolean" office:boolean-value="true" />
              <table:table-cell office:value-type="currency" office:currency="PLN" office:value="12.5" />
              <table:table-cell office:value-type="percentage" office:value="0.25" />
              <table:table-cell office:value-type="time" office:time-value="PT01H30M" />
            </table:table-row>
          </table:table>
          <table:table table:name="Notes">
            <table:table-row><table:table-cell office:value-type="string"><text:p>Done</text:p></table:table-cell></table:table-row>
          </table:table>
        </office:spreadsheet></office:body>
      </office:document-content>`);

    assert.deepEqual(workbook.sheets.map((sheet) => sheet.name), [
      "Summary",
      "Notes",
    ]);
    assert.equal(workbook.sheets[0].rowCount, 2);
    assert.equal(workbook.sheets[0].columnCount, 9);
    assert.equal(workbook.sheets[0].rows[1][2].value, "42.5");
    assert.equal(workbook.sheets[0].rows[1][3].kind, "formula");
    assert.equal(workbook.sheets[0].rows[1][4].kind, "date");
    assert.equal(workbook.sheets[0].rows[1][5].value, "TRUE");
    assert.equal(workbook.sheets[0].rows[1][6].kind, "currency");
    assert.equal(workbook.sheets[0].rows[1][6].currency, "PLN");
    assert.equal(workbook.sheets[0].rows[1][7].kind, "percentage");
    assert.equal(workbook.sheets[0].rows[1][8].kind, "time");
  } finally {
    globalThis.DOMParser = previousParser;
  }
});

test("recalculates ODS formulas and supports arithmetic, ranges, and common functions", () => {
  const workbook = {
    sheets: [{
      name: "Calculations",
      rowCount: 3,
      columnCount: 4,
      truncated: false,
      rows: [
        [cellFromInput("10"), cellFromInput("5"), cellFromInput("=A1+B1*2"), cellFromInput("=SUM(A1:C1)")],
        [cellFromInput("2"), cellFromInput("3"), cellFromInput("=AVERAGE(A1:B2)"), cellFromInput("=ROUND(POWER(B1, 2) / 3, 2)")],
        [cellFromInput("=MAX(A1:B2)-MIN(A1:B2)"), cellFromInput("=COUNT(A1:B2)"), null, null],
      ],
    }],
  };

  const calculated = recalculateWorkbook(workbook);
  assert.equal(calculated.sheets[0].rows[0][2].value, "20");
  assert.equal(calculated.sheets[0].rows[0][3].value, "35");
  assert.equal(calculated.sheets[0].rows[1][2].value, "5");
  assert.equal(calculated.sheets[0].rows[1][3].value, "8.33");
  assert.equal(calculated.sheets[0].rows[2][0].value, "8");
  assert.equal(calculated.sheets[0].rows[2][1].value, "4");
});

test("updates dependent cells and surfaces formula errors without evaluating code", () => {
  const workbook = recalculateWorkbook({
    sheets: [{
      name: "Safe",
      rowCount: 1,
      columnCount: 3,
      truncated: false,
      rows: [[cellFromInput("4"), cellFromInput("=A1*3"), cellFromInput("=A1/0")]],
    }],
  });
  const updated = updateWorkbookCell(workbook, 0, 0, 0, "7");

  assert.equal(updated.sheets[0].rows[0][1].value, "21");
  assert.equal(updated.sheets[0].rows[0][2].value, "#DIV/0!");
  assert.equal(updated.sheets[0].rows[0][2].calculationError, "#DIV/0!");
});

test("applies pasted ranges in one recalculation and writes a portable ODS archive", async () => {
  const previousParser = globalThis.DOMParser;
  globalThis.DOMParser = DOMParser;
  try {
    const workbook = updateWorkbookCells({
      sheets: [{ name: "Budget", rowCount: 1, columnCount: 1, truncated: false, rows: [[null]] }],
    }, 0, [
      { rowIndex: 0, columnIndex: 0, input: "2" },
      { rowIndex: 0, columnIndex: 1, input: "3" },
      { rowIndex: 0, columnIndex: 2, input: "=A1+B1" },
    ]);
    const restored = await parseOdsArrayBuffer(createOdsArchive(workbook));
    assert.equal(restored.sheets[0].name, "Budget");
    assert.equal(restored.sheets[0].rows[0][2].value, "5");
  } finally {
    globalThis.DOMParser = previousParser;
  }
});
