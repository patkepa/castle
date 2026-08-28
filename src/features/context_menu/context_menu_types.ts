import type { IconName } from "@patkepa/kantzen-ui/primitives";

export type CastleContextMenuOperation =
  | { type: "navigate"; to: string; newTab?: boolean }
  | { type: "copy"; value: string; feedback: string }
  | { type: "copy-route"; route: string; feedback: string }
  | {
      type: "move-source";
      mode: "move" | "rename";
      noteId: string;
      sourceFile: string;
      route: string;
    }
  | { type: "callback"; execute: () => void };

interface CastleContextMenuActionBase {
  id: string;
  label: string;
  icon?: IconName;
  intent?: "danger";
  disabled?: boolean;
}

export type CastleContextMenuAction = CastleContextMenuActionBase &
  (
    | {
        operation: CastleContextMenuOperation;
        children?: never;
      }
    | {
        operation?: never;
        children: CastleContextMenuAction[];
      }
  );

export interface CastleContextMenuGroup {
  id: string;
  actions: CastleContextMenuAction[];
}

export interface CastleContextMenuModel {
  kind: string;
  subject: string;
  groups: CastleContextMenuGroup[];
}

export interface CastleContextMenuPoint {
  left: number;
  top: number;
}
