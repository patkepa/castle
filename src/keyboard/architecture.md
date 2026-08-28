# Castle keyboard architecture

Keyboard behavior is owned by the narrowest mounted scope that can interpret
it correctly.

## Ownership

- Castle-owned app shortcuts live in `shortcut_catalog.ts` and are bound
  through `use_keyboard_shortcut.ts`.
- Focus-region and sidebar bindings implemented inside `WorkspaceShell` remain
  shell-owned; Castle mirrors their metadata in the catalog for its own UI.
- Page shortcuts live in a feature-owned `*_page_keyboard_navigation.ts` hook.
- Composite widgets such as grids, lists, trees, and boards keep their policy
  in a feature-owned `*_keyboard_navigation.ts` hook and attach one delegated
  `onKeyDown` handler to their container.
- Pure movement calculations, focus helpers, and event guards live in this
  directory. They must not import feature code.

## Event priority

The effective priority is: blocking overlay, editable control, focused
composite widget, mounted page, then app shell. A handler calls
`preventDefault()` only after it has resolved a valid action. Directional keys
must never be registered on `window` or `document`.

## Adding navigation

1. Add or reuse a pure calculation in `navigation_math.ts`.
2. Create a feature-owned hook containing that page or widget's selectors and
   meaning for each key.
3. Attach the returned handler to the smallest container that owns the items.
4. Keep activation native with a link or button whenever possible.
5. Add pure calculation tests, shortcut catalog tests when applicable, and a
   rendered component contract test.

Shortcut labels, display keys, and `aria-keyshortcuts` values in Castle-owned
components must come from `shortcut_catalog.ts`; do not repeat shortcut strings
in components.
