import { recalculateWorkbook } from "./calculations";

const tableNamespace = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
const officeNamespace = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const textNamespace = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";

const endOfCentralDirectorySignature = 0x06054b50;
const centralDirectoryEntrySignature = 0x02014b50;
const localFileHeaderSignature = 0x04034b50;
const maxEndOfCentralDirectorySearch = 65_557;
const maxArchiveBytes = 50 * 1024 * 1024;
const maxContentXmlBytes = 32 * 1024 * 1024;
const maxPreviewRows = 500;
const maxPreviewColumns = 64;
const maxRepeat = 1_048_576;

export type OdsCellKind =
  | "text"
  | "number"
  | "currency"
  | "percentage"
  | "date"
  | "time"
  | "boolean"
  | "formula"
  | "error";

export interface OdsCell {
  value: string;
  kind: OdsCellKind;
  /** The ODS or user-entered formula, kept separately from its visible result. */
  formula?: string;
  /** The unformatted numeric value from ODS, when available. */
  numericValue?: number;
  currency?: string;
  numberFormat?: "percentage";
  input?: string;
  calculationError?: string;
}

export interface OdsSheet {
  name: string;
  rows: Array<Array<OdsCell | null>>;
  rowCount: number;
  columnCount: number;
  truncated: boolean;
}

export interface OdsWorkbook {
  sheets: OdsSheet[];
}

/**
 * Creates a small, standards-compatible ODS archive for the editable preview.
 * It deliberately uses stored ZIP entries so it works in every Castle runtime.
 */
