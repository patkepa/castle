import { Icon } from "@patkepa/kantzen-ui/primitives";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type { Note } from "../../types";
import type { CastleManagedCanvas } from "../../platform/desktop_bridge";
import { CanvasEditor } from "./CanvasEditor";
import {
  readLastOpenedCanvasPath,
  writeLastOpenedCanvasPath,
} from "./canvasPreferences";
import { fetchGeneratedCanvasCatalog } from "./generated_canvas_library";
import {
  canvasFileName,
  emptyJsonCanvas,
  parseJsonCanvas,
  serializeJsonCanvas,
  type JsonCanvas,
} from "./jsonCanvas";

interface OpenCanvas {
  sessionId: number;
  file: CastleManagedCanvas;
  data: JsonCanvas;
  managed: boolean;
  readOnly: boolean;
  downloadPath?: string;
}

type LibraryCanvas = CastleManagedCanvas & {
  contentPath?: string;
  readOnly: boolean;
};

export function CanvasPage({
  notes,
  onOpenNote,
}: {
  notes: readonly Note[];
  onOpenNote: (note: Note) => void;
}) {
  const bridge = window.castleDesktop;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [canvases, setCanvases] = useState<LibraryCanvas[]>([]);
  const [activeCanvas, setActiveCanvas] = useState<OpenCanvas | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingPath, setOpeningPath] = useState("");
  const [error, setError] = useState("");
  const [newCanvasOpen, setNewCanvasOpen] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState("");
  const [creating, setCreating] = useState(false);
  const nextSessionIdRef = useRef(1);
  const restoredCanvasRef = useRef(false);

  const refreshCanvases = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (bridge) {
        setCanvases(
          (await bridge.listManagedCanvases()).map((canvas) => ({
            ...canvas,
            readOnly: false,
          })),
        );
      } else {
        setCanvases(
          (await fetchGeneratedCanvasCatalog()).map((canvas) => ({
            ...canvas,
            readOnly: true,
          })),
        );
      }
    } catch (reason) {
      setError(errorMessage(reason, "Castle could not read the canvas library."));
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    void refreshCanvases();
  }, [refreshCanvases]);

  const openManagedCanvas = useCallback(
    async (file: LibraryCanvas) => {
      setOpeningPath(file.relativePath);
      setError("");
      try {
        const data = parseJsonCanvas(
          file.contentPath
            ? await fetchCanvasSource(file.contentPath)
            : await bridge!.readManagedCanvas(file.relativePath),
        );
        setActiveCanvas({
          sessionId: nextSessionIdRef.current++,
          file,
          data,
          managed: !file.readOnly,
          readOnly: file.readOnly,
          downloadPath: file.contentPath,
        });
        writeLastOpenedCanvasPath(file.relativePath);
      } catch (reason) {
        setError(errorMessage(reason, "Castle could not open this canvas."));
      } finally {
        setOpeningPath("");
      }
    },
    [bridge],
  );

  useEffect(() => {
    if (loading || activeCanvas || restoredCanvasRef.current) return;
    restoredCanvasRef.current = true;
    const lastOpenedPath = readLastOpenedCanvasPath();
    const lastOpenedCanvas = canvases.find(
      (canvas) => canvas.relativePath === lastOpenedPath,
    );
    if (lastOpenedCanvas) void openManagedCanvas(lastOpenedCanvas);
  }, [activeCanvas, canvases, loading, openManagedCanvas]);

  const openLocalCanvas = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError("");
      try {
        const data = parseJsonCanvas(await file.text());
        setActiveCanvas({
          sessionId: nextSessionIdRef.current++,
          file: {
            relativePath: file.name,
            name: file.name,
            size: file.size,
            modifiedAt: new Date(file.lastModified).toISOString(),
          },
          data,
          managed: false,
          readOnly: false,
        });
      } catch (reason) {
        setError(errorMessage(reason, "Castle could not open this canvas."));
      }
    },
    [],
  );

  const handleLocalFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      void openLocalCanvas(file);
    },
    [openLocalCanvas],
  );

  const createCanvas = useCallback(async () => {
    const name = canvasFileName(newCanvasName);
    setCreating(true);
    setError("");
    try {
      const source = serializeJsonCanvas(emptyJsonCanvas);
      const file = bridge
        ? await bridge.createManagedCanvas(name, source)
        : {
            relativePath: name,
            name,
            size: new Blob([source]).size,
            modifiedAt: new Date().toISOString(),
          };
      if (bridge) {
        setCanvases((current) =>
          [...current, { ...file, readOnly: false }].sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath),
          ),
        );
      }
      setActiveCanvas({
        sessionId: nextSessionIdRef.current++,
        file,
        data: { nodes: [], edges: [] },
        managed: Boolean(bridge),
        readOnly: false,
      });
      if (bridge) writeLastOpenedCanvasPath(file.relativePath);
      setNewCanvasName("");
      setNewCanvasOpen(false);
    } catch (reason) {
      setError(errorMessage(reason, "Castle could not create this canvas."));
    } finally {
      setCreating(false);
    }
  }, [bridge, newCanvasName]);

  const saveActiveCanvas = useCallback(
    async (data: JsonCanvas, download = false) => {
      const current = activeCanvas;
      if (!current) return;
      const source = serializeJsonCanvas(data);
      if (current.managed && bridge) {
        const file = await bridge.saveManagedCanvas(current.file.relativePath, source);
        setActiveCanvas((active) =>
          active?.file.relativePath === file.relativePath
            ? { ...active, file, data }
            : active,
        );
        setCanvases((files) =>
          files.map((candidate) =>
            candidate.relativePath === file.relativePath
              ? { ...file, readOnly: false }
              : candidate,
          ),
        );
        return;
      }
      setActiveCanvas((active) =>
        active?.sessionId === current.sessionId ? { ...active, data } : active,
      );
      if (download) downloadCanvas(current.file.name, source);
    },
    [activeCanvas, bridge],
  );

  const importCanvasMedia = useCallback(
    async (file: File) => {
      if (!bridge || !activeCanvas?.managed) {
        throw new Error("Canvas media can only be added to a desktop library canvas.");
      }
      return bridge.importCanvasMedia({
        name: file.name,
        mimeType: file.type,
        data: await file.arrayBuffer(),
      });
    },
    [activeCanvas?.managed, bridge],
  );

  return (
    <main className="canvas-page" aria-label="Canvas">
      {bridge ? (
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept=".canvas,application/json"
          onChange={handleLocalFile}
        />
      ) : null}
      <CanvasLibraryRail
        activePath={activeCanvas?.file.relativePath ?? ""}
        canvases={canvases}
        desktopAvailable={Boolean(bridge)}
        loading={loading}
        openingPath={openingPath}
        onCreate={() => setNewCanvasOpen(true)}
        onOpenLocal={() => fileInputRef.current?.click()}
        onOpenCanvas={(file) => void openManagedCanvas(file)}
        onRefresh={() => void refreshCanvases()}
      />
      <section className="canvas-main">
        {error ? (
          <div className="canvas-error" role="alert">
            <Icon icon="error" aria-hidden="true" />
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} aria-label="Dismiss error">
              <Icon icon="small-cross" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {activeCanvas ? (
          <CanvasEditor
            autoSave={activeCanvas.managed}
            data={activeCanvas.data}
            fileName={activeCanvas.file.name}
            key={activeCanvas.sessionId}
            notes={notes}
            readOnly={activeCanvas.readOnly}
            onChange={(data) =>
              setActiveCanvas((current) =>
                current ? { ...current, data } : current,
              )
            }
            onDownload={
              activeCanvas.managed
                ? undefined
                : activeCanvas.downloadPath
                  ? () => downloadCanvasFromPath(activeCanvas.file.name, activeCanvas.downloadPath!)
                  : (data) => void saveActiveCanvas(data, true)
            }
            onImportMedia={
              activeCanvas.managed && !activeCanvas.readOnly && bridge
                ? importCanvasMedia
                : undefined
            }
            onImportMediaError={(reason) =>
              setError(errorMessage(reason, "Castle could not add this canvas media."))
            }
            onOpenMedia={
              bridge
                ? (relativePath) => {
                    void bridge.openCanvasMedia(relativePath).catch((reason: unknown) => {
                      setError(errorMessage(reason, "Castle could not open this canvas media."));
                    });
                  }
                : undefined
            }
            onOpenNote={onOpenNote}
            onSaveError={(reason) =>
              setError(errorMessage(reason, "Castle could not auto-save this canvas."))
            }
            onSave={(data) => activeCanvas.readOnly ? Promise.resolve() : saveActiveCanvas(data)}
          />
        ) : (
          <CanvasWelcome
            desktopAvailable={Boolean(bridge)}
            loading={loading}
            onCreate={() => setNewCanvasOpen(true)}
            onOpen={() => fileInputRef.current?.click()}
          />
        )}
      </section>
      {newCanvasOpen && bridge ? (
        <NewCanvasDialog
          creating={creating}
          name={newCanvasName}
          onCancel={() => {
            setNewCanvasOpen(false);
            setNewCanvasName("");
          }}
          onChange={setNewCanvasName}
          onCreate={() => void createCanvas()}
        />
      ) : null}
    </main>
  );
}

