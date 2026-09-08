import { Icon, Tooltip, type IconName } from "@patkepa/kantzen-ui/primitives";
import type { DidFailLoadEvent, WebviewTag } from "electron";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { Note } from "../../types";
import { validateNoteContent, useGeneratedResource } from "../../lib/generatedData";
import { useCastlePlatform } from "../../platform/castle_platform_provider";
import { connectionTargetAtPoint } from "./canvasConnections";
import {
  snapCanvasValue,
  snappedCanvasDragDelta,
} from "./canvasGrid";
import {
  resizedCanvasNode,
  type CanvasResizeDirection,
} from "./canvasResize";
import {
  createCanvasId,
  normalizeCanvasUrl,
  type CanvasColor,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSide,
  type CanvasTextNode,
  type JsonCanvas,
} from "./jsonCanvas";
import {
  canvasMediaAccept,
  canvasMediaKind,
  canvasMediaUrl,
} from "./canvasMedia";
import {
  canvasPinchTransform,
  canvasWheelZoomTransform,
  canvasZoomTransform,
  createCanvasPinchGesture,
  normalizedWheelDelta,
  type CanvasPinchGesture,
  type CanvasViewTransform,
  type CanvasViewportPoint,
} from "./canvasViewport";

type CanvasTool = "select" | "text" | "file" | "media" | "link" | "connect";
type CanvasPaletteTool = Exclude<CanvasTool, "connect">;
type EditorMode = "edit" | "preview";

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CardDialogState {
  type: "file" | "link";
  x: number;
  y: number;
  width: number;
  height: number;
  connectFrom?: ConnectionSource;
}

interface ConnectionDropMenuState {
  connectFrom: ConnectionSource;
  x: number;
  y: number;
  clientX: number;
  clientY: number;
}

interface ConnectionSource {
  nodeId: string;
  side?: CanvasSide;
}

interface ConnectionDraft {
  fromNodeId: string;
  fromSide: CanvasSide;
  to: { x: number; y: number };
  targetNodeId?: string;
  toSide?: CanvasSide;
}

type TouchInteraction =
  | {
      mode: "pan";
      pointerId: number;
      start: CanvasViewportPoint;
      startTransform: CanvasViewTransform;
      moved: boolean;
      tapNodeId?: string;
      onTap?: () => void;
      onDoubleTap?: () => void;
    }
  | {
      mode: "node";
      pointerId: number;
      start: CanvasViewportPoint;
      startTransform: CanvasViewTransform;
      original: JsonCanvas;
      node: CanvasNode;
      selection: Set<string>;
      moved: boolean;
      onDoubleTap?: () => void;
    }
  | {
      mode: "pinch";
      pointerIds: [number, number];
      gesture: CanvasPinchGesture;
    };

const minimumZoom = 0.25;
const maximumZoom = 2;
const pinchZoomSensitivity = 0.004;
const touchDragThreshold = 6;
const doubleTapDelay = 350;
const defaultNodeWidth = 280;
const defaultNodeHeight = 180;
const defaultMediaWidth = 360;
const defaultMediaHeight = 260;
const markdownPlugins = [remarkGfm, remarkBreaks];
const canvasColors: readonly (CanvasColor | undefined)[] = [
  undefined,
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
];
const canvasColorValues: Readonly<Record<string, string>> = {
  "1": "#e06c75",
  "2": "#d89448",
  "3": "#d9bd54",
  "4": "#66ad79",
  "5": "#56a9c7",
  "6": "#9578e5",
};
const toolItems: readonly {
  id: CanvasPaletteTool;
  label: string;
  icon: IconName;
  shortcut: string;
}[] = [
  { id: "select", label: "Select", icon: "select", shortcut: "V" },
  { id: "text", label: "Text card", icon: "document", shortcut: "T" },
  { id: "file", label: "Note or file", icon: "clipboard", shortcut: "F" },
  { id: "media", label: "Image or PDF", icon: "media", shortcut: "M" },
  { id: "link", label: "Web link", icon: "link", shortcut: "L" },
];

