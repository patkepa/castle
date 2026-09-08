import type { IconName } from "@patkepa/kantzen-ui/primitives";

export const navigationTabs = [
  {
    id: "tasks",
    label: "Tasks",
    description: "Show Tasks in the sidebar",
    icon: "tick-circle",
    href: "/tasks",
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Show Calendar in the sidebar",
    icon: "calendar",
    href: "/calendar",
  },
  {
    id: "canvas",
    label: "Canvas",
    description: "Show Canvas in the sidebar",
    icon: "grid-view",
    href: "/canvas",
  },
  {
    id: "stash",
    label: "Stash",
    description: "Show Stash in the sidebar",
    icon: "inbox",
    href: "/browse/stash",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  description: string;
  icon: IconName;
  href: string;
}[];

export type NavigationTabId = (typeof navigationTabs)[number]["id"];

const navigationVisibilityStorageKey = "castle.navigation-visibility.v1";
const navigationTabIds = new Set<NavigationTabId>(
  navigationTabs.map((tab) => tab.id),
);

export function getVisibleNavigationTabs(
  hiddenTabs: ReadonlySet<NavigationTabId>,
) {
  return navigationTabs.filter((tab) => !hiddenTabs.has(tab.id));
}

export function readHiddenNavigationTabs(): Set<NavigationTabId> {
  try {
    return parseHiddenNavigationTabs(
      window.localStorage.getItem(navigationVisibilityStorageKey),
    );
  } catch {
    return new Set();
  }
}

export function writeHiddenNavigationTabs(
  hiddenTabs: ReadonlySet<NavigationTabId>,
) {
  try {
    window.localStorage.setItem(
      navigationVisibilityStorageKey,
      JSON.stringify([...hiddenTabs]),
    );
  } catch {
    // The visibility still applies for the current session when storage is unavailable.
  }
}

export function parseHiddenNavigationTabs(
  storedValue: string | null,
): Set<NavigationTabId> {
  if (!storedValue) return new Set();

  try {
    const stored = JSON.parse(storedValue) as unknown;
    if (!Array.isArray(stored)) return new Set();

    return new Set(
      stored.filter(
        (tabId): tabId is NavigationTabId =>
          typeof tabId === "string" &&
          navigationTabIds.has(tabId as NavigationTabId),
      ),
    );
  } catch {
    return new Set();
  }
}
