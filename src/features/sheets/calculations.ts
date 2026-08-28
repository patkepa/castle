import type { OdsCell, OdsSheet, OdsWorkbook } from "./ods";

type CalculationResult = number | string;

const errorValue = (value: string) => value;

/**
 * Recalculates the small, safe formula subset used by Castle's worksheet
 * editor. It intentionally does not evaluate JavaScript or external links.
 */
export function recalculateWorkbook(workbook: OdsWorkbook): OdsWorkbook {
  const sheets = workbook.sheets.map((sheet) => ({
    ...sheet,
    rows: sheet.rows.map((row) => [...row]),
  }));
  const cache = new Map<string, CalculationResult>();
  const evaluating = new Set<string>();

  const valueAt = (sheetIndex: number, rowIndex: number, columnIndex: number) => {
    const key = `${sheetIndex}:${rowIndex}:${columnIndex}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    if (evaluating.has(key)) return errorValue("#CYCLE!");

    const cell = sheets[sheetIndex]?.rows[rowIndex]?.[columnIndex];
    if (!cell) return 0;
    if (!cell.formula) return numericCellValue(cell);

    evaluating.add(key);
    const result = calculateFormula(cell.formula, sheetIndex, valueAt, sheets);
    evaluating.delete(key);
    cache.set(key, result);
    return result;
  };

  return {
    sheets: sheets.map((sheet, sheetIndex) => ({
      ...sheet,
      rows: sheet.rows.map((row, rowIndex) =>
        row.map((cell, columnIndex) => {
          if (!cell?.formula) return cell;
          const result = valueAt(sheetIndex, rowIndex, columnIndex);
          return {
            ...cell,
            value:
              typeof result === "string" && !cell.input && cell.value
                ? cell.value
                : formatCalculatedValue(result, cell),
            calculationError: typeof result === "string" ? result : undefined,
          };
        }),
      ),
    })),
  };
}

export function cellInputValue(cell: OdsCell | null | undefined) {
  if (!cell) return "";
  return cell.formula || cell.input || cell.value;
}

export function cellFromInput(input: string): OdsCell | null {
  const value = input.trim();
  if (!value) return null;
  if (value.startsWith("=") || value.startsWith("of:=")) {
    return { value: "", kind: "formula", formula: value, input: value };
  }
  if (/^(true|false)$/i.test(value)) {
    return { value: value.toLocaleUpperCase(), kind: "boolean", input: value };
  }
  const numericValue = Number(value.replace(",", "."));
  if (Number.isFinite(numericValue)) {
    return { value, kind: "number", numericValue, input: value };
  }
  return { value: input, kind: "text", input };
}

export function updateWorkbookCell(
  workbook: OdsWorkbook,
  sheetIndex: number,
  rowIndex: number,
  columnIndex: number,
  input: string,
): OdsWorkbook {
  return updateWorkbookCells(workbook, sheetIndex, [
    { rowIndex, columnIndex, input },
  ]);
}

export function updateWorkbookCells(
  workbook: OdsWorkbook,
  sheetIndex: number,
  updates: Array<{ rowIndex: number; columnIndex: number; input: string }>,
): OdsWorkbook {
  if (updates.length === 0) return workbook;
  const sheets = workbook.sheets.map((sheet, index) => {
    if (index !== sheetIndex) return sheet;
    const rows = sheet.rows.map((row) => [...row]);
    let rowCount = sheet.rowCount;
    let columnCount = sheet.columnCount;
    for (const { rowIndex, columnIndex, input } of updates) {
      while (rows.length <= rowIndex) rows.push([]);
      const row = [...rows[rowIndex]];
      while (row.length <= columnIndex) row.push(null);
      row[columnIndex] = cellFromInput(input);
      rows[rowIndex] = row;
      rowCount = Math.max(rowCount, rowIndex + 1);
      columnCount = Math.max(columnCount, columnIndex + 1);
    }
    return {
      ...sheet,
      rows,
      rowCount,
      columnCount,
    };
  });
  return recalculateWorkbook({ sheets });
}

function calculateFormula(
  formula: string,
  currentSheetIndex: number,
  valueAt: (sheetIndex: number, rowIndex: number, columnIndex: number) => CalculationResult,
  sheets: OdsSheet[],
): CalculationResult {
  try {
    return new FormulaParser(normalizeFormula(formula), currentSheetIndex, valueAt, sheets).parse();
  } catch (reason) {
    return typeof reason === "string" && reason.startsWith("#")
      ? reason
      : errorValue("#ERROR!");
  }
}

function normalizeFormula(formula: string) {
  return formula
    .trim()
    .replace(/^of:=?/i, "")
    .replace(/^=/, "")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/\$/g, "")
    .replace(/;/g, ",")
    .replace(/\.([A-Z]+\d+)/gi, "$1");
}

class FormulaParser {
  private position = 0;

  constructor(
    private readonly source: string,
    private readonly currentSheetIndex: number,
    private readonly valueAt: (sheetIndex: number, rowIndex: number, columnIndex: number) => CalculationResult,
    private readonly sheets: OdsSheet[],
  ) {}

  parse() {
    const result = this.expression();
    this.space();
    if (this.position !== this.source.length) throw errorValue("#ERROR!");
    return result;
  }

  private expression(): number {
    let value = this.term();
    while (true) {
      if (this.consume("+")) value += this.term();
      else if (this.consume("-")) value -= this.term();
      else return value;
    }
  }

  private term(): number {
    let value = this.power();
    while (true) {
      if (this.consume("*")) value *= this.power();
      else if (this.consume("/")) {
        const divisor = this.power();
        if (divisor === 0) throw errorValue("#DIV/0!");
        value /= divisor;
      } else if (this.consume("%")) {
        const divisor = this.power();
        if (divisor === 0) throw errorValue("#DIV/0!");
        value %= divisor;
      } else return value;
    }
  }

  private power(): number {
    const value = this.unary();
    return this.consume("^") ? value ** this.power() : value;
  }

  private unary(): number {
    if (this.consume("+")) return this.unary();
    if (this.consume("-")) return -this.unary();
    return this.primary();
  }

  private primary(): number {
    if (this.consume("(")) {
      const value = this.expression();
      this.expect(")");
      return value;
    }
    const number = this.readNumber();
    if (number !== null) return number;

    const identifier = this.readIdentifier();
    if (!identifier) throw errorValue("#ERROR!");
    if (this.consume("(")) return this.functionCall(identifier);
    return this.referenceValue(identifier);
  }

  private functionCall(name: string): number {
    const values: number[] = [];
    if (!this.consume(")")) {
      do {
        values.push(...this.argument());
      } while (this.consume(","));
      this.expect(")");
    }
    switch (name.toLocaleUpperCase()) {
      case "SUM": return values.reduce((total, value) => total + value, 0);
      case "AVERAGE": return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
      case "MIN": return values.length ? Math.min(...values) : 0;
      case "MAX": return values.length ? Math.max(...values) : 0;
      case "COUNT": return values.length;
      case "ABS": return this.singleArgument(values, Math.abs);
      case "ROUND": return this.round(values);
      case "SQRT": return this.singleArgument(values, Math.sqrt);
      case "POWER": return this.twoArguments(values, (left, right) => left ** right);
      case "MOD": return this.twoArguments(values, (left, right) => {
        if (right === 0) throw errorValue("#DIV/0!");
        return left % right;
      });
      default: throw errorValue("#NAME?");
    }
  }

  private argument(): number[] {
    const argumentStart = this.position;
    const reference = this.readIdentifier();
    if (reference && this.consume(":")) {
      const end = this.readIdentifier();
      if (!end) throw errorValue("#REF!");
      return this.rangeValues(reference, end);
    }
    this.position = argumentStart;
    return [this.expression()];
  }

  private rangeValues(start: string, end: string) {
    const startReference = this.resolveReference(start);
    if (!startReference) throw errorValue("#REF!");
    const endReference = this.resolveReference(end, startReference.sheetIndex);
    if (!endReference || startReference.sheetIndex !== endReference.sheetIndex) {
      throw errorValue("#REF!");
    }
    const values: number[] = [];
    for (let row = Math.min(startReference.rowIndex, endReference.rowIndex); row <= Math.max(startReference.rowIndex, endReference.rowIndex); row += 1) {
      for (let column = Math.min(startReference.columnIndex, endReference.columnIndex); column <= Math.max(startReference.columnIndex, endReference.columnIndex); column += 1) {
        values.push(this.referenceNumber(startReference.sheetIndex, row, column));
      }
    }
    return values;
  }

  private referenceValue(reference: string) {
    const location = this.resolveReference(reference);
    if (!location) throw errorValue("#REF!");
    return this.referenceNumber(location.sheetIndex, location.rowIndex, location.columnIndex);
  }

  private referenceNumber(sheetIndex: number, rowIndex: number, columnIndex: number) {
    const value = this.valueAt(sheetIndex, rowIndex, columnIndex);
    if (typeof value === "string") throw value;
    return value;
  }

  private resolveReference(reference: string, defaultSheetIndex = this.currentSheetIndex) {
    const match = /^(?:(.+)\.)?([A-Z]+)(\d+)$/i.exec(reference);
    if (!match) return null;
    const sheetName = match[1]?.replace(/^'(.*)'$/, "$1");
    const sheetIndex = sheetName
      ? this.sheets.findIndex((sheet) => sheet.name === sheetName)
      : defaultSheetIndex;
    if (sheetIndex < 0) return null;
    let columnIndex = 0;
    for (const character of match[2].toLocaleUpperCase()) {
      columnIndex = columnIndex * 26 + character.charCodeAt(0) - 64;
    }
    return { sheetIndex, rowIndex: Number(match[3]) - 1, columnIndex: columnIndex - 1 };
  }

  private singleArgument(values: number[], operation: (value: number) => number) {
    if (values.length !== 1) throw errorValue("#ERROR!");
    const result = operation(values[0]);
    if (!Number.isFinite(result)) throw errorValue("#NUM!");
    return result;
  }

  private twoArguments(values: number[], operation: (left: number, right: number) => number) {
    if (values.length !== 2) throw errorValue("#ERROR!");
    const result = operation(values[0], values[1]);
    if (!Number.isFinite(result)) throw errorValue("#NUM!");
    return result;
  }

  private round(values: number[]) {
    if (values.length < 1 || values.length > 2) throw errorValue("#ERROR!");
    const digits = values[1] ?? 0;
    const factor = 10 ** digits;
    return Math.round((values[0] + Number.EPSILON) * factor) / factor;
  }

  private readNumber() {
    this.space();
    const match = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(this.source.slice(this.position));
    if (!match) return null;
    this.position += match[0].length;
    return Number(match[0]);
  }

  private readIdentifier() {
    this.space();
    const match = /^(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|[A-Za-z]+\d+))?/.exec(this.source.slice(this.position));
    if (!match) return "";
    this.position += match[0].length;
    return match[0];
  }

  private consume(token: string) {
    this.space();
    if (!this.source.startsWith(token, this.position)) return false;
    this.position += token.length;
    return true;
  }

  private expect(token: string) {
    if (!this.consume(token)) throw errorValue("#ERROR!");
  }

  private space() {
    while (/\s/.test(this.source[this.position] || "")) this.position += 1;
  }
}

function numericCellValue(cell: OdsCell): number {
  if (typeof cell.numericValue === "number") return cell.numericValue;
  const parsed = Number(cell.value.replace(/[^0-9eE+.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCalculatedValue(result: CalculationResult, cell: OdsCell) {
  if (typeof result === "string") return result;
  if (cell.currency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cell.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(result);
  }
  if (cell.numberFormat === "percentage") {
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(result);
  }
  return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(12)));
}