function CanvasLibraryRail({
  activePath,
  canvases,
  desktopAvailable,
  loading,
  openingPath,
  onCreate,
  onOpenCanvas,
  onOpenLocal,
  onRefresh,
}: {
  activePath: string;
  canvases: LibraryCanvas[];
  desktopAvailable: boolean;
  loading: boolean;
  openingPath: string;
  onCreate: () => void;
  onOpenCanvas: (canvas: LibraryCanvas) => void;
  onOpenLocal: () => void;
  onRefresh: () => void;
}) {
  return (
    <aside className="canvas-library" aria-label="Canvas files">
      {desktopAvailable ? (
        <button className="canvas-new-button" type="button" onClick={onCreate}>
          <Icon icon="plus" aria-hidden="true" />
          New canvas
        </button>
      ) : null}
      <div className="canvas-library-heading">
        <span>Canvases</span>
        {desktopAvailable ? (
          <button type="button" onClick={onRefresh} aria-label="Refresh canvases">
            <Icon icon="refresh" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="canvas-file-list">
        {canvases.map((canvas) => (
          <button
            className={canvas.relativePath === activePath ? "is-active" : ""}
            disabled={Boolean(openingPath)}
            key={canvas.relativePath}
            type="button"
            onClick={() => onOpenCanvas(canvas)}
          >
            <Icon
              icon={openingPath === canvas.relativePath ? "refresh" : "grid-view"}
              aria-hidden="true"
            />
            <span>
              <strong>{displayCanvasName(canvas.name)}</strong>
              <small title={canvas.relativePath}>
                {displayCanvasLocation(canvas.relativePath, canvas.modifiedAt)}
              </small>
            </span>
          </button>
        ))}
        {!loading && canvases.length === 0 ? (
          <p className="canvas-library-empty">
            {desktopAvailable
              ? "Create the first .canvas file in this library."
              : "This Cloudflare build does not contain any published library canvases."}
          </p>
        ) : null}
      </div>
      {desktopAvailable ? (
        <button className="canvas-open-local" type="button" onClick={onOpenLocal}>
          <Icon icon="folder-open" aria-hidden="true" />
          Open local .canvas
        </button>
      ) : null}
    </aside>
  );
}

function CanvasWelcome({
  desktopAvailable,
  loading,
  onCreate,
  onOpen,
}: {
  desktopAvailable: boolean;
  loading: boolean;
  onCreate: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="canvas-welcome">
      <div className="canvas-welcome-mark" aria-hidden="true">
        <Icon icon={loading ? "refresh" : "grid-view"} size={28} />
      </div>
      <h1>{loading ? "Reading your canvases…" : "Map ideas in open space"}</h1>
      <p>{desktopAvailable
        ? "Create text, note, link, and group cards, then connect them in the open JSON Canvas format used by Obsidian."
        : "Published library canvases will appear here as read-only snapshots."}</p>
      {!loading && desktopAvailable ? (
        <div>
          <button type="button" onClick={onCreate}>
            <Icon icon="plus" aria-hidden="true" />
            Create canvas
          </button>
          <button type="button" onClick={onOpen}>
            <Icon icon="folder-open" aria-hidden="true" />
            Open .canvas
          </button>
        </div>
      ) : null}
    </div>
  );
}

function NewCanvasDialog({
  creating,
  name,
  onCancel,
  onChange,
  onCreate,
}: {
  creating: boolean;
  name: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onCreate: () => void;
}) {
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  return (
    <div className="canvas-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form
        className="canvas-dialog"
        aria-label="Create canvas"
        aria-modal="true"
        role="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <header>
          <Icon icon="grid-view" aria-hidden="true" />
          <div>
            <h2>New canvas</h2>
            <p>Saved as an Obsidian-compatible .canvas file.</p>
          </div>
        </header>
        <label>
          Name
          <input
            autoFocus
            disabled={creating}
            maxLength={120}
            placeholder="Summer plan"
            value={name}
            onChange={(event) => onChange(event.target.value)}
          />
          <small>{canvasFileName(name)}</small>
        </label>
        <footer>
          <button type="button" disabled={creating} onClick={onCancel}>Cancel</button>
          <button className="is-primary" type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create canvas"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function downloadCanvas(name: string, source: string) {
  const url = URL.createObjectURL(
    new Blob([source], { type: "application/json;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.toLocaleLowerCase().endsWith(".canvas")
    ? name
    : `${name}.canvas`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadCanvasFromPath(name: string, sourcePath: string) {
  const anchor = document.createElement("a");
  anchor.href = sourcePath;
  anchor.download = name;
  anchor.click();
}

async function fetchCanvasSource(path: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Generated canvas returned ${response.status}`);
  return response.text();
}

function displayCanvasName(name: string) {
  return name.replace(/\.canvas$/i, "").replaceAll("_", " ");
}

function displayCanvasLocation(relativePath: string, modifiedAt: string) {
  const folder = relativePath.split("/").slice(0, -1).join(" / ");
  const modified = formatModified(modifiedAt);
  return folder ? `${folder} · ${modified}` : modified;
}

function formatModified(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const difference = Date.now() - date.getTime();
  if (difference < 60_000) return "Just now";
  if (difference < 3_600_000) return `${Math.max(1, Math.floor(difference / 60_000))}m ago`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}
