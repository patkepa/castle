import type { ReactNode } from "react";
import { useLibraryKeyboardNavigation } from "../features/library/library_keyboard_navigation";
import type { LibraryViewMode } from "./LibraryViewToggle";

interface LibraryBrowserProps {
  children: ReactNode;
  className: string;
  keyboardNavigation?: boolean;
  viewMode: LibraryViewMode;
}

export function LibraryBrowser({
  children,
  className,
  keyboardNavigation = true,
  viewMode,
}: LibraryBrowserProps) {
  const { handleKeyDown, scopeRef } = useLibraryKeyboardNavigation({
    enabled: keyboardNavigation,
    viewMode,
  });

  return (
    <div
      className={className}
      data-library-layout={viewMode}
      onKeyDown={keyboardNavigation ? handleKeyDown : undefined}
      ref={scopeRef}
    >
      {children}
    </div>
  );
}