export function CanvasEditor({
  autoSave,
  data,
  fileName,
  notes,
  readOnly = false,
  onChange,
  onDownload,
  onImportMedia,
  onImportMediaError,
  onOpenMedia,
  onOpenNote,
  onSave,
  onSaveError,
}: {
  autoSave: boolean;
  data: JsonCanvas;
  fileName: string;
  notes: readonly Note[];
  readOnly?: boolean;
  onChange: (data: JsonCanvas) => void;
  onDownload?: (data: JsonCanvas) => void;
  onImportMedia?: (file: File) => Promise<{ file: string }>;
  onImportMediaError?: (reason: unknown) => void;
  onOpenMedia?: (file: string) => void | Promise<void>;
  onOpenNote: (note: Note) => void;
  onSave: (data: JsonCanvas) => Promise<void>;
  onSaveError?: (reason: unknown) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const initialNodesRef = useRef(data.nodes);
  const canvasRef = useRef(data);
  const saveRef = useRef(onSave);
  const saveErrorRef = useRef(onSaveError);
  const downloadRef = useRef(onDownload);
  const spacePressedRef = useRef(false);
  const activeTouchPointersRef = useRef(new Map<number, CanvasViewportPoint>());
  const touchInteractionRef = useRef<TouchInteraction | null>(null);
  const lastTouchTapRef = useRef<{
    nodeId: string;
    time: number;
    point: CanvasViewportPoint;
  } | null>(null);
  const dirtyRevisionRef = useRef(0);
  const queuedRevisionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [canvas, setCanvas] = useState(data);
  const [past, setPast] = useState<JsonCanvas[]>([]);
  const [future, setFuture] = useState<JsonCanvas[]>([]);
  const [tool, setTool] = useState<CanvasTool>("select");
  const mode: EditorMode = readOnly ? "preview" : "edit";
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [editingNodeId, setEditingNodeId] = useState("");
  const [connectSource, setConnectSource] = useState<ConnectionSource | null>(null);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null);
  const [connectionDropMenu, setConnectionDropMenu] = useState<ConnectionDropMenuState | null>(null);
  const [transform, setTransform] = useState<CanvasViewTransform>({ x: 0, y: 0, zoom: 1 });
  const transformRef = useRef(transform);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [placementRect, setPlacementRect] = useState<SelectionRect | null>(null);
  const [cardDialog, setCardDialog] = useState<CardDialogState | null>(null);
  const [mediaPlacement, setMediaPlacement] = useState<SelectionRect | null>(null);
  const [mediaDropActive, setMediaDropActive] = useState(false);
  const mediaPreviewUrlsRef = useRef(new Map<string, string>());
  const [mediaPreviewUrls, setMediaPreviewUrls] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [dirtyRevision, setDirtyRevision] = useState(0);

  canvasRef.current = canvas;
  saveRef.current = onSave;
  saveErrorRef.current = onSaveError;
  downloadRef.current = onDownload;
  transformRef.current = transform;

  const markDirty = useCallback(() => {
    dirtyRevisionRef.current += 1;
    setDirtyRevision(dirtyRevisionRef.current);
  }, []);

  const notesBySource = useMemo(
    () => new Map(notes.map((note) => [note.sourceFile, note])),
    [notes],
  );

  const availableToolItems = useMemo(
    () => onImportMedia
      ? toolItems
      : toolItems.filter((item) => item.id !== "media"),
    [onImportMedia],
  );

  useEffect(
    () => () => {
      for (const url of mediaPreviewUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
    },
    [],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const preventCanvasSelection = (event: Event) => {
      if (!isCanvasTextEditingTarget(event.target)) event.preventDefault();
    };
    viewport.addEventListener("selectstart", preventCanvasSelection);
    return () => viewport.removeEventListener("selectstart", preventCanvasSelection);
  }, []);

  const updateCanvas = useCallback(
    (next: JsonCanvas, recordHistory = true) => {
      if (readOnly) return;
      const current = canvasRef.current;
      if (next === current) return;
      if (recordHistory) {
        setPast((history) => [...history.slice(-49), current]);
        setFuture([]);
      }
      canvasRef.current = next;
      setCanvas(next);
      onChange(next);
      markDirty();
    },
    [markDirty, onChange, readOnly],
  );

  const applyMutation = useCallback(
    (mutate: (current: JsonCanvas) => JsonCanvas) => {
      updateCanvas(mutate(canvasRef.current));
    },
    [updateCanvas],
  );

  const saveNow = useCallback(() => {
    const revision = dirtyRevisionRef.current;
    if (revision <= queuedRevisionRef.current) return saveQueueRef.current;
    const snapshot = canvasRef.current;
    queuedRevisionRef.current = revision;
    const pendingSave = saveQueueRef.current.then(async () => {
      try {
        await saveRef.current(snapshot);
      } catch (reason) {
        if (queuedRevisionRef.current === revision) {
          queuedRevisionRef.current = Math.max(0, revision - 1);
        }
        saveErrorRef.current?.(reason);
      }
    });
    saveQueueRef.current = pendingSave;
    return pendingSave;
  }, []);

  const downloadNow = useCallback(() => {
    downloadRef.current?.(canvasRef.current);
  }, []);

  useEffect(() => {
    if (!autoSave || dirtyRevision === 0) return;
    const timeout = window.setTimeout(() => void saveNow(), 700);
    return () => window.clearTimeout(timeout);
  }, [autoSave, dirtyRevision, saveNow]);

  useEffect(
    () => () => {
      if (
        autoSave &&
        dirtyRevisionRef.current > queuedRevisionRef.current
      ) {
        void saveNow();
      }
    },
    [autoSave, saveNow],
  );

  const undo = useCallback(() => {
    setPast((history) => {
      const previous = history.at(-1);
      if (!previous) return history;
      const current = canvasRef.current;
      setFuture((redoHistory) => [current, ...redoHistory].slice(0, 50));
      canvasRef.current = previous;
      setCanvas(previous);
      onChange(previous);
      markDirty();
      return history.slice(0, -1);
    });
  }, [markDirty, onChange]);

  const redo = useCallback(() => {
    setFuture((history) => {
      const next = history[0];
      if (!next) return history;
      const current = canvasRef.current;
      setPast((undoHistory) => [...undoHistory.slice(-49), current]);
      canvasRef.current = next;
      setCanvas(next);
      onChange(next);
      markDirty();
      return history.slice(1);
    });
  }, [markDirty, onChange]);

  const deleteSelection = useCallback(() => {
    if (selectedEdgeId) {
      applyMutation((current) => ({
        ...current,
        edges: current.edges.filter((edge) => edge.id !== selectedEdgeId),
      }));
      setSelectedEdgeId("");
      return;
    }
    if (selectedNodeIds.size === 0) return;
    applyMutation((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !selectedNodeIds.has(node.id)),
      edges: current.edges.filter(
        (edge) =>
          !selectedNodeIds.has(edge.fromNode) &&
          !selectedNodeIds.has(edge.toNode),
      ),
    }));
    setSelectedNodeIds(new Set());
    setEditingNodeId("");
  }, [applyMutation, selectedEdgeId, selectedNodeIds]);

  const duplicateSelection = useCallback(() => {
    if (selectedNodeIds.size === 0) return;
    const idMap = new Map<string, string>();
    const duplicatedNodes = canvasRef.current.nodes.flatMap((node) => {
      if (!selectedNodeIds.has(node.id)) return [];
      const id = createCanvasId();
      idMap.set(node.id, id);
      return [{
        ...node,
        id,
        x: snapCanvasValue(node.x + 30),
        y: snapCanvasValue(node.y + 30),
      } as CanvasNode];
    });
    const duplicatedEdges = canvasRef.current.edges.flatMap((edge) => {
      const fromNode = idMap.get(edge.fromNode);
      const toNode = idMap.get(edge.toNode);
      return fromNode && toNode
        ? [{ ...edge, id: createCanvasId("edge"), fromNode, toNode }]
        : [];
    });
    applyMutation((current) => ({
      ...current,
      nodes: [...current.nodes, ...duplicatedNodes],
      edges: [...current.edges, ...duplicatedEdges],
    }));
    setSelectedNodeIds(new Set(idMap.values()));
  }, [applyMutation, selectedNodeIds]);

  const groupSelection = useCallback(() => {
    const selected = canvasRef.current.nodes.filter((node) => selectedNodeIds.has(node.id));
    const bounds = selected.length > 0 ? nodeBounds(selected) : viewportCenterBounds(viewportRef.current, transformRef.current, 520, 340);
    const group: CanvasNode = {
      id: createCanvasId(),
      type: "group",
      x: snapCanvasValue(bounds.x - 32),
      y: snapCanvasValue(bounds.y - 52),
      width: snapCanvasValue(bounds.width + 64),
      height: snapCanvasValue(bounds.height + 84),
      label: "New group",
    };
    applyMutation((current) => ({ ...current, nodes: [group, ...current.nodes] }));
    setSelectedNodeIds(new Set([group.id]));
    setTool("select");
  }, [applyMutation, selectedNodeIds]);

  const addTextNode = useCallback(
    (
      centerX?: number,
      centerY?: number,
      connectFrom?: ConnectionSource,
      placement?: SelectionRect,
    ) => {
      const center = viewportWorldCenter(viewportRef.current, transformRef.current);
      const x = centerX ?? center.x;
      const y = centerY ?? center.y;
      const node: CanvasTextNode = {
        id: createCanvasId(),
        type: "text",
        x: placement?.x ?? snapCanvasValue(x - defaultNodeWidth / 2),
        y: placement?.y ?? snapCanvasValue(y - defaultNodeHeight / 2),
        width: placement?.width ?? defaultNodeWidth,
        height: placement?.height ?? defaultNodeHeight,
        text: "# New idea\n\nStart writing…",
      };
      applyMutation((current) => ({
        ...current,
        nodes: [...current.nodes, node],
        edges: connectFrom
          ? [...current.edges, connectionEdge(current.nodes, connectFrom, node)]
          : current.edges,
      }));
      setSelectedNodeIds(new Set([node.id]));
      setSelectedEdgeId("");
      setEditingNodeId(node.id);
      setTool("select");
    },
    [applyMutation],
  );

  const openCardDialog = useCallback((
    type: "file" | "link",
    centerX?: number,
    centerY?: number,
    connectFrom?: ConnectionSource,
    placement?: SelectionRect,
  ) => {
    const center = viewportWorldCenter(viewportRef.current, transformRef.current);
    const x = centerX ?? center.x;
    const y = centerY ?? center.y;
    setCardDialog({
      type,
      x: placement?.x ?? snapCanvasValue(x - defaultNodeWidth / 2),
      y: placement?.y ?? snapCanvasValue(y - defaultNodeHeight / 2),
      width: placement?.width ?? defaultNodeWidth,
      height: placement?.height ?? (type === "link" ? 150 : defaultNodeHeight),
      connectFrom,
    });
  }, []);

  const importMediaFiles = useCallback(
    async (files: readonly File[], placement: SelectionRect) => {
      if (!onImportMedia || files.length === 0) return;
      const nodes: CanvasNode[] = [];
      let importError: unknown = null;

      for (const [index, file] of files.entries()) {
        const kind = canvasMediaKind(file.name, file.type);
        if (!kind) {
          importError ??= new Error("Canvas supports PNG, JPEG, GIF, WebP, and PDF files.");
          continue;
        }
        try {
          const imported = await onImportMedia(file);
          const importedKind = canvasMediaKind(imported.file) ?? kind;
          nodes.push({
            id: createCanvasId(),
            type: "file",
            x: snapCanvasValue(placement.x + index * 32),
            y: snapCanvasValue(placement.y + index * 32),
            width: placement.width,
            height: placement.height,
            file: imported.file,
          });
          if (importedKind === "image") {
            const previewUrl = URL.createObjectURL(file);
            mediaPreviewUrlsRef.current.set(imported.file, previewUrl);
          }
        } catch (reason) {
          importError ??= reason;
        }
      }

      if (nodes.length > 0) {
        setMediaPreviewUrls(new Map(mediaPreviewUrlsRef.current));
        applyMutation((current) => ({
          ...current,
          nodes: [...current.nodes, ...nodes],
        }));
        setSelectedNodeIds(new Set(nodes.map((node) => node.id)));
        setSelectedEdgeId("");
      }
      if (importError) onImportMediaError?.(importError);
    },
    [applyMutation, onImportMedia, onImportMediaError],
  );

  const requestMediaAt = useCallback((placement: SelectionRect) => {
    setMediaPlacement(placement);
    mediaInputRef.current?.click();
  }, []);

  const handleMediaInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      const placement = mediaPlacement ?? viewportCenterBounds(
        viewportRef.current,
        transformRef.current,
        defaultMediaWidth,
        defaultMediaHeight,
      );
      setMediaPlacement(null);
      setTool("select");
      void importMediaFiles(files, placement);
    },
    [importMediaFiles, mediaPlacement],
  );

  const handleMediaDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (mode !== "edit" || !onImportMedia || !isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      setMediaDropActive(false);
      const files = Array.from(event.dataTransfer.files);
      const mediaFiles = files.filter((file) => canvasMediaKind(file.name, file.type));
      if (mediaFiles.length === 0) {
        onImportMediaError?.(new Error("Canvas supports PNG, JPEG, GIF, WebP, and PDF files."));
        return;
      }
      const viewport = viewportRef.current;
      if (!viewport) return;
      const point = screenToWorld(
        event.clientX,
        event.clientY,
        viewport,
        transformRef.current,
      );
      void importMediaFiles(
        mediaFiles,
        {
          x: snapCanvasValue(point.x - defaultMediaWidth / 2),
          y: snapCanvasValue(point.y - defaultMediaHeight / 2),
          width: defaultMediaWidth,
          height: defaultMediaHeight,
        },
      );
    },
    [importMediaFiles, mode, onImportMedia, onImportMediaError],
  );

  const chooseTool = useCallback(
    (nextTool: CanvasPaletteTool) => {
      setTool(nextTool);
      setConnectSource(null);
    },
    [],
  );

  const fitToNodes = useCallback((nodes: readonly CanvasNode[]) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (nodes.length === 0) {
      setTransform({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2, zoom: 1 });
      return;
    }
    const bounds = nodeBounds(nodes);
    const padding = 110;
    const zoom = clamp(
      Math.min(
        (viewport.clientWidth - padding * 2) / Math.max(bounds.width, 1),
        (viewport.clientHeight - padding * 2) / Math.max(bounds.height, 1),
      ),
      minimumZoom,
      1.2,
    );
    setTransform({
      x: viewport.clientWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: viewport.clientHeight / 2 - (bounds.y + bounds.height / 2) * zoom,
      zoom,
    });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => fitToNodes(initialNodesRef.current));
    return () => window.cancelAnimationFrame(frame);
  }, [fitToNodes]);

  useEffect(() => {
    const setSpacePressed = (pressed: boolean) => {
      spacePressedRef.current = pressed;
      viewportRef.current?.classList.toggle("is-panning", pressed);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === " ") {
        event.preventDefault();
        setSpacePressed(true);
        return;
      }
      if (readOnly) {
        if (event.key === "Escape") {
          setEditingNodeId("");
          setConnectSource(null);
          setConnectionDraft(null);
          setConnectionDropMenu(null);
        }
        return;
      }
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLocaleLowerCase() === "a") {
        event.preventDefault();
        setSelectedNodeIds(new Set(canvasRef.current.nodes.map((node) => node.id)));
        setSelectedEdgeId("");
      } else if (command && event.key.toLocaleLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (command && event.key.toLocaleLowerCase() === "d") {
        event.preventDefault();
        duplicateSelection();
      } else if (command && event.key.toLocaleLowerCase() === "s") {
        event.preventDefault();
        if (downloadRef.current) downloadNow();
        else void saveNow();
      } else if (event.shiftKey && event.key === "1") {
        event.preventDefault();
        fitToNodes(canvasRef.current.nodes);
      } else if (event.shiftKey && event.key === "2") {
        event.preventDefault();
        fitToNodes(canvasRef.current.nodes.filter((node) => selectedNodeIds.has(node.id)));
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteSelection();
      } else if (event.key === "Escape") {
        setEditingNodeId("");
        setConnectSource(null);
        setConnectionDraft(null);
        setConnectionDropMenu(null);
        setTool("select");
      } else if (!command && !event.altKey && mode === "edit") {
        const shortcut = event.key.toLocaleLowerCase();
        const item = availableToolItems.find((candidate) => candidate.shortcut.toLocaleLowerCase() === shortcut);
        if (item) chooseTool(item.id);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") setSpacePressed(false);
    };
    const handleBlur = () => setSpacePressed(false);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [
    chooseTool,
    availableToolItems,
    deleteSelection,
    duplicateSelection,
    downloadNow,
    fitToNodes,
    mode,
    readOnly,
    redo,
    saveNow,
    selectedNodeIds,
    undo,
  ]);

  const beginNodeDrag = useCallback(
    (event: ReactPointerEvent, node: CanvasNode) => {
      if (mode !== "edit" || editingNodeId === node.id) return;
      event.preventDefault();
      const selection = selectedNodeIds.has(node.id)
        ? selectedNodeIds
        : new Set([node.id]);
      if (!selectedNodeIds.has(node.id)) setSelectedNodeIds(selection);
      setSelectedEdgeId("");
      const startX = event.clientX;
      const startY = event.clientY;
      const original = canvasRef.current;
      let moved = false;
      const handleMove = (moveEvent: PointerEvent) => {
        const dx = (moveEvent.clientX - startX) / transformRef.current.zoom;
        const dy = (moveEvent.clientY - startY) / transformRef.current.zoom;
        if (Math.abs(dx) + Math.abs(dy) < 1) return;
        const movement = moveEvent.shiftKey ? dominant(dx, dy) : { x: dx, y: dy };
        const snappedDelta = snappedCanvasDragDelta(node, movement);
        if (!moved && snappedDelta.x === 0 && snappedDelta.y === 0) return;
        moved = true;
        const next = {
          ...original,
          nodes: original.nodes.map((candidate) =>
            selection.has(candidate.id)
              ? {
                  ...candidate,
                  x: candidate.x + snappedDelta.x,
                  y: candidate.y + snappedDelta.y,
                }
              : candidate,
          ),
        };
        canvasRef.current = next;
        setCanvas(next);
      };
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        if (!moved) return;
        setPast((history) => [...history.slice(-49), original]);
        setFuture([]);
        onChange(canvasRef.current);
        markDirty();
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp, { once: true });
    },
    [editingNodeId, markDirty, mode, onChange, selectedNodeIds],
  );

  const beginResize = useCallback(
    (
      event: ReactPointerEvent,
      node: CanvasNode,
      direction: CanvasResizeDirection,
    ) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedNodeIds(new Set([node.id]));
      setSelectedEdgeId("");
      setEditingNodeId("");
      const startX = event.clientX;
      const startY = event.clientY;
      const original = canvasRef.current;
      let moved = false;
      const handleMove = (moveEvent: PointerEvent) => {
        const resized = resizedCanvasNode(
          node,
          direction,
          {
            x: (moveEvent.clientX - startX) / transformRef.current.zoom,
            y: (moveEvent.clientY - startY) / transformRef.current.zoom,
          },
          moveEvent.shiftKey,
        );
        if (
          !moved &&
          resized.x === node.x &&
          resized.y === node.y &&
          resized.width === node.width &&
          resized.height === node.height
        ) return;
        moved = true;
        const next = {
          ...original,
          nodes: original.nodes.map((candidate) =>
            candidate.id === node.id
              ? { ...candidate, ...resized }
              : candidate,
          ),
        };
        canvasRef.current = next;
        setCanvas(next);
      };
      const handleUp = () => {
        cleanup();
        if (!moved) return;
        setPast((history) => [...history.slice(-49), original]);
        setFuture([]);
        onChange(canvasRef.current);
        markDirty();
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", cleanup);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp, { once: true });
      window.addEventListener("pointercancel", cleanup, { once: true });
    },
    [markDirty, onChange],
  );

  const finishConnection = useCallback(
    (
      fromNode: CanvasNode,
      toNode: CanvasNode,
      requestedFromSide?: CanvasSide,
      requestedToSide?: CanvasSide,
    ) => {
      const [inferredFromSide, inferredToSide] = inferSides(fromNode, toNode);
      const edge: CanvasEdge = {
        id: createCanvasId("edge"),
        fromNode: fromNode.id,
        fromSide: requestedFromSide ?? inferredFromSide,
        fromEnd: "none",
        toNode: toNode.id,
        toSide: requestedToSide ?? inferredToSide,
        toEnd: "arrow",
      };
      applyMutation((current) => ({ ...current, edges: [...current.edges, edge] }));
      setConnectSource(null);
      setConnectionDraft(null);
      setSelectedNodeIds(new Set());
      setSelectedEdgeId(edge.id);
      setTool("select");
    },
    [applyMutation],
  );

  const connectNode = useCallback(
    (node: CanvasNode) => {
      if (!connectSource) {
        setConnectSource({ nodeId: node.id });
        setSelectedNodeIds(new Set([node.id]));
        return;
      }
      if (connectSource.nodeId === node.id) {
        setConnectSource(null);
        return;
      }
      const fromNode = canvasRef.current.nodes.find(
        (candidate) => candidate.id === connectSource.nodeId,
      );
      if (!fromNode) return;
      finishConnection(fromNode, node, connectSource.side);
    },
    [connectSource, finishConnection],
  );

  const beginConnectionDrag = useCallback(
    (event: ReactPointerEvent, node: CanvasNode, fromSide: CanvasSide) => {
      if (mode !== "edit" || event.button !== 0) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      event.preventDefault();
      event.stopPropagation();

      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const start = connectionPoint(node, fromSide);
      let moved = false;
      setTool("select");
      setConnectSource(null);
      setSelectedNodeIds(new Set([node.id]));
      setSelectedEdgeId("");
      setConnectionDraft({
        fromNodeId: node.id,
        fromSide,
        to: start,
      });
      setConnectionDropMenu(null);

      const draftAt = (clientX: number, clientY: number) => {
        const point = screenToWorld(clientX, clientY, viewport, transformRef.current);
        const target = connectionTargetAtPoint(canvasRef.current.nodes, node.id, point);
        return {
          fromNodeId: node.id,
          fromSide,
          to: target ? connectionPoint(target.node, target.side) : point,
          targetNodeId: target?.node.id,
          toSide: target?.side,
        } satisfies ConnectionDraft;
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
      };
      const handleMove = (moveEvent: PointerEvent) => {
        if (
          !moved &&
          Math.hypot(
            moveEvent.clientX - startClientX,
            moveEvent.clientY - startClientY,
          ) < 4
        ) {
          return;
        }
        moved = true;
        setConnectionDraft(draftAt(moveEvent.clientX, moveEvent.clientY));
      };
      const handleUp = (upEvent: PointerEvent) => {
        cleanup();
        const didDrag =
          moved ||
          Math.hypot(
            upEvent.clientX - startClientX,
            upEvent.clientY - startClientY,
          ) >= 4;
        if (!didDrag) {
          setConnectionDraft(null);
          setTool("connect");
          setConnectSource({ nodeId: node.id, side: fromSide });
          return;
        }

        const draft = draftAt(upEvent.clientX, upEvent.clientY);
        setConnectionDraft(null);
        const targetNode = draft.targetNodeId
          ? canvasRef.current.nodes.find(
              (candidate) => candidate.id === draft.targetNodeId,
            )
          : undefined;
        if (targetNode) {
          finishConnection(node, targetNode, fromSide, draft.toSide);
          return;
        }
        const bounds = viewport.getBoundingClientRect();
        setConnectionDropMenu({
          connectFrom: { nodeId: node.id, side: fromSide },
          x: draft.to.x,
          y: draft.to.y,
          clientX: upEvent.clientX - bounds.left,
          clientY: upEvent.clientY - bounds.top,
        });
      };
      const handleCancel = () => {
        cleanup();
        setConnectionDraft(null);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp, { once: true });
      window.addEventListener("pointercancel", handleCancel, { once: true });
    },
    [finishConnection, mode],
  );

  const commitTouchNodeDrag = useCallback(
    (interaction: Extract<TouchInteraction, { mode: "node" }>) => {
      if (!interaction.moved) return;
      setPast((history) => [...history.slice(-49), interaction.original]);
      setFuture([]);
      onChange(canvasRef.current);
      markDirty();
    },
    [markDirty, onChange],
  );

  const startTouchPinch = useCallback(() => {
    const pointers = Array.from(activeTouchPointersRef.current.entries());
    if (pointers.length < 2) return false;
    const currentInteraction = touchInteractionRef.current;
    if (currentInteraction?.mode === "node") {
      commitTouchNodeDrag(currentInteraction);
    }
    const [firstId, first] = pointers[0]!;
    const [secondId, second] = pointers[1]!;
    touchInteractionRef.current = {
      mode: "pinch",
      pointerIds: [firstId, secondId],
      gesture: createCanvasPinchGesture(transformRef.current, first, second),
    };
    const viewport = viewportRef.current;
    viewport?.classList.remove("is-touch-panning");
    viewport?.classList.add("is-pinching");
    setSelectionRect(null);
    setPlacementRect(null);
    return true;
  }, [commitTouchNodeDrag]);

  const beginTouchPointer = useCallback(
    (
      event: ReactPointerEvent,
      node?: CanvasNode,
      onTap?: () => void,
      onDoubleTap?: () => void,
    ) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      event.preventDefault();
      event.stopPropagation();
      const point = pointerToViewportPoint(event.clientX, event.clientY, viewport);
      activeTouchPointersRef.current.set(event.pointerId, point);
      viewport.setPointerCapture(event.pointerId);

      if (startTouchPinch()) return;

      if (node && mode === "edit") {
        const selection = selectedNodeIds.has(node.id)
          ? selectedNodeIds
          : new Set([node.id]);
        if (!selectedNodeIds.has(node.id)) setSelectedNodeIds(selection);
        setSelectedEdgeId("");
        touchInteractionRef.current = {
          mode: "node",
          pointerId: event.pointerId,
          start: point,
          startTransform: transformRef.current,
          original: canvasRef.current,
          node,
          selection,
          moved: false,
          onDoubleTap,
        };
      } else {
        if (mode === "edit" && !node) {
          setSelectedNodeIds(new Set());
          setSelectedEdgeId("");
          setEditingNodeId("");
          setConnectionDropMenu(null);
        }
        touchInteractionRef.current = {
          mode: "pan",
          pointerId: event.pointerId,
          start: point,
          startTransform: transformRef.current,
          moved: false,
          tapNodeId: node?.id,
          onTap,
          onDoubleTap,
        };
      }
      viewport.classList.add("is-touch-panning");
    },
    [mode, selectedNodeIds, startTouchPinch],
  );

  const handleTouchPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!activeTouchPointersRef.current.has(event.pointerId)) return;
      event.preventDefault();
      const viewport = viewportRef.current;
      if (!viewport) return;
      const point = pointerToViewportPoint(event.clientX, event.clientY, viewport);
      activeTouchPointersRef.current.set(event.pointerId, point);
      const interaction = touchInteractionRef.current;
      if (!interaction) return;

      if (interaction.mode === "pinch") {
        const [firstId, secondId] = interaction.pointerIds;
        const first = activeTouchPointersRef.current.get(firstId);
        const second = activeTouchPointersRef.current.get(secondId);
        if (!first || !second) return;
        const next = canvasPinchTransform(
          interaction.gesture,
          first,
          second,
          minimumZoom,
          maximumZoom,
        );
        transformRef.current = next;
        setTransform(next);
        return;
      }

      if (interaction.pointerId !== event.pointerId) return;
      const dx = point.x - interaction.start.x;
      const dy = point.y - interaction.start.y;
      const exceededDragThreshold =
        Math.hypot(dx, dy) >= touchDragThreshold;

      if (interaction.mode === "pan") {
        interaction.moved ||= exceededDragThreshold;
        if (!interaction.moved) return;
        const next = {
          ...interaction.startTransform,
          x: interaction.startTransform.x + dx,
          y: interaction.startTransform.y + dy,
        };
        transformRef.current = next;
        setTransform(next);
        return;
      }

      if (!interaction.moved && !exceededDragThreshold) return;
      const movement = {
        x: dx / interaction.startTransform.zoom,
        y: dy / interaction.startTransform.zoom,
      };
      const snappedDelta = snappedCanvasDragDelta(interaction.node, movement);
      if (snappedDelta.x === 0 && snappedDelta.y === 0) return;
      interaction.moved = true;
      const next = {
        ...interaction.original,
        nodes: interaction.original.nodes.map((candidate) =>
          interaction.selection.has(candidate.id)
            ? {
                ...candidate,
                x: candidate.x + snappedDelta.x,
                y: candidate.y + snappedDelta.y,
              }
            : candidate,
        ),
      };
      canvasRef.current = next;
      setCanvas(next);
    },
    [],
  );

  const finishTouchPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
      if (!activeTouchPointersRef.current.has(event.pointerId)) return;
      event.preventDefault();
      activeTouchPointersRef.current.delete(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const interaction = touchInteractionRef.current;
      if (!interaction) return;

      if (interaction.mode === "pinch") {
        if (activeTouchPointersRef.current.size >= 2) {
          startTouchPinch();
          return;
        }
        const remaining = activeTouchPointersRef.current.entries().next().value as
          [number, CanvasViewportPoint] | undefined;
        if (remaining) {
          const [pointerId, point] = remaining;
          touchInteractionRef.current = {
            mode: "pan",
            pointerId,
            start: point,
            startTransform: transformRef.current,
            moved: true,
          };
          event.currentTarget.classList.remove("is-pinching");
          event.currentTarget.classList.add("is-touch-panning");
          return;
        }
      } else if (interaction.pointerId !== event.pointerId) {
        return;
      }

      if (interaction.mode === "node") {
        commitTouchNodeDrag(interaction);
      }

      if (!cancelled && interaction.mode !== "pinch" && !interaction.moved) {
        const nodeId = interaction.mode === "node"
          ? interaction.node.id
          : interaction.tapNodeId;
        const onDoubleTap = interaction.onDoubleTap;
        if (nodeId && onDoubleTap) {
          const point = interaction.start;
          const previous = lastTouchTapRef.current;
          const isDoubleTap = Boolean(
            previous &&
            previous.nodeId === nodeId &&
            event.timeStamp - previous.time <= doubleTapDelay &&
            Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= touchDragThreshold * 2,
          );
          if (isDoubleTap) {
            lastTouchTapRef.current = null;
            onDoubleTap();
          } else {
            lastTouchTapRef.current = {
              nodeId,
              time: event.timeStamp,
              point,
            };
            if (interaction.mode === "pan") interaction.onTap?.();
          }
        } else if (interaction.mode === "pan") {
          interaction.onTap?.();
        }
      }

      touchInteractionRef.current = null;
      event.currentTarget.classList.remove("is-pinching", "is-touch-panning");
    },
    [commitTouchNodeDrag, startTouchPinch],
  );

  const beginCanvasPan = useCallback(
    (
      event: ReactPointerEvent,
      callbacks?: {
        onClick?: () => void;
        onPanStart?: () => void;
      },
    ) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startTransform = transformRef.current;
      let moved = false;
      viewport.classList.add("is-drag-panning");
      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
        viewport.classList.remove("is-drag-panning");
      };
      const handleMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        if (!moved) {
          moved = true;
          callbacks?.onPanStart?.();
        }
        const next = {
          ...startTransform,
          x: startTransform.x + dx,
          y: startTransform.y + dy,
        };
        transformRef.current = next;
        setTransform(next);
      };
      const handleUp = () => {
        cleanup();
        if (!moved) callbacks?.onClick?.();
      };
      const handleCancel = () => cleanup();
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp, { once: true });
      window.addEventListener("pointercancel", handleCancel, { once: true });
    },
    [],
  );

  const handleNodePointerDown = useCallback(
    (
      event: ReactPointerEvent,
      node: CanvasNode,
      onTap?: () => void,
      onDoubleTap?: () => void,
    ) => {
      if (spacePressedRef.current || event.button === 1) return;
      const target = event.target as HTMLElement;
      const startedOnImage = Boolean(
        target.closest(".canvas-media-card, .canvas-markdown img"),
      );
      const selectNode = () => {
        if (!selectedNodeIds.has(node.id)) {
          setSelectedNodeIds(new Set([node.id]));
        }
        setSelectedEdgeId("");
      };
      if (event.pointerType === "touch" && tool === "select") {
        if (startedOnImage) {
          beginTouchPointer(
            event,
            undefined,
            mode === "edit" ? selectNode : onTap,
          );
          return;
        }
        if (!startedOnImage && target.closest("textarea, input, button, a")) return;
        beginTouchPointer(event, node, onTap, onDoubleTap);
        return;
      }
      if (tool === "connect") {
        event.stopPropagation();
        connectNode(node);
        return;
      }
      if (!startedOnImage && target.closest("textarea, input, button, a")) return;
      event.stopPropagation();
      if (
        mode === "edit" &&
        event.button === 0 &&
        tool === "select" &&
        !event.shiftKey &&
        startedOnImage
      ) {
        beginCanvasPan(event, {
          onClick: selectNode,
          onPanStart: () => {
            setSelectedNodeIds(new Set());
            setSelectedEdgeId("");
          },
        });
        return;
      }
      if (event.shiftKey) {
        setSelectedNodeIds((current) => {
          const next = new Set(current);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
      } else if (!selectedNodeIds.has(node.id)) {
        setSelectedNodeIds(new Set([node.id]));
      }
      beginNodeDrag(event, node);
    },
    [
      beginCanvasPan,
      beginNodeDrag,
      beginTouchPointer,
      connectNode,
      mode,
      selectedNodeIds,
      tool,
    ],
  );

  const beginViewportPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget && (event.target as HTMLElement).closest(".canvas-stage, .canvas-connection-menu")) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      if (event.pointerType === "touch" && tool === "select") {
        beginTouchPointer(event);
        return;
      }
      const isDirectCanvasPan =
        event.button === 0 &&
        tool === "select" &&
        !event.shiftKey;
      const shouldPan =
        event.button === 1 ||
        spacePressedRef.current ||
        mode === "preview" ||
        isDirectCanvasPan;
      if (shouldPan) {
        if (isDirectCanvasPan && mode === "edit") {
          setSelectedNodeIds(new Set());
          setSelectedEdgeId("");
          setEditingNodeId("");
          setConnectionDropMenu(null);
        }
        beginCanvasPan(event);
        return;
      }
      if (tool !== "select") {
        if (event.button !== 0 || tool === "connect") return;
        event.preventDefault();
        const start = screenToWorld(event.clientX, event.clientY, viewport, transformRef.current);
        const defaultHeight = tool === "link"
          ? 150
          : tool === "media"
            ? defaultMediaHeight
            : defaultNodeHeight;
        const defaultWidth = tool === "media" ? defaultMediaWidth : defaultNodeWidth;
        const boundsAt = (clientX: number, clientY: number) => cardPlacementBounds(
          start,
          screenToWorld(clientX, clientY, viewport, transformRef.current),
          defaultHeight,
          defaultWidth,
        );
        setPlacementRect(boundsAt(event.clientX, event.clientY));
        const cleanup = () => {
          window.removeEventListener("pointermove", handleMove);
          window.removeEventListener("pointerup", handleUp);
          window.removeEventListener("pointercancel", handleCancel);
        };
        const handleMove = (moveEvent: PointerEvent) => {
          setPlacementRect(boundsAt(moveEvent.clientX, moveEvent.clientY));
        };
        const handleUp = (upEvent: PointerEvent) => {
          cleanup();
          const bounds = boundsAt(upEvent.clientX, upEvent.clientY);
          setPlacementRect(null);
          if (tool === "text") addTextNode(undefined, undefined, undefined, bounds);
          else if (tool === "media") requestMediaAt(bounds);
          else if (tool === "file" || tool === "link") {
            openCardDialog(tool, undefined, undefined, undefined, bounds);
          }
        };
        const handleCancel = () => {
          cleanup();
          setPlacementRect(null);
        };
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp, { once: true });
        window.addEventListener("pointercancel", handleCancel, { once: true });
        return;
      }
      setSelectedNodeIds(new Set());
      setSelectedEdgeId("");
      setEditingNodeId("");
      setConnectionDropMenu(null);
      const start = screenToWorld(event.clientX, event.clientY, viewport, transformRef.current);
      const handleMove = (moveEvent: PointerEvent) => {
        const current = screenToWorld(moveEvent.clientX, moveEvent.clientY, viewport, transformRef.current);
        setSelectionRect(rectFromPoints(start, current));
      };
      const handleUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        const end = screenToWorld(upEvent.clientX, upEvent.clientY, viewport, transformRef.current);
        const rect = rectFromPoints(start, end);
        if (rect.width > 3 || rect.height > 3) {
          setSelectedNodeIds(new Set(
            canvasRef.current.nodes
              .filter((node) => rectanglesIntersect(rect, node))
              .map((node) => node.id),
          ));
        }
        setSelectionRect(null);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp, { once: true });
    },
    [
      addTextNode,
      beginCanvasPan,
      beginTouchPointer,
      mode,
      openCardDialog,
      requestMediaAt,
      tool,
    ],
  );

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const deltaY = normalizedWheelDelta(
      event.deltaY,
      event.deltaMode,
      viewport.clientHeight,
    );
    const rect = viewport.getBoundingClientRect();
    const pointX = event.clientX - rect.left;
    const pointY = event.clientY - rect.top;
    setTransform((current) => {
      const next = canvasWheelZoomTransform(
        current,
        deltaY,
        { x: pointX, y: pointY },
        pinchZoomSensitivity,
        minimumZoom,
        maximumZoom,
      );
      transformRef.current = next;
      return next;
    });
  }, []);

  const selectedNodes = canvas.nodes.filter((node) => selectedNodeIds.has(node.id));
  const selectedEdge = canvas.edges.find((edge) => edge.id === selectedEdgeId);

  const activateNode = useCallback((node: CanvasNode) => {
    if (node.type === "file") {
      if (canvasMediaKind(node.file) && onOpenMedia) {
        void onOpenMedia(node.file);
      } else {
        const note = notesBySource.get(node.file);
        if (note) onOpenNote(note);
      }
    } else if (node.type === "link") {
      openCanvasUrl(node.url);
    }
  }, [notesBySource, onOpenMedia, onOpenNote]);

  const editNode = useCallback((node: CanvasNode) => {
    if (node.type === "file" || node.type === "link") {
      activateNode(node);
    } else if (node.type === "text") {
      setEditingNodeId(node.id);
    } else if (node.type === "group") {
      const label = window.prompt("Group name", node.label ?? "");
      if (label !== null) {
        applyMutation((current) => ({
          ...current,
          nodes: current.nodes.map((candidate) =>
            candidate.id === node.id && candidate.type === "group"
              ? { ...candidate, label: label.trim() || undefined }
              : candidate,
          ),
        }));
      }
    }
  }, [activateNode, applyMutation]);

  const setSelectionColor = useCallback(
    (color: CanvasColor | undefined) => {
      if (selectedEdgeId) {
        applyMutation((current) => ({
          ...current,
          edges: current.edges.map((edge) =>
            edge.id === selectedEdgeId ? withColor(edge, color) : edge,
          ),
        }));
      } else if (selectedNodeIds.size > 0) {
        applyMutation((current) => ({
          ...current,
          nodes: current.nodes.map((node) =>
            selectedNodeIds.has(node.id) ? withColor(node, color) : node,
          ),
        }));
      }
    },
    [applyMutation, selectedEdgeId, selectedNodeIds],
  );

  const editEdgeLabel = useCallback((edgeId = selectedEdgeId) => {
    const edge = canvasRef.current.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) return;
    const label = window.prompt("Connection label", edge.label ?? "");
    if (label === null) return;
    applyMutation((current) => ({
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === edgeId
          ? { ...edge, label: label.trim() || undefined }
          : edge,
      ),
    }));
  }, [applyMutation, selectedEdgeId]);

  const zoomAroundCenter = useCallback((value: number, absolute = false) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setTransform((current) => {
      const zoom = clamp(
        absolute ? value : current.zoom * value,
        minimumZoom,
        maximumZoom,
      );
      const centerX = viewport.clientWidth / 2;
      const centerY = viewport.clientHeight / 2;
      const next = canvasZoomTransform(current, zoom, { x: centerX, y: centerY });
      transformRef.current = next;
      return next;
    });
  }, []);

  const viewportStyle = {
    "--canvas-pan-x": `${transform.x}px`,
    "--canvas-pan-y": `${transform.y}px`,
    "--canvas-grid-size": `${24 * transform.zoom}px`,
  } as CSSProperties;

  return (
    <div className="canvas-editor">
      <header className="canvas-editor-toolbar">
        <div className="canvas-document-title">
          <Icon icon="grid-view" aria-hidden="true" />
          <strong>{fileName}</strong>
        </div>
        {readOnly ? (
          <span className="canvas-readonly-notice">Read-only Cloudflare snapshot</span>
        ) : (
          <div className="canvas-history-controls">
            <ToolbarButton icon="undo" label="Undo" disabled={past.length === 0} onClick={undo} />
            <ToolbarButton icon="redo" label="Redo" disabled={future.length === 0} onClick={redo} />
          </div>
        )}
        <div className="canvas-toolbar-actions">
          {onDownload ? (
            <ToolbarButton icon="download" label="Download .canvas" onClick={downloadNow} />
          ) : null}
          <ToolbarButton icon="maximize" label="Zoom to fit" onClick={() => fitToNodes(canvas.nodes)} />
        </div>
      </header>

      <div
        className={`canvas-viewport is-${mode}${tool !== "select" ? ` is-tool-${tool}` : ""}${connectionDraft ? " is-connecting" : ""}${mediaDropActive ? " is-media-drop-active" : ""}`}
        ref={viewportRef}
        style={viewportStyle}
        onDoubleClick={(event) => {
          event.preventDefault();
          if (mode !== "edit" || event.target !== event.currentTarget) return;
          const point = screenToWorld(event.clientX, event.clientY, event.currentTarget, transformRef.current);
          addTextNode(point.x, point.y);
        }}
        onDragEnter={(event) => {
          if (mode !== "edit" || !onImportMedia || !isFileDrag(event.dataTransfer)) return;
          event.preventDefault();
          setMediaDropActive(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setMediaDropActive(false);
          }
        }}
        onDragOver={(event) => {
          if (mode !== "edit" || !onImportMedia || !isFileDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={handleMediaDrop}
        onDragStart={(event) => {
          if (!isCanvasTextEditingTarget(event.target)) {
            event.preventDefault();
          }
        }}
        onPointerDown={beginViewportPointer}
        onPointerMove={handleTouchPointerMove}
        onPointerUp={finishTouchPointer}
        onPointerCancel={(event) => finishTouchPointer(event, true)}
        onWheel={handleWheel}
      >
        <div
          className="canvas-stage"
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})` }}
        >
          <CanvasEdges
            canvas={canvas}
            connectionDraft={connectionDraft}
            selectedEdgeId={selectedEdgeId}
            onEditLabel={editEdgeLabel}
            onSelect={(edgeId) => {
              if (mode === "preview") return;
              setSelectedEdgeId(edgeId);
              setSelectedNodeIds(new Set());
              setEditingNodeId("");
            }}
          />
          {canvas.nodes.map((node, index) => (
            <CanvasNodeCard
              connectSource={connectSource?.nodeId === node.id || connectionDraft?.fromNodeId === node.id}
              connectTarget={connectionDraft?.targetNodeId === node.id}
              editing={editingNodeId === node.id}
              index={index}
              key={node.id}
              mode={mode}
              node={node}
              note={node.type === "file" ? notesBySource.get(node.file) : undefined}
              mediaUrl={node.type === "file" ? mediaPreviewUrls.get(node.file) : undefined}
              selected={selectedNodeIds.has(node.id)}
              onChangeText={(text) => {
                const next = {
                  ...canvasRef.current,
                  nodes: canvasRef.current.nodes.map((candidate) =>
                    candidate.id === node.id && candidate.type === "text"
                      ? { ...candidate, text }
                      : candidate,
                  ),
                };
                updateCanvas(next);
              }}
              onDoubleClick={() => {
                if (mode === "edit") editNode(node);
              }}
              onActivate={
                mode !== "preview"
                  ? undefined
                  : node.type === "file"
                    ? () => activateNode(node)
                    : node.type === "link"
                      ? () => activateNode(node)
                      : undefined
              }
              onPointerDown={(event) => handleNodePointerDown(
                event,
                node,
                mode === "preview" && (node.type === "file" || node.type === "link")
                  ? () => activateNode(node)
                  : undefined,
                mode === "edit" ? () => editNode(node) : undefined,
              )}
              onResize={(event, direction) => beginResize(event, node, direction)}
              onStartConnect={(side) => {
                setTool("connect");
                setConnectSource({ nodeId: node.id, side });
                setSelectedNodeIds(new Set([node.id]));
                setSelectedEdgeId("");
              }}
              onStartConnectDrag={(event, side) => beginConnectionDrag(event, node, side)}
              onStopEditing={() => setEditingNodeId("")}
            />
          ))}
          {selectionRect ? (
            <div className="canvas-marquee" style={nodeRectStyle(selectionRect)} />
          ) : null}
          {placementRect ? (
            <div className="canvas-placement-preview" style={nodeRectStyle(placementRect)} />
          ) : null}
          {mode === "edit" && (selectedNodes.length > 0 || selectedEdge) ? (
            <SelectionToolbar
              edge={selectedEdge}
              nodes={selectedEdge
                ? canvas.nodes.filter(
                    (node) =>
                      node.id === selectedEdge.fromNode ||
                      node.id === selectedEdge.toNode,
                  )
                : selectedNodes}
              onColor={setSelectionColor}
              onDelete={deleteSelection}
              onDuplicate={duplicateSelection}
              onEditLabel={() => editEdgeLabel(selectedEdge?.id)}
              onGroup={groupSelection}
            />
          ) : null}
        </div>

        {mode === "edit" ? (
          <nav className="canvas-tool-palette" aria-label="Canvas tools">
            {availableToolItems.map((item) => (
              <Tooltip
                content={
                  <span className="canvas-tool-tooltip-content">
                    <strong>{item.label}</strong>
                    <kbd>{item.shortcut}</kbd>
                  </span>
                }
                hoverCloseDelay={0}
                hoverOpenDelay={180}
                key={item.id}
                openOnTargetFocus
                popoverClassName="canvas-tool-tooltip"
                position="right"
              >
                <button
                  className={tool === item.id ? "is-active" : ""}
                  type="button"
                  aria-label={`${item.label} (${item.shortcut})`}
                  onClick={() => chooseTool(item.id)}
                >
                  <Icon icon={item.icon} aria-hidden="true" />
                </button>
              </Tooltip>
            ))}
          </nav>
        ) : null}

        {connectionDraft && mode === "edit" ? (
          <div className="canvas-tool-hint">
            {connectionDraft.targetNodeId ? "Release to connect" : "Drag to another card"}
            <span>Esc to cancel</span>
          </div>
        ) : tool === "connect" && mode === "edit" ? (
          <div className="canvas-tool-hint">
            {connectSource ? "Choose a target card" : "Choose a source card"}
            <span>Esc to cancel</span>
          </div>
        ) : null}

        {connectionDropMenu && mode === "edit" ? (
          <ConnectionDropMenu
            state={connectionDropMenu}
            onAddLibraryCard={() => {
              openCardDialog(
                "file",
                connectionDropMenu.x,
                connectionDropMenu.y,
                connectionDropMenu.connectFrom,
              );
              setConnectionDropMenu(null);
            }}
            onAddTextCard={() => {
              addTextNode(
                connectionDropMenu.x,
                connectionDropMenu.y,
                connectionDropMenu.connectFrom,
              );
              setConnectionDropMenu(null);
            }}
            onCancel={() => setConnectionDropMenu(null)}
          />
        ) : null}

        {tool !== "select" && tool !== "connect" && mode === "edit" ? (
          <div className="canvas-tool-hint">
            Click to place, or drag to size {tool === "text" ? "a text card" : tool === "file" ? "a note card" : tool === "media" ? "an image or PDF" : "a web link"}
            <span>Esc to cancel</span>
          </div>
        ) : null}

        {mediaDropActive && mode === "edit" ? (
          <div className="canvas-media-drop-hint" role="status">
            <Icon icon="media" aria-hidden="true" />
            Drop image or PDF to add it
          </div>
        ) : null}

        {canvas.nodes.length === 0 && mode === "edit" ? (
          <div className="canvas-empty-state">
            <Icon icon="new-object" size={24} aria-hidden="true" />
            <strong>Start with a card</strong>
            <span>{onImportMedia ? "Double-click, choose a tool, or drop an image or PDF." : "Double-click the canvas or choose a tool."}</span>
          </div>
        ) : null}

        <div className="canvas-zoom-controls" aria-label="Canvas zoom">
          <ToolbarButton icon="minus" label="Zoom out" onClick={() => zoomAroundCenter(0.85)} />
          <button type="button" aria-label="Reset zoom to 100%" title="Reset zoom to 100%" onClick={() => zoomAroundCenter(1, true)}>
            {Math.round(transform.zoom * 100)}%
          </button>
          <ToolbarButton icon="plus" label="Zoom in" onClick={() => zoomAroundCenter(1.15)} />
          <ToolbarButton icon="zoom-to-fit" label="Zoom to fit" onClick={() => fitToNodes(canvas.nodes)} />
        </div>
      </div>

      {onImportMedia ? (
        <input
          ref={mediaInputRef}
          accept={canvasMediaAccept}
          className="sr-only"
          multiple
          type="file"
          onChange={handleMediaInput}
        />
      ) : null}

      {cardDialog ? (
        <CardDialog
          notes={notes}
          state={cardDialog}
          onCancel={() => setCardDialog(null)}
          onCreate={(value) => {
            const node: CanvasNode = cardDialog.type === "file"
              ? {
                  id: createCanvasId(),
                  type: "file",
                  x: cardDialog.x,
                  y: cardDialog.y,
                  width: cardDialog.width,
                  height: cardDialog.height,
                  file: value,
                }
              : {
                  id: createCanvasId(),
                  type: "link",
                  x: cardDialog.x,
                  y: cardDialog.y,
                  width: cardDialog.width,
                  height: cardDialog.height,
                  url: value,
                };
            applyMutation((current) => ({
              ...current,
              nodes: [...current.nodes, node],
              edges: cardDialog.connectFrom
                ? [...current.edges, connectionEdge(current.nodes, cardDialog.connectFrom, node)]
                : current.edges,
            }));
            setSelectedNodeIds(new Set([node.id]));
            setCardDialog(null);
            setTool("select");
          }}
        />
      ) : null}
    </div>
  );
}

function CanvasNodeCard({
  connectSource,
  connectTarget,
  editing,
  index,
  mode,
  node,
  note,
  mediaUrl,
  selected,
  onActivate,
  onChangeText,
  onDoubleClick,
  onPointerDown,
  onResize,
  onStartConnect,
  onStartConnectDrag,
  onStopEditing,
}: {
  connectSource: boolean;
  connectTarget: boolean;
  editing: boolean;
  index: number;
  mode: EditorMode;
  node: CanvasNode;
  note?: Note;
  mediaUrl?: string;
  selected: boolean;
  onActivate?: () => void;
  onChangeText: (value: string) => void;
  onDoubleClick: () => void;
  onPointerDown: (event: ReactPointerEvent) => void;
  onResize: (
    event: ReactPointerEvent,
    direction: CanvasResizeDirection,
  ) => void;
  onStartConnect: (side: CanvasSide) => void;
  onStartConnectDrag: (event: ReactPointerEvent, side: CanvasSide) => void;
  onStopEditing: () => void;
}) {
  const style = canvasNodeStyle(node, index);
  const colorClass = canvasColorClass(node.color);
  if (node.type === "group") {
    return (
      <section
        aria-label={node.label || "Canvas group"}
        className={`canvas-group ${colorClass}${selected ? " is-selected" : ""}${connectSource ? " is-connect-source" : ""}${connectTarget ? " is-connect-target" : ""}`}
        style={style}
        onDoubleClick={(event) => {
          event.preventDefault();
          onDoubleClick();
        }}
        onPointerDown={onPointerDown}
      >
        <strong>{node.label || "Group"}</strong>
        {mode === "edit" ? (
          <ResizeHandles selected={selected} onPointerDown={onResize} />
        ) : null}
      </section>
    );
  }
  return (
    <article
      aria-label={`${node.type} card`}
      className={`canvas-node canvas-node-${node.type} ${colorClass}${selected ? " is-selected" : ""}${connectSource ? " is-connect-source" : ""}${connectTarget ? " is-connect-target" : ""}${onActivate ? " is-actionable" : ""}`}
      style={style}
      tabIndex={onActivate ? 0 : undefined}
      onClick={onActivate}
      onDoubleClick={(event) => {
        event.preventDefault();
        onDoubleClick();
      }}
      onKeyDown={onActivate ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      } : undefined}
      onPointerDown={onPointerDown}
    >
      {node.type === "text" ? (
        editing && mode === "edit" ? (
          <textarea
            autoFocus
            aria-label="Text card Markdown"
            value={node.text}
            onBlur={onStopEditing}
            onChange={(event) => onChangeText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onStopEditing();
              }
            }}
          />
        ) : (
          <div className="canvas-markdown">
            <ReactMarkdown remarkPlugins={markdownPlugins}>{node.text}</ReactMarkdown>
          </div>
        )
      ) : node.type === "file" ? (
        canvasMediaKind(node.file) ? (
          <CanvasMediaCard node={node} previewUrl={mediaUrl} />
        ) : (
          <CanvasFileCard node={node} note={note} />
        )
      ) : (
        <CanvasLinkCard node={node} />
      )}
      {mode === "edit" ? (
        <>
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <button
              className={`canvas-port is-${side}`}
              key={side}
              type="button"
              aria-label={`Connect from ${side}`}
              title="Drag to another card"
              tabIndex={selected ? 0 : -1}
              onClick={(event) => {
                event.stopPropagation();
                if (event.detail === 0) onStartConnect(side);
              }}
              onPointerDown={(event) => onStartConnectDrag(event, side)}
            />
          ))}
          <ResizeHandles selected={selected} onPointerDown={onResize} />
        </>
      ) : null}
    </article>
  );
}

function CanvasLinkCard({
  node,
}: {
  node: Extract<CanvasNode, { type: "link" }>;
}) {
  const desktopServices = useCastlePlatform().desktopServices;
  const previewUrl = normalizeCanvasUrl(node.url);
  const canEmbedPreview =
    desktopServices?.supportsCanvasWebPreviews === true &&
    Boolean(previewUrl);

  return (
    <div className="canvas-link-card">
      <header>
        <Icon icon="globe-network" aria-hidden="true" />
        <span>
          <strong>{urlHost(node.url)}</strong>
          <small>{node.url}</small>
        </span>
      </header>
      {canEmbedPreview ? (
        <CanvasWebPreview host={urlHost(node.url)} url={previewUrl} />
      ) : (
        <p>
          {desktopServices
            ? "Restart Castle to enable this page preview."
            : "Web page"}
        </p>
      )}
    </div>
  );
}

function CanvasWebPreview({ host, url }: { host: string; url: string }) {
  const webviewRef = useRef<WebviewTag | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const handleLoadStart = useCallback(() => setStatus("loading"), []);
  const handleLoadFinish = useCallback(() => setStatus("ready"), []);
  const handleLoadFailure = useCallback((event: DidFailLoadEvent) => {
    if (event.isMainFrame && event.errorCode !== -3) setStatus("error");
  }, []);
  const setWebviewRef = useCallback(
    (element: HTMLWebViewElement | null) => {
      const previous = webviewRef.current;
      if (previous) {
        previous.removeEventListener("did-start-loading", handleLoadStart);
        previous.removeEventListener("did-finish-load", handleLoadFinish);
        previous.removeEventListener("did-fail-load", handleLoadFailure);
      }

      const next = element as unknown as WebviewTag | null;
      webviewRef.current = next;
      if (next) {
        next.addEventListener("did-start-loading", handleLoadStart);
        next.addEventListener("did-finish-load", handleLoadFinish);
        next.addEventListener("did-fail-load", handleLoadFailure);
      }
    },
    [handleLoadFailure, handleLoadFinish, handleLoadStart],
  );

  return (
    <div className={`canvas-web-preview is-${status}`}>
      <webview
        aria-label={`Preview of ${host}`}
        partition="castle-canvas-previews"
        ref={setWebviewRef}
        src={url}
        webpreferences="contextIsolation=yes, nodeIntegration=no, sandbox=yes, webSecurity=yes"
      />
      {status !== "ready" ? (
        <div className="canvas-web-preview-state" aria-live="polite">
          <Icon
            icon={status === "loading" ? "refresh" : "warning-sign"}
            aria-hidden="true"
          />
          <span>
            {status === "loading"
              ? "Loading page preview…"
              : "Preview unavailable. Double-click to open the page."}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function CanvasFileCard({
  node,
  note,
}: {
  node: Extract<CanvasNode, { type: "file" }>;
  note?: Note;
}) {
  const noteContent = useGeneratedResource(
    note?.contentPath ?? null,
    validateNoteContent,
    "Canvas note content",
  );
  const content = noteContent.data?.content;

  return (
    <div className="canvas-file-card">
      <header>
        <Icon icon="document" aria-hidden="true" />
        <span>
          <strong>{note?.title ?? fileDisplayName(node.file)}</strong>
          <small>{node.subpath ? `${node.file}${node.subpath}` : node.file}</small>
        </span>
      </header>
      <div className="canvas-markdown">
        {content ? (
          <ReactMarkdown remarkPlugins={markdownPlugins}>{content}</ReactMarkdown>
        ) : (
          <p>{note?.excerpt || "File from this Obsidian vault."}</p>
        )}
      </div>
    </div>
  );
}

function CanvasMediaCard({
  node,
  previewUrl,
}: {
  node: Extract<CanvasNode, { type: "file" }>;
  previewUrl?: string;
}) {
  const kind = canvasMediaKind(node.file);
  const url = previewUrl || canvasMediaUrl(node.file);
  const name = fileDisplayName(node.file);
  if (kind === "image" && url) {
    return (
      <figure className="canvas-media-card canvas-image-card">
        <img alt={name} draggable={false} src={url} />
        <figcaption>
          <Icon icon="media" aria-hidden="true" />
          <span>{name}</span>
        </figcaption>
      </figure>
    );
  }
  return (
    <div className="canvas-media-card canvas-pdf-card">
      <Icon icon="document" size={26} aria-hidden="true" />
      <strong>{name}</strong>
      <span>PDF document</span>
      <small>Double-click to open</small>
    </div>
  );
}

function CanvasEdges({
  canvas,
  connectionDraft,
  selectedEdgeId,
  onEditLabel,
  onSelect,
}: {
  canvas: JsonCanvas;
  connectionDraft: ConnectionDraft | null;
  selectedEdgeId: string;
  onEditLabel: (edgeId: string) => void;
  onSelect: (edgeId: string) => void;
}) {
  const nodes = new Map(canvas.nodes.map((node) => [node.id, node]));
  const draftSource = connectionDraft
    ? nodes.get(connectionDraft.fromNodeId)
    : undefined;
  return (
    <svg className="canvas-edges" viewBox="-10000 -10000 20000 20000" aria-hidden="true">
      <defs>
        <marker
          id="canvas-arrow-preview"
          markerHeight="8"
          markerWidth="8"
          orient="auto-start-reverse"
          refX="7"
          refY="4"
          viewBox="0 0 8 8"
        >
          <path className="canvas-edge-preview-marker" d="M0 0 L8 4 L0 8 Z" />
        </marker>
        {canvas.edges.map((edge, index) => (
          <marker
            id={`canvas-arrow-${index}`}
            key={edge.id}
            markerHeight="8"
            markerWidth="8"
            orient="auto-start-reverse"
            refX="7"
            refY="4"
            viewBox="0 0 8 8"
          >
            <path
              d="M0 0 L8 4 L0 8 Z"
              className={`canvas-edge-color-${canvasColorClassName(edge.color)}`}
              style={canvasEdgeColorStyle(edge.color, "fill")}
            />
          </marker>
        ))}
      </defs>
      {canvas.edges.map((edge, index) => {
        const fromNode = nodes.get(edge.fromNode);
        const toNode = nodes.get(edge.toNode);
        if (!fromNode || !toNode) return null;
        const [inferredFrom, inferredTo] = inferSides(fromNode, toNode);
        const from = connectionPoint(fromNode, edge.fromSide ?? inferredFrom);
        const to = connectionPoint(toNode, edge.toSide ?? inferredTo);
        const path = edgePath(from, to, edge.fromSide ?? inferredFrom, edge.toSide ?? inferredTo);
        const color = canvasColorClassName(edge.color);
        const selected = edge.id === selectedEdgeId;
        return (
          <g className={`canvas-edge canvas-edge-${color}${selected ? " is-selected" : ""}`} key={edge.id}>
            <path
              className="canvas-edge-visible"
              d={path}
              markerStart={edge.fromEnd === "arrow" ? `url(#canvas-arrow-${index})` : undefined}
              markerEnd={edge.toEnd === "none" ? undefined : `url(#canvas-arrow-${index})`}
              style={selected ? undefined : canvasEdgeColorStyle(edge.color, "stroke")}
            />
            <path
              className="canvas-edge-hit"
              d={path}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(edge.id);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onSelect(edge.id);
                onEditLabel(edge.id);
              }}
            />
            {edge.label ? (
              <g transform={`translate(${(from.x + to.x) / 2} ${(from.y + to.y) / 2})`}>
                <rect className="canvas-edge-label-bg" x={-Math.max(28, edge.label.length * 3.7)} y="-11" width={Math.max(56, edge.label.length * 7.4)} height="22" rx="1" />
                <text className="canvas-edge-label" textAnchor="middle" dominantBaseline="middle">{edge.label}</text>
              </g>
            ) : null}
          </g>
        );
      })}
      {connectionDraft && draftSource ? (
        <path
          className="canvas-edge-preview"
          d={edgePath(
            connectionPoint(draftSource, connectionDraft.fromSide),
            connectionDraft.to,
            connectionDraft.fromSide,
            connectionDraft.toSide ?? oppositeSide(connectionDraft.fromSide),
          )}
          markerEnd="url(#canvas-arrow-preview)"
        />
      ) : null}
    </svg>
  );
}

