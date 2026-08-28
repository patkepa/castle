import { Icon } from "@patkepa/kantzen-ui/primitives";
import { WorkspaceToolbar } from "@patkepa/kantzen-ui";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { EmptyState } from "@patkepa/kantzen-ui";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FolderTile } from "../../components/FolderPage";
import { LibraryBrowser } from "../../components/library_browser";
import {
  LibraryViewToggle,
  useLibraryViewMode,
} from "../../components/LibraryViewToggle";
import { LibrarySearch, LibraryToolbar } from "../../components/LibraryToolbar";
import { decodeFolderPath, humanizePathSegment } from "../../lib/libraryPaths";
import {
  parseOdsArrayBuffer,
  parseOdsFile,
  spreadsheetColumnLabel,
  createOdsArchive,
  type OdsSheet,
  type OdsWorkbook,
} from "./ods";
import {
  cellInputValue,
  updateWorkbookCell,
  updateWorkbookCells,
} from "./calculations";
import {
  createSheetFolderRoute,
  createSheetRoute,
  decodeSheetRoutePath,
  getSheetDirectory,
  getSheetDirectoryContents,
  loadLibrarySheets,
  type LibrarySheet,
} from "./sheet_library";

interface OpenedSpreadsheet {
  sessionId: number;
  fileName: string;
  fileSize: number;
  sourcePath: string;
  managedRelativePath?: string;
  readOnly?: boolean;
  downloadPath?: string;
  initialWorkbook: OdsWorkbook;
  workbook: OdsWorkbook;
}

const minimumPreviewRows = 30;
const minimumPreviewColumns = 12;

