import { type ReactNode } from "react";
import { WorkspacePortal } from "@patkepa/kantzen-ui/app-shell";
import { ExpandableSearchField } from "@patkepa/kantzen-ui";

export function LibraryToolbar({
  children,
  root = false,
}: {
  children: ReactNode;
  root?: boolean;
}) {
  return (
    <WorkspacePortal slot="topbar">
      <div
        className={`file-browser-toolbar file-browser-toolbar--topbar${
          root ? " file-browser-toolbar--root" : ""
        }`}
        role="toolbar"
        aria-label="Library controls"
      >
        {children}
      </div>
    </WorkspacePortal>
  );
}

export function LibrarySearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <ExpandableSearchField
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="file-browser-search"
      triggerClassName="note-toolbar-icon library-search-trigger"
    />
  );
}
