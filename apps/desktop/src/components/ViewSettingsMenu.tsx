import { WorkspacePortal } from "@patkepa/kantzen-ui/app-shell";
import { Icon, type IconName } from "@patkepa/kantzen-ui/primitives";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  settingsShortcutIds,
  shortcutCatalog,
  type ShortcutDefinition,
} from "../keyboard/shortcut_catalog";
import type {
  CastleDesktopInfo,
  CastleDesktopLibrary,
  CastleLibrarySelectionResult,
} from "../platform/castle_platform";
import { useCastlePlatform } from "../platform/castle_platform_provider";
import { builtInDocumentDefinitions } from "../lib/builtInDocumentManifest";
import {
  navigationTabs,
  type NavigationTabId,
} from "../lib/navigationPreferences";
import {
  updateCastleUserPreferences,
  useCastleUserPreferences,
} from "../lib/userPreferences";

interface ViewSettingsMenuProps {
  hiddenNavigationTabs: ReadonlySet<NavigationTabId>;
  autoHideSidebar: boolean;
  sidebarCollapsed: boolean;
  onToggleNavigationTab: (tabId: NavigationTabId) => void;
  onToggleAutoHideSidebar: () => void;
  onToggleSidebar: () => void;
}

type NoteViewPreference = "readingProgress" | "tableOfContents";

export function ViewSettingsMenu({
  hiddenNavigationTabs,
  autoHideSidebar,
  sidebarCollapsed,
  onToggleNavigationTab,
  onToggleAutoHideSidebar,
  onToggleSidebar,
}: ViewSettingsMenuProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const desktopServices = useCastlePlatform().desktopServices;
  const preferences = useCastleUserPreferences();
  const [desktopInfo, setDesktopInfo] = useState<CastleDesktopInfo | null>(null);
  const [libraryWorking, setLibraryWorking] = useState("");
  const [libraryError, setLibraryError] = useState("");

  useEffect(() => {
    if (!desktopServices) return;
    let active = true;
    void desktopServices
      .getInfo()
      .then((info) => {
        if (active) setDesktopInfo(info);
      })
      .catch((reason: unknown) => {
        if (active) {
          setLibraryError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      active = false;
    };
  }, [desktopServices]);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "castle-hide-reading-progress",
      !preferences.readingProgress,
    );
    document.documentElement.classList.toggle(
      "castle-hide-table-of-contents",
      !preferences.tableOfContents,
    );
  }, [preferences]);

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) {
        menu.removeAttribute("open");
      }
    };

    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, []);

  const togglePreference = useCallback((preference: NoteViewPreference) => {
    updateCastleUserPreferences((current) => {
      return { ...current, [preference]: !current[preference] };
    });
  }, []);

  const finishLibrarySelection = useCallback(
    async (
      pendingSelection: Promise<CastleLibrarySelectionResult>,
      progressKey: string,
    ) => {
      if (!desktopServices) return;
      setLibraryWorking(progressKey);
      setLibraryError("");
      try {
        const result = await pendingSelection;
        if (result.status === "selected") {
          setLibraryWorking(result.library.path);
          await desktopServices.restartApp();
          return;
        }
        if (result.status === "invalid") setLibraryError(result.message);
      } catch (reason) {
        setLibraryError(reason instanceof Error ? reason.message : String(reason));
      }
      setLibraryWorking("");
    },
    [desktopServices],
  );

  const chooseLibrary = useCallback(() => {
    if (desktopServices) {
      void finishLibrarySelection(
        desktopServices.chooseLibrary(),
        "choose-folder",
      );
    }
  }, [desktopServices, finishLibrarySelection]);

  const openLibrary = useCallback(
    (library: CastleDesktopLibrary) => {
      if (!desktopServices) return;
      if (!library.available) {
        void finishLibrarySelection(
          desktopServices.chooseLibrary(),
          "choose-folder",
        );
        return;
      }
      void finishLibrarySelection(
        desktopServices.openLibrary(library.path),
        library.path,
      );
    },
    [desktopServices, finishLibrarySelection],
  );

  return (
    <WorkspacePortal slot="navbar-end">
      <details
      className="view-settings-menu"
      ref={menuRef}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        menuRef.current?.removeAttribute("open");
        menuRef.current?.querySelector("summary")?.focus();
      }}
    >
      <summary aria-label="Open view settings" title="View settings">
        <Icon icon="menu" aria-hidden="true" />
      </summary>

      <div className="view-settings-popover" aria-label="View settings">
        <header className="view-settings-header">
          <span>View settings</span>
          <small>Saved on this device</small>
        </header>

        {desktopInfo?.library ? (
          <DesktopLibrarySettings
            currentLibrary={desktopInfo.library}
            error={libraryError}
            libraries={desktopInfo.libraries}
            working={libraryWorking}
            onChooseLibrary={chooseLibrary}
            onOpenLibrary={openLibrary}
          />
        ) : null}

        <section aria-labelledby="view-settings-interface">
          <h2 id="view-settings-interface">Interface</h2>
          <SettingsToggle
            checked={!sidebarCollapsed}
            description="Keep library navigation visible"
            icon="panel-stats"
            label="Sidebar"
            onClick={onToggleSidebar}
          />
          <SettingsToggle
            checked={autoHideSidebar}
            description="Reveal it when your cursor reaches the left edge"
            icon="eye-open"
            label="Auto-hide sidebar"
            onClick={onToggleAutoHideSidebar}
          />
        </section>

        <section aria-labelledby="view-settings-sidebar-tabs">
          <h2 id="view-settings-sidebar-tabs">Sidebar tabs</h2>
          {navigationTabs.map((tab) => (
            <SettingsToggle
              key={tab.id}
              checked={!hiddenNavigationTabs.has(tab.id)}
              description={tab.description}
              icon={tab.icon}
              label={tab.label}
              onClick={() => onToggleNavigationTab(tab.id)}
            />
          ))}
        </section>

        <section aria-labelledby="view-settings-notes">
          <h2 id="view-settings-notes">Notes</h2>
          <SettingsToggle
            checked={preferences.readingProgress}
            description="Track your position below the note toolbar"
            icon="timeline-line-chart"
            label="Reading progress"
            onClick={() => togglePreference("readingProgress")}
          />
          <SettingsToggle
            checked={preferences.tableOfContents}
            description="Show note outlines and section controls"
            icon="list"
            label="On this page"
            onClick={() => togglePreference("tableOfContents")}
          />
        </section>

        <section aria-labelledby="view-settings-help">
          <h2 id="view-settings-help">Help</h2>
          <Link
            className="view-settings-library-action"
            to={builtInDocumentDefinitions.markdown_help.route}
            onClick={() => menuRef.current?.removeAttribute("open")}
          >
            <Icon icon="help" aria-hidden="true" />
            <span>
              <strong>Markdown help</strong>
              <small>Formatting, links, checklists, and overrides</small>
            </span>
            <Icon icon="chevron-right" aria-hidden="true" />
          </Link>
        </section>

        <section aria-labelledby="view-settings-shortcuts">
          <h2 id="view-settings-shortcuts">Shortcuts</h2>
          {settingsShortcutIds.map((shortcutId) => (
            <Shortcut
              key={shortcutId}
              shortcut={shortcutCatalog[shortcutId]}
            />
          ))}
        </section>
      </div>
      </details>
    </WorkspacePortal>
  );
}