async function fetchSheetBytes(path: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Generated spreadsheet returned ${response.status}`);
  return response.arrayBuffer();
}

interface SheetsPageProps {
  initialRelativePath?: string;
  onBack?: () => void;
}

export function SheetFilePage() {
  const { "*": encodedPath = "" } = useParams();
  const navigate = useNavigate();
  const relativePath = decodeSheetRoutePath(encodedPath);
  const parentDirectory = getSheetDirectory(relativePath);

  return (
    <SheetsPage
      initialRelativePath={relativePath}
      onBack={() => navigate(createSheetFolderRoute(parentDirectory))}
    />
  );
}

export function SheetsPage({
  initialRelativePath,
  onBack,
}: SheetsPageProps = {}) {
  const desktopAvailable =
    typeof window !== "undefined" && Boolean(window.castleDesktop);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openedSpreadsheet, setOpenedSpreadsheet] =
    useState<OpenedSpreadsheet | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [managedSheets, setManagedSheets] = useState<LibrarySheet[]>([]);
  const [managerLoading, setManagerLoading] = useState(true);
  const [openingManagedPath, setOpeningManagedPath] = useState("");
  const nextSessionIdRef = useRef(1);
  const attemptedInitialPathRef = useRef("");

  const refreshManagedSheets = useCallback(async () => {
    setManagerLoading(true);
    setError("");
    try {
      setManagedSheets(await loadLibrarySheets());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Castle could not read the sheets library.",
      );
    } finally {
      setManagerLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshManagedSheets();
  }, [refreshManagedSheets]);

  const openFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const workbook = await parseOdsFile(file);
      setOpenedSpreadsheet({
        sessionId: nextSessionIdRef.current++,
        fileName: file.name,
        fileSize: file.size,
        sourcePath: "Local file",
        initialWorkbook: workbook,
        workbook,
      });
      setSelectedSheetIndex(0);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Castle could not open this spreadsheet.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const openManagedSheet = useCallback(async (sheet: LibrarySheet) => {
    setOpeningManagedPath(sheet.relativePath);
    setError("");
    try {
      const workbook = await parseOdsArrayBuffer(
        sheet.contentPath
          ? await fetchSheetBytes(sheet.contentPath)
          : await window.castleDesktop!.readManagedSheet(sheet.relativePath),
      );
      setOpenedSpreadsheet({
        sessionId: nextSessionIdRef.current++,
        fileName: sheet.name,
        fileSize: sheet.size,
        sourcePath: `library/sheets/${sheet.relativePath}`,
        managedRelativePath: sheet.readOnly ? undefined : sheet.relativePath,
        readOnly: sheet.readOnly,
        downloadPath: sheet.contentPath,
        initialWorkbook: workbook,
        workbook,
      });
      setSelectedSheetIndex(0);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Castle could not open this spreadsheet.",
      );
    } finally {
      setOpeningManagedPath("");
    }
  }, []);

  useEffect(() => {
    if (
      !initialRelativePath ||
      managerLoading ||
      openedSpreadsheet ||
      attemptedInitialPathRef.current === initialRelativePath
    ) {
      return;
    }

    attemptedInitialPathRef.current = initialRelativePath;
    const requestedSheet = managedSheets.find(
      (sheet) => sheet.relativePath === initialRelativePath,
    );
    if (requestedSheet) {
      void openManagedSheet(requestedSheet);
      return;
    }

    setError(`Castle could not find library/sheets/${initialRelativePath}.`);
  }, [
    initialRelativePath,
    managedSheets,
    managerLoading,
    openManagedSheet,
    openedSpreadsheet,
  ]);

  const openPicker = useCallback(() => fileInputRef.current?.click(), []);
  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      void openFile(file);
    },
    [openFile],
  );
  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragActive(false);
      void openFile(event.dataTransfer.files[0]);
    },
    [openFile],
  );

  const selectedSheet = openedSpreadsheet
    ? openedSpreadsheet.workbook.sheets[selectedSheetIndex] ??
      openedSpreadsheet.workbook.sheets[0]
    : null;

  return (
    <main
      aria-label="Sheets"
      className={`sheets-page${dragActive ? " is-drag-active" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragActive(false);
        }
      }}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept=".ods,application/vnd.oasis.opendocument.spreadsheet"
        onChange={handleFileChange}
      />
      <WorkspaceToolbar ariaLabel="Sheets toolbar" className="sheets-toolbar">
        <div className="sheets-toolbar-title">
          <Icon icon="th" size={16} aria-hidden="true" />
          <strong>Sheets</strong>
          <span>ODS preview</span>
        </div>
        <button
          className="sheets-open-button"
          type="button"
          disabled={loading}
          onClick={openPicker}
        >
          <Icon icon={loading ? "refresh" : "folder-open"} aria-hidden="true" />
          {loading
            ? "Opening…"
            : openedSpreadsheet
              ? "Open another"
              : "Open .ods"}
        </button>
      </WorkspaceToolbar>

      <div className="sheets-workspace">
        {openedSpreadsheet && selectedSheet ? (
          <SpreadsheetPanel
            document={openedSpreadsheet}
            error={error}
            selectedSheet={selectedSheet}
            selectedSheetIndex={selectedSheetIndex}
            backLabel={onBack ? "Back to containing folder" : undefined}
            onBack={onBack ?? (() => {
              setOpenedSpreadsheet(null);
              setError("");
            })}
            onOpen={openPicker}
            onSelectSheet={setSelectedSheetIndex}
            onUpdateWorkbook={(workbook) => {
              setOpenedSpreadsheet((current) =>
                current ? { ...current, workbook } : current,
              );
            }}
          />
        ) : initialRelativePath ? (
          <SheetOpeningState
            error={error}
            loading={managerLoading || Boolean(openingManagedPath)}
            onBack={onBack}
          />
        ) : (
          <SheetsManager
            desktopAvailable={desktopAvailable}
            error={error}
            loading={managerLoading}
            managedSheets={managedSheets}
            openingPath={openingManagedPath}
            onOpenLocal={openPicker}
            onOpenSheet={(sheet) => void openManagedSheet(sheet)}
            onRefresh={() => void refreshManagedSheets()}
          />
        )}
      </div>
    </main>
  );
}