function SelectionToolbar({
  edge,
  nodes,
  onColor,
  onDelete,
  onDuplicate,
  onEditLabel,
  onGroup,
}: {
  edge?: CanvasEdge;
  nodes: readonly CanvasNode[];
  onColor: (color: CanvasColor | undefined) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onEditLabel: () => void;
  onGroup: () => void;
}) {
  const bounds = nodeBounds(nodes);
  const style = {
    left: bounds.x + bounds.width / 2,
    top: bounds.y - 52,
  } as CSSProperties;
  return (
    <div className={`canvas-selection-toolbar${edge ? " is-edge" : ""}`} style={style}>
      <div className="canvas-color-picker" aria-label="Selection color">
        {canvasColors.map((color) => (
          <button
            className={`canvas-color-${color ?? "default"}`}
            key={color ?? "default"}
            type="button"
            aria-label={color ? `Set color ${color}` : "Remove color"}
            onClick={() => onColor(color)}
          />
        ))}
      </div>
      {edge ? (
        <ToolbarButton icon="label" label="Edit connection label" onClick={onEditLabel} />
      ) : (
        <>
          <ToolbarButton icon="duplicate" label="Duplicate selection" onClick={onDuplicate} />
          {nodes.length > 1 ? <ToolbarButton icon="square" label="Group selection" onClick={onGroup} /> : null}
        </>
      )}
      <ToolbarButton icon="trash" label="Delete selection" onClick={onDelete} />
    </div>
  );
}

