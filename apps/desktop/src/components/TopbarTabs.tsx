import { WorkspacePortal } from "@patkepa/kantzen-ui/app-shell";
import { Tabs } from "@patkepa/kantzen-ui";

export interface TopbarTab<TId extends string = string> {
  id: TId;
  label: string;
}

interface TopbarTabsProps<TId extends string> {
  tabs: readonly TopbarTab<TId>[];
  selectedId: TId;
  onSelect: (id: TId) => void;
  ariaLabel: string;
}

export function TopbarTabs<TId extends string>({
  tabs,
  selectedId,
  onSelect,
  ariaLabel,
}: TopbarTabsProps<TId>) {
  return (
    <WorkspacePortal slot="topbar">
      <Tabs
        ariaLabel={ariaLabel}
        className="topbar-tabs topbar-tabs-list"
        items={tabs}
        onChange={onSelect}
        value={selectedId}
        variant="topbar"
      />
    </WorkspacePortal>
  );
}
