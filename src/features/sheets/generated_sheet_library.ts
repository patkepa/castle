import { fetchGeneratedJson } from "../../lib/generatedData";

export interface GeneratedSheet {
  relativePath: string;
  name: string;
  size: number;
  modifiedAt: string;
  contentPath: string;
}

interface GeneratedSheetCatalog {
  generatedAt: string;
  sheets: GeneratedSheet[];
}

const generatedSheetCatalogPath = "/generated/sheets/catalog.json";

export async function fetchGeneratedSheetCatalog() {
  const catalog = await fetchGeneratedJson(
    generatedSheetCatalogPath,
    validateGeneratedSheetCatalog,
    { label: "Generated sheets catalog" },
  );
  return catalog.sheets;
}

function validateGeneratedSheetCatalog(
  value: unknown,
): asserts value is GeneratedSheetCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle received an invalid generated sheets catalog.");
  }
  const catalog = value as Record<string, unknown>;
  if (typeof catalog.generatedAt !== "string" || !Array.isArray(catalog.sheets)) {
    throw new Error("Castle received an invalid generated sheets catalog.");
  }
  for (const candidate of catalog.sheets) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Castle received an invalid generated sheet.");
    }
    const sheet = candidate as Record<string, unknown>;
    if (
      typeof sheet.relativePath !== "string" ||
      typeof sheet.name !== "string" ||
      typeof sheet.size !== "number" ||
      !Number.isSafeInteger(sheet.size) ||
      sheet.size < 0 ||
      typeof sheet.modifiedAt !== "string" ||
      typeof sheet.contentPath !== "string" ||
      !/^\/generated\/sheets\/files\/[a-f0-9]{64}\.ods$/.test(sheet.contentPath)
    ) {
      throw new Error("Castle received an invalid generated sheet.");
    }
  }
}