export function SheetsLibraryPage() {
  const { "*": folderPath = "" } = useParams();
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useLibraryViewMode();
  const [sheets, setSheets] = useState<LibrarySheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const directory = useMemo(() => decodeFolderPath(folderPath), [folderPath]);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const contents = useMemo(
    () => getSheetDirectoryContents(sheets, directory),
    [directory, sheets],
  );
  const filteredFolders = useMemo(
    () => contents.folders.filter(({ name }) =>
      humanizePathSegment(name).toLocaleLowerCase().includes(deferredQuery)
    ),
    [contents.folders, deferredQuery],
  );
  const filteredFiles = useMemo(
    () => contents.files.filter((sheet) =>
      `${sheet.name} ${displaySheetName(sheet.name)}`
        .toLocaleLowerCase()
        .includes(deferredQuery)
    ),
    [contents.files, deferredQuery],
  );
  const currentLabel = directory.length > 0
    ? humanizePathSegment(directory.at(-1) ?? "Sheets")
    : "Sheets";
  const parentDirectory = directory.slice(0, -1);
  const parentRoute = directory.length > 0
    ? createSheetFolderRoute(parentDirectory)
    : "/library";
  const parentLabel = directory.length > 1
    ? humanizePathSegment(parentDirectory.at(-1) ?? "Sheets")
    : directory.length === 1 ? "Sheets" : "Library";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSheets(await loadLibrarySheets());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Castle could not read the sheets library.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const folderExists = directory.length === 0 || sheets.some((sheet) => {
    const sheetDirectory = getSheetDirectory(sheet.relativePath);
    return directory.every((segment, index) => sheetDirectory[index] === segment);
  });

  if (!loading && !folderExists) {
    return (
      <div className="missing-note">
        <Icon icon="folder-close" size={32} />
        <h1>Folder not found</h1>
        <p>This folder may have moved or no longer contains any spreadsheets.</p>
        <Link to="/browse/sheets">Return to Sheets</Link>
      </div>
    );
  }

  const resultCount = filteredFolders.length + filteredFiles.length;
  const isFiltered = Boolean(deferredQuery);

  return (
    <>
      <LibraryToolbar>
        <Link
          aria-label={`Back to ${parentLabel}`}
          className="note-toolbar-icon note-toolbar-back"
          title={`Back to ${parentLabel}`}
          to={parentRoute}
        >
          <Icon icon="arrow-left" aria-hidden="true" />
        </Link>
        <LibrarySearch
          onChange={setQuery}
          placeholder={`Filter ${currentLabel.toLocaleLowerCase()}`}
          value={query}
        />
        <LibraryViewToggle
          value={viewMode}
          onChange={(mode) => {
            if (mode !== "playlist") setViewMode(mode);
          }}
        />
      </LibraryToolbar>

      <main className="file-browser">
        <header className="file-browser-header">
          <div className="file-browser-heading">
            <h1>{currentLabel}</h1>
            <p>
              {contents.folders.length} {contents.folders.length === 1 ? "folder" : "folders"}{" "}
              and {contents.files.length}{" "}
              {contents.files.length === 1 ? "spreadsheet" : "spreadsheets"}
            </p>
          </div>
        </header>

        <div className="file-browser-content">
          {error ? (
            <div className="sheets-manager-error" role="alert">
              <Icon icon="error" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
          {loading ? (
            <div className="route-loading" role="status">
              <span />
              <p>Reading your sheets…</p>
            </div>
          ) : resultCount > 0 ? (
            <LibraryBrowser
              className={viewMode === "list" ? "file-browser-list" : "file-browser-grid"}
              viewMode={viewMode}
            >
              {filteredFolders.map((folder) => (
                <FolderTile
                  detail={`${folder.sheetCount} ${folder.sheetCount === 1 ? "spreadsheet" : "spreadsheets"}`}
                  entryCount={folder.sheetCount}
                  key={folder.name}
                  label={humanizePathSegment(folder.name)}
                  noteCount={0}
                  to={createSheetFolderRoute([...directory, folder.name])}
                />
              ))}
              {filteredFiles.map((sheet) => (
                <SheetTile key={sheet.relativePath} sheet={sheet} />
              ))}
            </LibraryBrowser>
          ) : (
            <EmptyState
              className="file-browser-empty"
              description={
                isFiltered
                  ? "Try a different spreadsheet or folder name."
                  : "Add .ods files to library/sheets/ and they will appear here."
              }
              icon={isFiltered ? "search" : "th"}
              title={isFiltered ? "No matching items" : "This folder is empty"}
            />
          )}
        </div>
      </main>
    </>
  );
}

export function SheetTile({ sheet }: { sheet: LibrarySheet }) {
  return (
    <Link
      aria-keyshortcuts="Space"
      className="file-tile file-tile--sheet"
      data-library-item="true"
      to={createSheetRoute(sheet.relativePath)}
    >
      <span className="file-tile-icon" aria-hidden="true">
        <Icon icon="th" size={18} />
      </span>
      <span className="file-tile-primary">
        <strong>{displaySheetName(sheet.name)}</strong>
        <small>{sheet.name}</small>
      </span>
      <span className="file-tile-detail">{formatFileSize(sheet.size)}</span>
      <Icon className="file-tile-arrow" icon="chevron-right" aria-hidden="true" />
    </Link>
  );
}

function SheetOpeningState({
  error,
  loading,
  onBack,
}: {
  error: string;
  loading: boolean;
  onBack?: () => void;
}) {
  return (
    <section className="sheets-panel sheets-manager">
      <div className="sheets-manager-empty">
        <div className="sheets-empty-illustration" aria-hidden="true">
          <Icon icon={loading ? "refresh" : "error"} size={30} />
          <span />
        </div>
        <h2>{loading ? "Opening spreadsheet…" : "Spreadsheet unavailable"}</h2>
        <p>{error || "Castle is reading this file from your library."}</p>
        {onBack ? (
          <button className="sheets-empty-open" onClick={onBack} type="button">
            <Icon icon="arrow-left" aria-hidden="true" />
            Back to containing folder
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function SheetsManager({
  desktopAvailable,
  error,
  managedSheets,
  loading,
  openingPath,
  onOpenLocal,
  onOpenSheet,
  onRefresh,
}: {
  desktopAvailable: boolean;
  error: string;
  managedSheets: LibrarySheet[];
  loading: boolean;
  openingPath: string;
  onOpenLocal: () => void;
  onOpenSheet: (sheet: LibrarySheet) => void;
  onRefresh: () => void;
}) {
  return (
    <section aria-label="Sheets library" className="sheets-panel sheets-manager">
      <header className="sheets-manager-header">
        <div>
          <span>Library collection</span>
          <h1>Sheets</h1>
          <p>
            OpenDocument spreadsheets kept in <code>library/sheets/</code>
          </p>
        </div>
        {desktopAvailable ? (
          <button type="button" disabled={loading} onClick={onRefresh}>
            <Icon icon="refresh" aria-hidden="true" />
            Refresh
          </button>
        ) : null}
      </header>

      {error ? (
        <div className="sheets-manager-error" role="alert">
          <Icon icon="error" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {managedSheets.length > 0 ? (
        <div aria-label="Managed spreadsheets" className="sheets-manager-list">
          <div className="sheets-manager-columns" aria-hidden="true">
            <span>Name</span>
            <span>Folder</span>
            <span>Modified</span>
            <span>Size</span>
            <span />
          </div>
          {managedSheets.map((sheet) => (
            <button
              className="sheets-manager-row"
              disabled={Boolean(openingPath)}
              key={sheet.relativePath}
              type="button"
              onClick={() => onOpenSheet(sheet)}
            >
              <span className="sheets-manager-name">
                <i aria-hidden="true">
                  <Icon icon="th" size={14} />
                </i>
                <span>
                  <strong>{displaySheetName(sheet.name)}</strong>
                  <small>{sheet.name}</small>
                </span>
              </span>
              <span className="sheets-manager-folder">
                {sheetFolder(sheet.relativePath)}
              </span>
              <time dateTime={sheet.modifiedAt}>
                {formatModifiedDate(sheet.modifiedAt)}
              </time>
              <span>{formatFileSize(sheet.size)}</span>
              <Icon
                icon={openingPath === sheet.relativePath ? "refresh" : "chevron-right"}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      ) : (
        <div className="sheets-manager-empty">
          <div className="sheets-empty-illustration" aria-hidden="true">
            <Icon icon={loading ? "refresh" : "th"} size={30} />
            <span />
          </div>
          <h2>
            {loading
              ? "Reading your sheets…"
              : desktopAvailable
                ? "Your sheets library is empty"
                : "Open a spreadsheet"}
          </h2>
          <p>
            {desktopAvailable
              ? "Add .ods files to library/sheets/, then refresh this collection."
              : "This Cloudflare build does not contain any published library sheets. You can still preview a local ODS file here."}
          </p>
          <button
            className="sheets-empty-open"
            type="button"
            disabled={loading}
            onClick={onOpenLocal}
          >
            <Icon icon="folder-open" aria-hidden="true" />
            Open local .ods
          </button>
          <small>Files opened locally stay on this device</small>
        </div>
      )}
    </section>
  );
}

export function SpreadsheetPanel({
  backLabel = "Back to sheets",
  document,
  error,
  selectedSheet,
  selectedSheetIndex,
  onBack,
  onOpen,
  onSelectSheet,
  onUpdateWorkbook,
}: {
  backLabel?: string;
  document: OpenedSpreadsheet;
  error: string;
  selectedSheet: OdsSheet;
  selectedSheetIndex: number;
  onBack: () => void;
  onOpen: () => void;
  onSelectSheet: (index: number) => void;
  onUpdateWorkbook: (workbook: OdsWorkbook) => void;
}) {
  const readOnly = document.readOnly === true;
  const [selectedCell, setSelectedCell] = useState({ rowIndex: 0, columnIndex: 0 });
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; columnIndex: number } | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [history, setHistory] = useState<OdsWorkbook[]>(() => [document.workbook]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState("");
  const selectedCellValue =
    selectedSheet.rows[selectedCell.rowIndex]?.[selectedCell.columnIndex];
  const [formulaInput, setFormulaInput] = useState(() =>
    cellInputValue(selectedCellValue),
  );
  const rowCount = Math.max(selectedSheet.rows.length, minimumPreviewRows);
  const columnCount = Math.max(
    Math.min(selectedSheet.columnCount, 64),
    minimumPreviewColumns,
  );
  const rowIndexes = useMemo(
    () => Array.from({ length: rowCount }, (_, index) => index),
    [rowCount],
  );
  const columnIndexes = useMemo(
    () => Array.from({ length: columnCount }, (_, index) => index),
    [columnCount],
  );

  useEffect(() => {
    setFormulaInput(cellInputValue(selectedCellValue));
  }, [selectedCellValue, selectedSheetIndex]);

  useEffect(() => {
    setSelectedCell({ rowIndex: 0, columnIndex: 0 });
    setEditingCell(null);
    setHistory([document.initialWorkbook]);
    setHistoryIndex(0);
    setSaveState("idle");
    setSaveError("");
  }, [document.initialWorkbook, document.sessionId]);

  const selectedCellLabel = `${spreadsheetColumnLabel(selectedCell.columnIndex)}${selectedCell.rowIndex + 1}`;
  const commitWorkbook = useCallback((workbook: OdsWorkbook) => {
    if (readOnly) return;
    setHistory((current) => [...current.slice(0, historyIndex + 1), workbook].slice(-50));
    setHistoryIndex((current) => Math.min(current + 1, 49));
    onUpdateWorkbook(workbook);
    setSaveState("idle");
    setSaveError("");
  }, [historyIndex, onUpdateWorkbook, readOnly]);

  const applyFormula = useCallback(() => {
    commitWorkbook(updateWorkbookCell(
      document.workbook,
      selectedSheetIndex,
      selectedCell.rowIndex,
      selectedCell.columnIndex,
      formulaInput,
    ));
  }, [
    commitWorkbook,
    document.workbook,
    formulaInput,
    selectedCell.columnIndex,
    selectedCell.rowIndex,
    selectedSheetIndex,
  ]);

  const startEditing = useCallback((rowIndex: number, columnIndex: number) => {
    if (readOnly) return;
    const cell = selectedSheet.rows[rowIndex]?.[columnIndex];
    setSelectedCell({ rowIndex, columnIndex });
    setFormulaInput(cellInputValue(cell));
    setEditingCell({ rowIndex, columnIndex });
    setEditingValue(cellInputValue(cell));
  }, [readOnly, selectedSheet.rows]);

  const finishEditing = useCallback((save: boolean) => {
    if (readOnly) return;
    if (!editingCell) return;
    if (save) {
      commitWorkbook(updateWorkbookCell(
        document.workbook,
        selectedSheetIndex,
        editingCell.rowIndex,
        editingCell.columnIndex,
        editingValue,
      ));
    }
    setEditingCell(null);
  }, [commitWorkbook, document.workbook, editingCell, editingValue, readOnly, selectedSheetIndex]);

  const moveSelection = useCallback((rowOffset: number, columnOffset: number) => {
    setSelectedCell((current) => ({
      rowIndex: Math.max(0, Math.min(rowCount - 1, current.rowIndex + rowOffset)),
      columnIndex: Math.max(0, Math.min(columnCount - 1, current.columnIndex + columnOffset)),
    }));
  }, [columnCount, rowCount]);

  const applyPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const plainText = event.clipboardData.getData("text/plain");
    if (!plainText) return;
    event.preventDefault();
    const updates = plainText.replace(/\r/g, "").split("\n").flatMap((line, rowOffset) =>
      line.split("\t").map((input, columnOffset) => ({
        rowIndex: selectedCell.rowIndex + rowOffset,
        columnIndex: selectedCell.columnIndex + columnOffset,
        input,
      })),
    );
    commitWorkbook(updateWorkbookCells(document.workbook, selectedSheetIndex, updates));
  }, [commitWorkbook, document.workbook, readOnly, selectedCell, selectedSheetIndex]);

  const undo = useCallback(() => {
    if (historyIndex === 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    onUpdateWorkbook(history[nextIndex]);
    setSaveState("idle");
  }, [history, historyIndex, onUpdateWorkbook]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    onUpdateWorkbook(history[nextIndex]);
    setSaveState("idle");
  }, [history, historyIndex, onUpdateWorkbook]);

  const download = useCallback(() => {
    const link = globalThis.document.createElement("a");
    const url = document.downloadPath ?? URL.createObjectURL(
      new Blob([createOdsArchive(document.workbook)], {
        type: "application/vnd.oasis.opendocument.spreadsheet",
      }),
    );
    link.href = url;
    link.download = document.fileName;
    link.click();
    if (!document.downloadPath) URL.revokeObjectURL(url);
    setSaveState("saved");
  }, [document]);

  const save = useCallback(async () => {
    if (!document.managedRelativePath || !window.castleDesktop) return;
    if (document.workbook.sheets.some((sheet) => sheet.truncated)) return;
    setSaveState("saving");
    setSaveError("");
    try {
      const saved = await window.castleDesktop.saveManagedSheet(
        document.managedRelativePath,
        createOdsArchive(document.workbook),
      );
      onUpdateWorkbook(document.workbook);
      setHistory([document.workbook]);
      setHistoryIndex(0);
      setSaveState("saved");
      void saved;
    } catch (reason) {
      setSaveState("idle");
      setSaveError(reason instanceof Error ? reason.message : "Castle could not save this spreadsheet.");
    }
  }, [document, onUpdateWorkbook]);

  const handleCellKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, rowIndex: number, columnIndex: number) => {
    if (!readOnly && (event.key === "Enter" || event.key === "F2")) {
      event.preventDefault();
      startEditing(rowIndex, columnIndex);
    } else if (event.key === "ArrowUp") { event.preventDefault(); moveSelection(-1, 0); }
    else if (event.key === "ArrowDown") { event.preventDefault(); moveSelection(1, 0); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); moveSelection(0, -1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); moveSelection(0, 1); }
  }, [moveSelection, readOnly, startEditing]);

  const saveDisabled = document.workbook.sheets.some((sheet) => sheet.truncated);

  return (
    <section className="sheets-panel sheets-preview-panel">
      <header className="sheets-document-header">
        <button
          aria-label={backLabel}
          className="sheets-back-button"
          type="button"
          onClick={onBack}
        >
          <Icon icon="arrow-left" aria-hidden="true" />
          <span>Sheets</span>
        </button>
        <div className="sheets-file-mark" aria-hidden="true">
          <Icon icon="th" size={17} />
        </div>
        <div className="sheets-document-title">
          <h1 title={document.fileName}>{document.fileName}</h1>
          <span>
            {document.sourcePath} · {formatFileSize(document.fileSize)}
          </span>
        </div>
        {!readOnly ? (
          <>
            <button type="button" onClick={onOpen}>
              <Icon icon="folder-open" aria-hidden="true" />
              <span>Replace file</span>
            </button>
            <button type="button" disabled={historyIndex === 0} onClick={undo}>
              <Icon icon="undo" aria-hidden="true" />
              <span>Undo</span>
            </button>
            <button type="button" disabled={historyIndex >= history.length - 1} onClick={redo}>
              <Icon icon="redo" aria-hidden="true" />
              <span>Redo</span>
            </button>
          </>
        ) : null}
        {document.managedRelativePath ? (
          <button type="button" disabled={saveState === "saving" || saveDisabled} onClick={() => void save()} title={saveDisabled ? "Saving is unavailable for a preview-limited workbook." : undefined}>
            <Icon icon={saveState === "saving" ? "refresh" : "floppy-disk"} aria-hidden="true" />
            <span>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save"}</span>
          </button>
        ) : (
          <button type="button" onClick={download}>
            <Icon icon="download" aria-hidden="true" />
            <span>{saveState === "saved" ? "Downloaded" : "Download"}</span>
          </button>
        )}
      </header>

      {error || saveError ? (
        <div className="sheets-preview-error" role="alert">
          <Icon icon="error" aria-hidden="true" />
          <span>{saveError || error}</span>
        </div>
      ) : null}

      <form
        aria-label="Cell formula"
        className="sheets-formula-bar"
        onSubmit={(event) => {
          event.preventDefault();
          if (!readOnly) applyFormula();
        }}
      >
        <label htmlFor="sheets-formula-input">{selectedCellLabel}</label>
        <span aria-hidden="true">fx</span>
        <input
          id="sheets-formula-input"
          placeholder="Type a value or formula, e.g. =SUM(A1:A5)"
          readOnly={readOnly}
          value={formulaInput}
          onChange={readOnly ? undefined : (event) => setFormulaInput(event.target.value)}
        />
        {!readOnly ? <button type="submit">Apply</button> : null}
      </form>

      <div
        aria-labelledby={`sheet-tab-${selectedSheetIndex}`}
        className="sheets-grid-scroll"
        id="sheets-grid-panel"
        role="tabpanel"
        onPaste={readOnly ? undefined : applyPaste}
      >
        <table aria-label={`${selectedSheet.name} spreadsheet preview`}>
          <colgroup>
            <col className="sheets-row-number-column" />
            {columnIndexes.map((columnIndex) => (
              <col key={columnIndex} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="sheets-grid-corner" aria-label="Row numbers" />
              {columnIndexes.map((columnIndex) => (
                <th key={columnIndex} scope="col">
                  {spreadsheetColumnLabel(columnIndex)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowIndexes.map((rowIndex) => {
              const row = selectedSheet.rows[rowIndex] ?? [];
              return (
                <tr key={rowIndex}>
                  <th scope="row">{rowIndex + 1}</th>
                  {columnIndexes.map((columnIndex) => {
                    const cell = row[columnIndex];
                    const isSelected =
                      selectedCell.rowIndex === rowIndex &&
                      selectedCell.columnIndex === columnIndex;
                    return (
                      <td
                        className={`${cell ? `sheets-cell--${cell.kind}` : ""}${isSelected ? " is-selected" : ""}`}
                        key={columnIndex}
                      >
                        {editingCell?.rowIndex === rowIndex && editingCell.columnIndex === columnIndex ? (
                          <input
                            aria-label={`Edit ${spreadsheetColumnLabel(columnIndex)}${rowIndex + 1}`}
                            autoFocus
                            className="sheets-cell-editor"
                            value={editingValue}
                            onBlur={() => finishEditing(true)}
                            onChange={(event) => setEditingValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") { event.preventDefault(); finishEditing(true); }
                              if (event.key === "Escape") { event.preventDefault(); finishEditing(false); }
                            }}
                          />
                        ) : (
                        <button
                          aria-label={`${spreadsheetColumnLabel(columnIndex)}${rowIndex + 1}${cell ? `: ${cell.value}` : ""}`}
                          title={cell?.formula || cell?.value}
                          type="button"
                          onClick={() => {
                            setSelectedCell({ rowIndex, columnIndex });
                            setFormulaInput(cellInputValue(cell));
                          }}
                          onDoubleClick={readOnly ? undefined : () => startEditing(rowIndex, columnIndex)}
                          onKeyDown={(event) => handleCellKeyDown(event, rowIndex, columnIndex)}
                        >
                          {cell?.value ?? ""}
                        </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="sheets-statusbar">
        <div aria-label="Sheets" className="sheets-tabs" role="tablist">
          {document.workbook.sheets.map((sheet, index) => (
            <button
              aria-controls="sheets-grid-panel"
              aria-selected={index === selectedSheetIndex}
              className={index === selectedSheetIndex ? "is-selected" : ""}
              id={`sheet-tab-${index}`}
              key={`${sheet.name}-${index}`}
              role="tab"
              type="button"
              onClick={() => onSelectSheet(index)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
        <div role="status">
          <span>{formatCount(selectedSheet.rowCount, "row")}</span>
          <i aria-hidden="true" />
          <span>{formatCount(selectedSheet.columnCount, "column")}</span>
          {selectedSheet.truncated ? (
            <>
              <i aria-hidden="true" />
              <span>Preview limited to 500 × 64</span>
            </>
          ) : null}
          <i aria-hidden="true" />
          <span>{readOnly
            ? "Read-only Cloudflare snapshot"
            : "Double-click to edit · Paste tabular data · SUM, AVERAGE, MIN, MAX, COUNT, ROUND"}</span>
        </div>
      </footer>
    </section>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function displaySheetName(fileName: string) {
  const withoutExtension = fileName.replace(/\.ods$/i, "");
  return withoutExtension
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function sheetFolder(relativePath: string) {
  const separatorIndex = relativePath.lastIndexOf("/");
  return separatorIndex === -1
    ? "library/sheets"
    : `library/sheets/${relativePath.slice(0, separatorIndex)}`;
}

function formatModifiedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
}

function formatCount(count: number, unit: string) {
  return `${count.toLocaleString()} ${unit}${count === 1 ? "" : "s"}`;
}
