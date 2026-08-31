export type ShortcutScope = "app" | "page";

export interface ShortcutBinding {
  key: string;
  alt?: boolean;
  metaOrControl?: boolean;
  shift?: boolean;
}

export interface ShortcutDefinition {
  ariaKeyShortcuts: string;
  bindings: readonly ShortcutBinding[];
  displayKeys: readonly string[];
  label: string;
  scope: ShortcutScope;
  allowInEditable?: boolean;
  allowRepeat?: boolean;
  allowWhenOverlayOpen?: boolean;
}

export const shortcutCatalog = {
  search: {
    ariaKeyShortcuts: "Meta+K Control+K",
    bindings: [{ key: "k", metaOrControl: true }],
    displayKeys: ["⌘", "K"],
    label: "Search",
    scope: "app",
    allowInEditable: true,
  },
  sidebar: {
    ariaKeyShortcuts: "Meta+B Control+B",
    bindings: [{ key: "b", metaOrControl: true }],
    displayKeys: ["⌘", "B"],
    label: "Sidebar",
    scope: "app",
  },
  castleAi: {
    ariaKeyShortcuts: "Meta+Shift+B Control+Shift+B",
    bindings: [{ key: "b", metaOrControl: true, shift: true }],
    displayKeys: ["⌘", "⇧", "B"],
    label: "Castle AI",
    scope: "app",
  },
  focusSidebar: {
    ariaKeyShortcuts: "F6",
    bindings: [{ key: "F6" }],
    displayKeys: ["F6"],
    label: "Focus sidebar",
    scope: "app",
  },
  moveFocusRegion: {
    ariaKeyShortcuts: "Shift+ArrowLeft Shift+ArrowRight",
    bindings: [
      { key: "ArrowLeft", shift: true },
      { key: "ArrowRight", shift: true },
    ],
    displayKeys: ["⇧", "← / →"],
    label: "Move focus region",
    scope: "app",
  },
  tasksSearch: {
    ariaKeyShortcuts: "/",
    bindings: [{ key: "/" }],
    displayKeys: ["/"],
    label: "Search tasks",
    scope: "page",
  },
  playlistFullscreen: {
    ariaKeyShortcuts: "F",
    bindings: [{ key: "f" }],
    displayKeys: ["F"],
    label: "Toggle playlist fullscreen",
    scope: "page",
  },
  relationshipSearch: {
    ariaKeyShortcuts: "Meta+F Control+F",
    bindings: [{ key: "f", metaOrControl: true }],
    displayKeys: ["⌘", "F"],
    label: "Search relationships",
    scope: "page",
    allowInEditable: true,
  },
  relationshipToggleSimulation: {
    ariaKeyShortcuts: "Space",
    bindings: [{ key: " " }],
    displayKeys: ["Space"],
    label: "Toggle graph simulation",
    scope: "page",
  },
  relationshipFitGraph: {
    ariaKeyShortcuts: "0",
    bindings: [{ key: "0" }],
    displayKeys: ["0"],
    label: "Fit relationship graph",
    scope: "page",
  },
  relationshipZoomIn: {
    ariaKeyShortcuts: "+ =",
    bindings: [
      { key: "+", shift: true },
      { key: "=" },
    ],
    displayKeys: ["+"],
    label: "Zoom in relationship graph",
    scope: "page",
    allowRepeat: true,
  },
  relationshipZoomOut: {
    ariaKeyShortcuts: "-",
    bindings: [{ key: "-" }],
    displayKeys: ["−"],
    label: "Zoom out relationship graph",
    scope: "page",
    allowRepeat: true,
  },
  relationshipEscape: {
    ariaKeyShortcuts: "Escape",
    bindings: [{ key: "Escape" }],
    displayKeys: ["Esc"],
    label: "Clear relationship selection",
    scope: "page",
  },
} as const satisfies Record<string, ShortcutDefinition>;

export type ShortcutId = keyof typeof shortcutCatalog;

export const settingsShortcutIds = [
  "search",
  "sidebar",
  "castleAi",
  "focusSidebar",
  "moveFocusRegion",
] as const satisfies readonly ShortcutId[];

export function matchesShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  shortcutId: ShortcutId,
) {
  return shortcutCatalog[shortcutId].bindings.some((binding) =>
    matchesBinding(event, binding),
  );
}

export function shortcutDisplayText(shortcutId: ShortcutId) {
  return shortcutCatalog[shortcutId].displayKeys.join("");
}

function matchesBinding(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  binding: ShortcutBinding,
) {
  const normalizedKey = event.key.length === 1
    ? event.key.toLocaleLowerCase()
    : event.key;
  const bindingKey = binding.key.length === 1
    ? binding.key.toLocaleLowerCase()
    : binding.key;
  const modifierMatches = binding.metaOrControl
    ? event.metaKey || event.ctrlKey
    : !event.metaKey && !event.ctrlKey;

  return (
    normalizedKey === bindingKey &&
    modifierMatches &&
    event.shiftKey === Boolean(binding.shift) &&
    event.altKey === Boolean(binding.alt)
  );
}
