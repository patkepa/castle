import { fetchGeneratedJson } from "../../lib/generatedData";

export interface GeneratedCanvas {
  relativePath: string;
  name: string;
  size: number;
  modifiedAt: string;
  contentPath: string;
}

interface GeneratedCanvasCatalog {
  generatedAt: string;
  canvases: GeneratedCanvas[];
}

export async function fetchGeneratedCanvasCatalog() {
  const catalog = await fetchGeneratedJson(
    "/generated/canvases/catalog.json",
    validateGeneratedCanvasCatalog,
    { label: "Generated canvas catalog" },
  );
  return catalog.canvases;
}

function validateGeneratedCanvasCatalog(
  value: unknown,
): asserts value is GeneratedCanvasCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Castle received an invalid generated canvas catalog.");
  }
  const catalog = value as Record<string, unknown>;
  if (typeof catalog.generatedAt !== "string" || !Array.isArray(catalog.canvases)) {
    throw new Error("Castle received an invalid generated canvas catalog.");
  }
  for (const candidate of catalog.canvases) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Castle received an invalid generated canvas.");
    }
    const canvas = candidate as Record<string, unknown>;
    if (
      typeof canvas.relativePath !== "string" ||
      typeof canvas.name !== "string" ||
      typeof canvas.size !== "number" ||
      !Number.isSafeInteger(canvas.size) ||
      canvas.size < 0 ||
      typeof canvas.modifiedAt !== "string" ||
      typeof canvas.contentPath !== "string" ||
      !/^\/generated\/canvases\/files\/[a-f0-9]{64}\.canvas$/.test(canvas.contentPath)
    ) {
      throw new Error("Castle received an invalid generated canvas.");
    }
  }
}