export function createOdsArchive(workbook: OdsWorkbook): ArrayBuffer {
  const encoder = new TextEncoder();
  const mimeType = "application/vnd.oasis.opendocument.spreadsheet";
  const entries = [
    { name: "mimetype", bytes: encoder.encode(mimeType) },
    { name: "content.xml", bytes: encoder.encode(serializeOdsContentXml(workbook)) },
    {
      name: "META-INF/manifest.xml",
      bytes: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mimeType}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`),
    },
  ];
  return createStoredZip(entries).buffer;
}

export function serializeOdsContentXml(workbook: OdsWorkbook) {
  const sheets = workbook.sheets
    .map((sheet) => {
      const rows = Array.from({ length: sheet.rowCount }, (_, rowIndex) => {
        const row = sheet.rows[rowIndex] ?? [];
        const cells = Array.from({ length: sheet.columnCount }, (_, columnIndex) =>
          serializeOdsCell(row[columnIndex]),
        ).join("");
        return `<table:table-row>${cells}</table:table-row>`;
      }).join("");
      return `<table:table table:name="${escapeXml(sheet.name)}">${rows}</table:table>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content xmlns:office="${officeNamespace}" xmlns:table="${tableNamespace}" xmlns:text="${textNamespace}" office:version="1.3"><office:body><office:spreadsheet>${sheets}</office:spreadsheet></office:body></office:document-content>`;
}

function serializeOdsCell(cell: OdsCell | null | undefined) {
  if (!cell) return "<table:table-cell/>";
  const text = `<text:p>${escapeXml(cell.value)}</text:p>`;
  if (cell.formula) {
    const formula = cell.formula.startsWith("of:")
      ? cell.formula
      : `of:=${cell.formula.replace(/^=/, "")}`;
    const numericValue = Number(cell.value);
    const valueAttributes = Number.isFinite(numericValue)
      ? ` office:value-type="float" office:value="${numericValue}"`
      : ' office:value-type="string"';
    return `<table:table-cell table:formula="${escapeXml(formula)}"${valueAttributes}>${text}</table:table-cell>`;
  }
  if (cell.kind === "boolean") {
    const value = /^true$/i.test(cell.value) ? "true" : "false";
    return `<table:table-cell office:value-type="boolean" office:boolean-value="${value}">${text}</table:table-cell>`;
  }
  if (cell.kind === "number" && Number.isFinite(cell.numericValue)) {
    return `<table:table-cell office:value-type="float" office:value="${cell.numericValue}">${text}</table:table-cell>`;
  }
  return `<table:table-cell office:value-type="string">${text}</table:table-cell>`;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!,
  );
}

function createStoredZip(entries: Array<{ name: string; bytes: Uint8Array }>) {
  const encoder = new TextEncoder();
  const localEntries: Uint8Array[] = [];
  const centralEntries: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.length + entry.bytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, localFileHeaderSignature, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.bytes.length, true);
    localView.setUint32(22, entry.bytes.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.length);
    localEntries.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, centralDirectoryEntrySignature, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.bytes.length, true);
    centralView.setUint32(24, entry.bytes.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralEntries.push(central);
    offset += local.length;
  }
  const centralSize = centralEntries.reduce((size, entry) => size + entry.length, 0);
  const archive = new Uint8Array(offset + centralSize + 22);
  let archiveOffset = 0;
  for (const entry of localEntries) { archive.set(entry, archiveOffset); archiveOffset += entry.length; }
  for (const entry of centralEntries) { archive.set(entry, archiveOffset); archiveOffset += entry.length; }
  const end = new DataView(archive.buffer, archiveOffset, 22);
  end.setUint32(0, endOfCentralDirectorySignature, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return archive;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function parseOdsFile(file: File): Promise<OdsWorkbook> {
  if (!file.name.toLocaleLowerCase().endsWith(".ods")) {
    throw new Error("Choose an OpenDocument Spreadsheet (.ods) file.");
  }
  if (file.size > maxArchiveBytes) {
    throw new Error("This spreadsheet is larger than the 50 MB preview limit.");
  }

  return parseOdsArrayBuffer(await file.arrayBuffer());
}

export async function parseOdsArrayBuffer(
  archive: ArrayBuffer,
): Promise<OdsWorkbook> {
  const contentXml = await readZipTextEntry(archive, "content.xml");
  return parseOdsContentXml(contentXml);
}

export function parseOdsContentXml(contentXml: string): OdsWorkbook {
  const documentNode = new DOMParser().parseFromString(
    contentXml,
    "application/xml",
  );
  if (
    documentNode.documentElement.localName === "parsererror" ||
    documentNode.getElementsByTagName("parsererror").length > 0
  ) {
    throw new Error("The spreadsheet contains invalid OpenDocument XML.");
  }

  const sheetNodes = Array.from(
    documentNode.getElementsByTagNameNS(tableNamespace, "table"),
  );
  if (sheetNodes.length === 0) {
    throw new Error("The ODS file does not contain any sheets.");
  }

  return recalculateWorkbook({
    sheets: sheetNodes.map((sheetNode, index) =>
      parseSheet(
        sheetNode,
        sheetNode.getAttributeNS(tableNamespace, "name") ||
          `Sheet ${index + 1}`,
      ),
    ),
  });
}

async function readZipTextEntry(
  archive: ArrayBuffer,
  requestedName: string,
): Promise<string> {
  if (archive.byteLength > maxArchiveBytes) {
    throw new Error("This spreadsheet is larger than the 50 MB preview limit.");
  }

  const bytes = new Uint8Array(archive);
  const view = new DataView(archive);
  const centralDirectoryOffset = findCentralDirectoryOffset(view);
  let offset = centralDirectoryOffset;

  while (
    offset + 46 <= bytes.length &&
    view.getUint32(offset, true) === centralDirectoryEntrySignature
  ) {
    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    assertRange(fileNameStart, fileNameLength, bytes.length);
    const fileName = new TextDecoder().decode(
      bytes.subarray(fileNameStart, fileNameEnd),
    );

    if (fileName === requestedName) {
      if ((flags & 0x1) !== 0) {
        throw new Error("Password-protected ODS files cannot be previewed.");
      }
      if (uncompressedSize > maxContentXmlBytes) {
        throw new Error("The spreadsheet content exceeds the preview limit.");
      }
      const entry = await decompressZipEntry(
        bytes,
        view,
        localHeaderOffset,
        compressedSize,
        uncompressedSize,
        compressionMethod,
      );
      return new TextDecoder().decode(entry);
    }

    offset = fileNameEnd + extraLength + commentLength;
  }

  throw new Error("The ODS file is missing content.xml.");
}

function findCentralDirectoryOffset(view: DataView) {
  const firstCandidate = Math.max(
    0,
    view.byteLength - maxEndOfCentralDirectorySearch,
  );
  for (let offset = view.byteLength - 22; offset >= firstCandidate; offset -= 1) {
    if (view.getUint32(offset, true) === endOfCentralDirectorySignature) {
      const centralDirectoryOffset = view.getUint32(offset + 16, true);
      if (centralDirectoryOffset >= view.byteLength) break;
      return centralDirectoryOffset;
    }
  }
  throw new Error("This file is not a valid ODS archive.");
}

async function decompressZipEntry(
  bytes: Uint8Array,
  view: DataView,
  localHeaderOffset: number,
  compressedSize: number,
  uncompressedSize: number,
  compressionMethod: number,
) {
  assertRange(localHeaderOffset, 30, bytes.length);
  if (view.getUint32(localHeaderOffset, true) !== localFileHeaderSignature) {
    throw new Error("The ODS archive has an invalid file entry.");
  }
  const fileNameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraLength = view.getUint16(localHeaderOffset + 28, true);
  const contentOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
  assertRange(contentOffset, compressedSize, bytes.length);
  const compressed = bytes.slice(contentOffset, contentOffset + compressedSize);

  if (compressionMethod === 0) {
    if (uncompressedSize > 0 && compressed.byteLength !== uncompressedSize) {
      throw new Error("The ODS archive has an invalid content entry.");
    }
    return compressed;
  }
  if (compressionMethod !== 8) {
    throw new Error("This ODS file uses an unsupported ZIP compression method.");
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("ODS compression is not supported in this browser.");
  }

  const decompressedStream = new Blob([compressed]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  const decompressed = new Uint8Array(
    await new Response(decompressedStream).arrayBuffer(),
  );
  if (
    decompressed.byteLength > maxContentXmlBytes ||
    (uncompressedSize > 0 && decompressed.byteLength !== uncompressedSize)
  ) {
    throw new Error("The ODS archive has an invalid content entry.");
  }
  return decompressed;
}

function assertRange(offset: number, length: number, total: number) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > total
  ) {
    throw new Error("The ODS archive is truncated or invalid.");
  }
}

function parseSheet(sheetNode: Element, name: string): OdsSheet {
  const rows: Array<Array<OdsCell | null>> = [];
  let logicalRowIndex = 0;
  let rowCount = 0;
  let columnCount = 0;
  let truncated = false;
  const rowNodes = Array.from(
    sheetNode.getElementsByTagNameNS(tableNamespace, "table-row"),
  ).filter((rowNode) => nearestTable(rowNode) === sheetNode);

  for (const rowNode of rowNodes) {
    const rowRepeat = readRepeat(rowNode, "number-rows-repeated");
    const parsedRow = parseRow(rowNode);
    if (parsedRow.hasContent) {
      rowCount = Math.max(rowCount, logicalRowIndex + rowRepeat);
      columnCount = Math.max(columnCount, parsedRow.columnCount);
      if (parsedRow.truncated) truncated = true;

      const previewEnd = Math.min(
        logicalRowIndex + rowRepeat,
        maxPreviewRows,
      );
      if (logicalRowIndex < maxPreviewRows) {
        while (rows.length < logicalRowIndex) rows.push([]);
        for (
          let previewIndex = logicalRowIndex;
          previewIndex < previewEnd;
          previewIndex += 1
        ) {
          rows[previewIndex] = parsedRow.cells;
        }
      }
      if (logicalRowIndex + rowRepeat > maxPreviewRows) truncated = true;
    }
    logicalRowIndex = Math.min(
      logicalRowIndex + rowRepeat,
      Number.MAX_SAFE_INTEGER,
    );
  }

  return { name, rows, rowCount, columnCount, truncated };
}

function parseRow(rowNode: Element) {
  const cells: Array<OdsCell | null> = [];
  let logicalColumnIndex = 0;
  let columnCount = 0;
  let hasContent = false;
  let truncated = false;

  for (const childNode of Array.from(rowNode.childNodes)) {
    if (childNode.nodeType !== 1) continue;
    const cellNode = childNode as Element;
    if (
      cellNode.namespaceURI !== tableNamespace ||
      !["table-cell", "covered-table-cell"].includes(cellNode.localName)
    ) {
      continue;
    }
    const columnRepeat = readRepeat(cellNode, "number-columns-repeated");
    const cell = parseCell(cellNode);
    if (cell) {
      hasContent = true;
      columnCount = Math.max(columnCount, logicalColumnIndex + columnRepeat);
      const previewEnd = Math.min(
        logicalColumnIndex + columnRepeat,
        maxPreviewColumns,
      );
      if (logicalColumnIndex < maxPreviewColumns) {
        while (cells.length < logicalColumnIndex) cells.push(null);
        for (
          let previewIndex = logicalColumnIndex;
          previewIndex < previewEnd;
          previewIndex += 1
        ) {
          cells[previewIndex] = cell;
        }
      }
      if (logicalColumnIndex + columnRepeat > maxPreviewColumns) {
        truncated = true;
      }
    }
    logicalColumnIndex = Math.min(
      logicalColumnIndex + columnRepeat,
      Number.MAX_SAFE_INTEGER,
    );
  }

  return { cells, columnCount, hasContent, truncated };
}

function parseCell(cellNode: Element): OdsCell | null {
  const formula = cellNode.getAttributeNS(tableNamespace, "formula") || "";
  const valueType =
    cellNode.getAttributeNS(officeNamespace, "value-type") || "";
  const text = extractCellText(cellNode);
  const fallback = readCellFallback(cellNode, valueType, formula);
  const value = text || fallback;
  if (!value && !formula) return null;

  const numericValue = Number(
    cellNode.getAttributeNS(officeNamespace, "value"),
  );
  const currency = cellNode.getAttributeNS(officeNamespace, "currency") || undefined;
  return {
    value: value || formula.replace(/^of:/, ""),
    kind: formula
      ? "formula"
      : valueType === "currency"
        ? "currency"
        : valueType === "percentage"
          ? "percentage"
          : valueType === "float"
        ? "number"
        : valueType === "date"
          ? "date"
          : valueType === "time"
            ? "time"
          : valueType === "boolean"
            ? "boolean"
            : valueType === "error"
              ? "error"
            : "text",
    formula: formula || undefined,
    numericValue: Number.isFinite(numericValue) ? numericValue : undefined,
    currency,
    numberFormat: valueType === "percentage" ? "percentage" : undefined,
  };
}

function extractCellText(cellNode: Element) {
  return Array.from(cellNode.getElementsByTagNameNS(textNamespace, "p"))
    .map((paragraph) => extractTextNode(paragraph).trim())
    .filter(Boolean)
    .join("\n");
}

function extractTextNode(node: Node): string {
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  if (element.namespaceURI === textNamespace) {
    if (element.localName === "s") {
      return " ".repeat(readRepeat(element, "c", textNamespace));
    }
    if (element.localName === "tab") return "\t";
    if (element.localName === "line-break") return "\n";
  }
  return Array.from(element.childNodes).map(extractTextNode).join("");
}

function readCellFallback(
  cellNode: Element,
  valueType: string,
  formula: string,
) {
  if (valueType === "boolean") {
    const value = cellNode.getAttributeNS(officeNamespace, "boolean-value");
    return value === "true" ? "TRUE" : value === "false" ? "FALSE" : "";
  }
  const attribute =
    valueType === "date"
      ? "date-value"
      : valueType === "time"
        ? "time-value"
        : valueType === "string"
          ? "string-value"
          : "value";
  return (
    cellNode.getAttributeNS(officeNamespace, attribute) ||
    formula.replace(/^of:/, "")
  );
}

function readRepeat(
  node: Element,
  attribute: string,
  namespace = tableNamespace,
) {
  const parsed = Number.parseInt(
    node.getAttributeNS(namespace, attribute) || "1",
    10,
  );
  return Number.isSafeInteger(parsed)
    ? Math.min(Math.max(parsed, 1), maxRepeat)
    : 1;
}

function nearestTable(node: Element) {
  let parent = node.parentNode;
  while (parent) {
    if (parent.nodeType === 1) {
      const element = parent as Element;
      if (
        element.namespaceURI === tableNamespace &&
        element.localName === "table"
      ) {
        return element;
      }
    }
    parent = parent.parentNode;
  }
  return null;
}

export function spreadsheetColumnLabel(columnIndex: number) {
  let label = "";
  let remaining = columnIndex + 1;
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return label;
}
