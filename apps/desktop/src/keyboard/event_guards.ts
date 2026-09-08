import {
  hasOpenBlockingOverlay,
  isEditableTarget,
} from "@patkepa/kantzen-ui/interactions";

export interface KeyboardEventGuardOptions {
  allowInEditable?: boolean;
  allowWhenOverlayOpen?: boolean;
}

export function shouldIgnoreShortcutEvent(
  event: KeyboardEvent,
  options: KeyboardEventGuardOptions = {},
) {
  return (
    event.defaultPrevented ||
    event.isComposing ||
    (!options.allowInEditable && isEditableTarget(event.target)) ||
    (!options.allowWhenOverlayOpen && hasOpenBlockingOverlay())
  );
}