function ConnectionDropMenu({
  state,
  onAddLibraryCard,
  onAddTextCard,
  onCancel,
}: {
  state: ConnectionDropMenuState;
  onAddLibraryCard: () => void;
  onAddTextCard: () => void;
  onCancel: () => void;
}) {
  useDialogEscape(onCancel);
  return (
    <div
      className="canvas-connection-menu"
      role="menu"
      aria-label="Create a connected card"
      style={{ left: state.clientX, top: state.clientY }}
    >
      <span>Connect to</span>
      <button type="button" role="menuitem" onClick={onAddTextCard}>
        <Icon icon="new-object" aria-hidden="true" />
        New card
      </button>
      <button type="button" role="menuitem" onClick={onAddLibraryCard}>
        <Icon icon="document" aria-hidden="true" />
        From library
      </button>
    </div>
  );
}

function CardDialog({
  notes,
  state,
  onCancel,
  onCreate,
}: {
  notes: readonly Note[];
  state: CardDialogState;
  onCancel: () => void;
  onCreate: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState("");
  const isFile = state.type === "file";
  useDialogEscape(onCancel);
  return (
    <div className="canvas-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form
        className="canvas-dialog canvas-card-dialog"
        aria-label={isFile ? "Add note or file" : "Add web page"}
        aria-modal="true"
        role="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedValue = value.trim();
          if (!trimmedValue) return;
          if (isFile) {
            onCreate(trimmedValue);
            return;
          }
          const url = normalizeCanvasUrl(trimmedValue);
          if (!url) {
            setFieldError("Enter a valid http or https address.");
            return;
          }
          onCreate(url);
        }}
      >
        <header>
          <Icon icon={isFile ? "document" : "link"} aria-hidden="true" />
          <div>
            <h2>{isFile ? "Add note or file" : "Add web page"}</h2>
            <p>{isFile ? `Search all ${notes.length} notes by title or library path.` : "Paste the page URL."}</p>
          </div>
        </header>
        <label>
          {isFile ? "File" : "URL"}
          <input
            autoFocus
            aria-describedby={fieldError ? "canvas-card-field-error" : undefined}
            aria-invalid={fieldError ? "true" : undefined}
            inputMode={isFile ? undefined : "url"}
            list={isFile ? "canvas-note-paths" : undefined}
            placeholder={isFile ? "wiki/topic.md" : "https://example.com"}
            type="text"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setFieldError("");
            }}
          />
          {fieldError ? (
            <small className="canvas-dialog-field-error" id="canvas-card-field-error" role="alert">
              {fieldError}
            </small>
          ) : null}
          {isFile ? (
            <datalist id="canvas-note-paths">
              {notes.map((note) => <option key={note.id} value={note.sourceFile}>{note.title}</option>)}
            </datalist>
          ) : null}
        </label>
        <footer>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="is-primary" type="submit" disabled={!value.trim()}>Add card</button>
        </footer>
      </form>
    </div>
  );
}

function ToolbarButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" disabled={disabled} aria-label={label} title={label} onClick={onClick}>
      <Icon icon={icon} aria-hidden="true" />
    </button>
  );
}

const resizeDirections: readonly CanvasResizeDirection[] = [
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
  "top-left",
];

function ResizeHandles({
  selected,
  onPointerDown,
}: {
  selected: boolean;
  onPointerDown: (
    event: ReactPointerEvent,
    direction: CanvasResizeDirection,
  ) => void;
}) {
  return resizeDirections.map((direction) => (
    <button
      className={`canvas-resize-handle is-${direction}`}
      key={direction}
      type="button"
      aria-label={`Resize card from ${direction.replace("-", " ")}`}
      tabIndex={selected ? 0 : -1}
      onPointerDown={(event) => onPointerDown(event, direction)}
    />
  ));
}

function cardPlacementBounds(
  start: { x: number; y: number },
  end: { x: number; y: number },
  defaultHeight: number,
  defaultWidth = defaultNodeWidth,
): SelectionRect {
  const drawn = rectFromPoints(start, end);
  if (drawn.width < 4 && drawn.height < 4) {
    return {
      x: snapCanvasValue(start.x - defaultWidth / 2),
      y: snapCanvasValue(start.y - defaultHeight / 2),
      width: defaultWidth,
      height: defaultHeight,
    };
  }
  return {
    x: snapCanvasValue(drawn.x),
    y: snapCanvasValue(drawn.y),
    width: Math.max(140, snapCanvasValue(drawn.width)),
    height: Math.max(80, snapCanvasValue(drawn.height)),
  };
}

