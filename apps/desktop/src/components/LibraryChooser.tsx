import { Icon } from "@patkepa/kantzen-ui/primitives";
import { useState } from "react";
import type {
  CastleDesktopLibrary,
  CastleDesktopServices,
  CastleLibrarySelectionResult,
} from "../platform/castle_platform";

export function LibraryChooser({
  desktopServices,
  libraries,
}: {
  desktopServices: CastleDesktopServices;
  libraries: CastleDesktopLibrary[];
}) {
  const [workingPath, setWorkingPath] = useState<string | null>(null);
  const [error, setError] = useState("");
  const opening = workingPath !== null;

  const finishSelection = async (
    pendingSelection: Promise<CastleLibrarySelectionResult>,
    progressKey: string,
  ) => {
    setWorkingPath(progressKey);
    setError("");
    try {
      const result = await pendingSelection;
      if (result.status === "selected") {
        setWorkingPath(result.library.path);
        await desktopServices.restartApp();
        return;
      }
      if (result.status === "invalid") setError(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    setWorkingPath(null);
  };

  const openFolder = () =>
    finishSelection(desktopServices.chooseLibrary(), "choose-folder");
  const openRecent = (library: CastleDesktopLibrary) =>
    finishSelection(desktopServices.openLibrary(library.path), library.path);

  return (
    <main className="library-launcher">
      <section className="library-launcher-card" aria-labelledby="library-launcher-title">
        <div className="library-launcher-brand" aria-hidden="true">
          <Icon icon="folder-open" size={34} />
        </div>
        <header className="library-launcher-header">
          <span>Castle</span>
          <h1 id="library-launcher-title">Open a library</h1>
          <p>
            Your Markdown stays in its folder. Castle builds a private local view
            and remembers libraries you open on this device.
          </p>
        </header>

        {libraries.length > 0 ? (
          <section className="library-launcher-recents" aria-labelledby="recent-libraries-title">
            <h2 id="recent-libraries-title">Recent libraries</h2>
            <div className="library-choice-list">
              {libraries.map((library) => (
                <button
                  type="button"
                  className="library-choice"
                  key={library.path}
                  disabled={opening}
                  onClick={() =>
                    void (library.available ? openRecent(library) : openFolder())
                  }
                >
                  <Icon
                    icon={library.available ? "database" : "offline"}
                    aria-hidden="true"
                  />
                  <span className="library-choice-copy">
                    <strong>{library.name}</strong>
                    <small>{library.path}</small>
                  </span>
                  <span className="library-choice-state">
                    {workingPath === library.path
                      ? "Opening…"
                      : library.available
                        ? "Open"
                        : "Locate"}
                  </span>
                  <Icon icon="chevron-right" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {error ? (
          <p className="library-selection-error" role="alert">
            <Icon icon="warning-sign" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}

        <button
          type="button"
          className="library-open-folder"
          disabled={opening}
          onClick={() => void openFolder()}
        >
          <Icon icon="folder-open" aria-hidden="true" />
          {workingPath === "choose-folder" ? "Choosing…" : "Open folder…"}
        </button>
        <p className="library-launcher-hint">
          Choose either a repository containing <code>library/</code> or the
          library folder itself.
        </p>
      </section>
    </main>
  );
}
