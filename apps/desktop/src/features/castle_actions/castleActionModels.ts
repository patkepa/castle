import type { IconName } from "@patkepa/kantzen-ui/primitives";

export interface CastlePaletteActionInput {
  label: string;
  placeholder: string;
  submitLabel: string;
}

export interface CastlePaletteAction {
  id: string;
  label: string;
  description: string;
  icon: IconName;
  keywords: readonly string[];
  input?: CastlePaletteActionInput;
  execute: (input: string) => void | Promise<void>;
}

interface ActionHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const actionHistoryStorageKey = "castle.recent-actions.v1";
const maximumRecentActions = 6;

export function rankCastleActions(
  query: string,
  actions: readonly CastlePaletteAction[],
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...actions];
  const queryParts = normalizedQuery.split(/\s+/u);

  return actions
    .flatMap((action) => {
      const label = action.label.toLocaleLowerCase();
      const description = action.description.toLocaleLowerCase();
      const keywords = action.keywords.join(" ").toLocaleLowerCase();
      const searchable = `${label} ${description} ${keywords}`;
      if (!queryParts.every((part) => searchable.includes(part))) return [];

      const score = label === normalizedQuery
        ? 300
        : label.startsWith(normalizedQuery)
          ? 200
          : label.includes(normalizedQuery)
            ? 100
            : queryParts.reduce(
                (total, part) => total + (label.includes(part) ? 20 : 5),
                0,
              );
      return [{ action, score }];
    })
    .sort((left, right) =>
      right.score - left.score || left.action.label.localeCompare(right.action.label)
    )
    .map(({ action }) => action);
}

export function readRecentCastleActionIds(
  storage: ActionHistoryStorage | null = browserStorage(),
) {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(actionHistoryStorageKey) ?? "[]",
    );
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter(
          (value): value is string => typeof value === "string" && value.length <= 128,
        ))].slice(0, maximumRecentActions)
      : [];
  } catch {
    return [];
  }
}

export function recordRecentCastleAction(
  actionId: string,
  recentActionIds: readonly string[],
  storage: ActionHistoryStorage | null = browserStorage(),
) {
  const next = [
    actionId,
    ...recentActionIds.filter((candidate) => candidate !== actionId),
  ].slice(0, maximumRecentActions);
  try {
    storage?.setItem(actionHistoryStorageKey, JSON.stringify(next));
  } catch {
    // Recent actions are an optional device-local convenience.
  }
  return next;
}

function browserStorage(): ActionHistoryStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}