function isFileDrag(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes("Files");
}

function useDialogEscape(onCancel: () => void) {
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

function nodeRectStyle(rect: { x: number; y: number; width: number; height: number }): CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}

function canvasNodeStyle(node: CanvasNode, index: number): CSSProperties {
  const style = {
    ...nodeRectStyle(node),
    zIndex: node.type === "group" ? 0 : index + 2,
  } as CSSProperties & Record<string, string | number>;
  if (node.color?.startsWith("#")) {
    style["--canvas-node-accent"] = node.color;
    style["--canvas-node-tint"] = hexToRgba(node.color, 0.12);
  }
  return style;
}

function canvasColorClass(color: CanvasColor | undefined) {
  return `canvas-color-${canvasColorClassName(color)}`;
}

function canvasColorClassName(color: CanvasColor | undefined) {
  if (!color) return "default";
  return color.startsWith("#") ? "custom" : color;
}

function canvasEdgeColorStyle(
  color: CanvasColor | undefined,
  property: "fill" | "stroke",
): CSSProperties | undefined {
  if (!color) return undefined;
  return { [property]: canvasColorValues[color] ?? color };
}

function hexToRgba(color: string, alpha: number) {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgb(${red} ${green} ${blue} / ${alpha})`;
}

function nodeBounds(nodes: readonly CanvasNode[]) {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function viewportWorldCenter(viewport: HTMLElement | null, transform: CanvasViewTransform) {
  return {
    x: ((viewport?.clientWidth ?? 1000) / 2 - transform.x) / transform.zoom,
    y: ((viewport?.clientHeight ?? 700) / 2 - transform.y) / transform.zoom,
  };
}

function viewportCenterBounds(
  viewport: HTMLElement | null,
  transform: CanvasViewTransform,
  width: number,
  height: number,
) {
  const center = viewportWorldCenter(viewport, transform);
  return { x: center.x - width / 2, y: center.y - height / 2, width, height };
}

function screenToWorld(clientX: number, clientY: number, viewport: HTMLElement, transform: CanvasViewTransform) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: (clientX - rect.left - transform.x) / transform.zoom,
    y: (clientY - rect.top - transform.y) / transform.zoom,
  };
}

function pointerToViewportPoint(
  clientX: number,
  clientY: number,
  viewport: HTMLElement,
): CanvasViewportPoint {
  const rect = viewport.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function rectFromPoints(first: { x: number; y: number }, second: { x: number; y: number }) {
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  };
}

function rectanglesIntersect(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return !(
    left.x + left.width < right.x ||
    left.x > right.x + right.width ||
    left.y + left.height < right.y ||
    left.y > right.y + right.height
  );
}

function inferSides(fromNode: CanvasNode, toNode: CanvasNode): [CanvasSide, CanvasSide] {
  const dx = toNode.x + toNode.width / 2 - (fromNode.x + fromNode.width / 2);
  const dy = toNode.y + toNode.height / 2 - (fromNode.y + fromNode.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function connectionEdge(
  nodes: readonly CanvasNode[],
  connectFrom: ConnectionSource,
  toNode: CanvasNode,
): CanvasEdge {
  const fromNode = nodes.find((node) => node.id === connectFrom.nodeId);
  if (!fromNode) throw new Error("Canvas connection source is unavailable.");
  const [fromSide, toSide] = inferSides(fromNode, toNode);
  return {
    id: createCanvasId("edge"),
    fromNode: fromNode.id,
    fromSide: connectFrom.side ?? fromSide,
    fromEnd: "none",
    toNode: toNode.id,
    toSide,
    toEnd: "arrow",
  };
}

function connectionPoint(node: CanvasNode, side: CanvasSide) {
  if (side === "top") return { x: node.x + node.width / 2, y: node.y };
  if (side === "right") return { x: node.x + node.width, y: node.y + node.height / 2 };
  if (side === "bottom") return { x: node.x + node.width / 2, y: node.y + node.height };
  return { x: node.x, y: node.y + node.height / 2 };
}

function oppositeSide(side: CanvasSide): CanvasSide {
  if (side === "top") return "bottom";
  if (side === "right") return "left";
  if (side === "bottom") return "top";
  return "right";
}

function edgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fromSide: CanvasSide,
  toSide: CanvasSide,
) {
  const distance = Math.max(48, Math.min(180, Math.hypot(to.x - from.x, to.y - from.y) * 0.42));
  const fromControl = sideOffset(from, fromSide, distance);
  const toControl = sideOffset(to, toSide, distance);
  return `M ${from.x} ${from.y} C ${fromControl.x} ${fromControl.y}, ${toControl.x} ${toControl.y}, ${to.x} ${to.y}`;
}

function sideOffset(point: { x: number; y: number }, side: CanvasSide, distance: number) {
  if (side === "top") return { x: point.x, y: point.y - distance };
  if (side === "right") return { x: point.x + distance, y: point.y };
  if (side === "bottom") return { x: point.x, y: point.y + distance };
  return { x: point.x - distance, y: point.y };
}

function dominant(x: number, y: number) {
  return Math.abs(x) >= Math.abs(y) ? { x, y: 0 } : { x: 0, y };
}

function withColor<T extends CanvasNode | CanvasEdge>(value: T, color: CanvasColor | undefined): T {
  if (color) return { ...value, color };
  const withoutColor = { ...value };
  delete withoutColor.color;
  return withoutColor;
}

function openCanvasUrl(value: string) {
  const url = normalizeCanvasUrl(value);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

function urlHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function fileDisplayName(value: string) {
  return value.split("/").at(-1)?.replace(/\.[^.]+$/, "").replaceAll("_", " ") || value;
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function isCanvasTextEditingTarget(target: EventTarget | null) {
  if (isTypingTarget(target)) return true;
  return target instanceof Element && Boolean(target.closest('[contenteditable="true"]'));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