export function DesktopLibrarySettings({
  currentLibrary,
  error,
  libraries,
  onChooseLibrary,
  onOpenLibrary,
  working,
}: {
  currentLibrary: CastleDesktopLibrary;
  error: string;
  libraries: CastleDesktopLibrary[];
  onChooseLibrary: () => void;
  onOpenLibrary: (library: CastleDesktopLibrary) => void;
  working: string;
}) {
  return (
    <section aria-labelledby="view-settings-library">
      <h2 id="view-settings-library">Library</h2>
      <div className="view-settings-library-current">
        <Icon icon="database" aria-hidden="true" />
        <span>
          <strong>{currentLibrary.name}</strong>
          <small title={currentLibrary.path}>{currentLibrary.path}</small>
        </span>
        <small>Current</small>
      </div>
      {libraries
        .filter((library) => !library.active)
        .map((library) => (
          <SettingsLibraryButton
            key={library.path}
            library={library}
            opening={working === library.path}
            disabled={Boolean(working)}
            onClick={() => onOpenLibrary(library)}
          />
        ))}
      <button
        type="button"
        className="view-settings-library-action"
        disabled={Boolean(working)}
        onClick={onChooseLibrary}
      >
        <Icon icon="folder-open" aria-hidden="true" />
        <span>
          <strong>
            {working === "choose-folder" ? "Choosing…" : "Open another library…"}
          </strong>
          <small>Choose a repository or library folder</small>
        </span>
      </button>
      {error ? (
        <p className="view-settings-library-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function SettingsLibraryButton({
  disabled,
  library,
  onClick,
  opening,
}: {
  disabled: boolean;
  library: CastleDesktopLibrary;
  onClick: () => void;
  opening: boolean;
}) {
  return (
    <button
      type="button"
      className="view-settings-library-action"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon icon={library.available ? "exchange" : "offline"} aria-hidden="true" />
      <span>
        <strong>{library.name}</strong>
        <small title={library.path}>{library.path}</small>
      </span>
      <small>{opening ? "Opening…" : library.available ? "Switch" : "Locate"}</small>
    </button>
  );
}

function SettingsToggle({
  checked,
  description,
  icon,
  label,
  onClick,
}: {
  checked: boolean;
  description: string;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="view-settings-toggle"
      role="switch"
      aria-checked={checked}
      onClick={onClick}
    >
      <Icon icon={icon} aria-hidden="true" />
      <span className="view-settings-toggle-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className="view-settings-switch" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

function Shortcut({ shortcut }: { shortcut: ShortcutDefinition }) {
  return (
    <div className="view-settings-shortcut">
      <span>{shortcut.label}</span>
      <span>
        {shortcut.displayKeys.map((key, index) => (
          <kbd key={`${key}-${index}`}>{key}</kbd>
        ))}
      </span>
    </div>
  );
}
