import type { KnowledgeBase } from "../types";
import { fetchGeneratedJson, validateKnowledgeBase } from "./generatedData";

export async function fetchKnowledgeBase(
  fetchImpl: typeof fetch = fetch,
): Promise<KnowledgeBase> {
  return fetchGeneratedJson("/generated/catalog.json", validateKnowledgeBase, {
    fetchImpl,
    label: "Knowledge-base catalog",
  });
}
