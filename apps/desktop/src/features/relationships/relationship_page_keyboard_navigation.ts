import { useCallback, type RefObject } from "react";
import { useKeyboardShortcut } from "../../keyboard/use_keyboard_shortcut";

interface RelationshipGraphKeyboardHandle {
  fit: () => void;
  zoomBy: (multiplier: number) => void;
}

export function useRelationshipPageKeyboardNavigation({
  graphCanvasRef,
  graphVisible,
  onEscape,
  onToggleSimulation,
  searchInputRef,
}: {
  graphCanvasRef: RefObject<RelationshipGraphKeyboardHandle | null>;
  graphVisible: boolean;
  onEscape: () => void;
  onToggleSimulation: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
}) {
  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, [searchInputRef]);
  const fitGraph = useCallback(() => {
    graphCanvasRef.current?.fit();
  }, [graphCanvasRef]);
  const zoomIn = useCallback(() => {
    graphCanvasRef.current?.zoomBy(1.2);
  }, [graphCanvasRef]);
  const zoomOut = useCallback(() => {
    graphCanvasRef.current?.zoomBy(0.84);
  }, [graphCanvasRef]);

  useKeyboardShortcut("relationshipSearch", focusSearch);
  useKeyboardShortcut("relationshipToggleSimulation", onToggleSimulation, {
    enabled: graphVisible,
  });
  useKeyboardShortcut("relationshipFitGraph", fitGraph, {
    enabled: graphVisible,
  });
  useKeyboardShortcut("relationshipZoomIn", zoomIn, {
    enabled: graphVisible,
  });
  useKeyboardShortcut("relationshipZoomOut", zoomOut, {
    enabled: graphVisible,
  });
  useKeyboardShortcut("relationshipEscape", onEscape);
}
