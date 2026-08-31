import {
  prepareSearchEntries,
  rankSearchResults,
  type RankedSearchResult,
  type SearchableNote,
} from "../lib/noteSearch";
import type { SearchIndex } from "../types";

interface InitializeMessage {
  type: "initialize";
  notes: SearchableNote[];
}

interface SearchMessage {
  type: "search";
  query: string;
  requestId: number;
}

interface SearchResultMessage {
  type: "result";
  requestId: number;
  results: RankedSearchResult[];
}

interface SearchErrorMessage {
  type: "error";
  requestId: number;
  message: string;
}

type IncomingMessage = InitializeMessage | SearchMessage;
type OutgoingMessage = SearchResultMessage | SearchErrorMessage;

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<IncomingMessage>) => void) | null;
  postMessage(message: OutgoingMessage): void;
};
let notesById = new Map<string, SearchableNote>();
let preparedIndex: ReturnType<typeof prepareSearchEntries> | null = null;
let indexRequest: Promise<ReturnType<typeof prepareSearchEntries>> | null = null;

workerScope.onmessage = (event) => {
  if (event.data.type === "initialize") {
    notesById = new Map(event.data.notes.map((note) => [note.id, note]));
    return;
  }
  void search(event.data);
};

async function search(message: SearchMessage) {
  try {
    const entries = await loadPreparedIndex();
    workerScope.postMessage({
      type: "result",
      requestId: message.requestId,
      results: rankSearchResults(message.query, entries, notesById),
    });
  } catch (reason) {
    workerScope.postMessage({
      type: "error",
      requestId: message.requestId,
      message: reason instanceof Error ? reason.message : String(reason),
    });
  }
}

function loadPreparedIndex() {
  if (preparedIndex) return Promise.resolve(preparedIndex);
  indexRequest ??= fetch(`${import.meta.env.BASE_URL}generated/search-index.json`, {
    cache: "no-cache",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Search index returned ${response.status}`);
      const value: unknown = await response.json();
      const index = parseSearchIndex(value);
      preparedIndex = prepareSearchEntries(index.entries);
      return preparedIndex;
    })
    .catch((reason) => {
      indexRequest = null;
      throw reason;
    });
  return indexRequest;
}

function parseSearchIndex(value: unknown): SearchIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Search index has an invalid shape");
  }
  const index = value as Record<string, unknown>;
  if (typeof index.generatedAt !== "string" || !Array.isArray(index.entries)) {
    throw new Error("Search index has an invalid shape");
  }
  const entries = index.entries.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Search index contains an invalid entry");
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== "string" || typeof entry.text !== "string") {
      throw new Error("Search index contains an invalid entry");
    }
    return { id: entry.id, text: entry.text };
  });
  return { generatedAt: index.generatedAt, entries };
}
