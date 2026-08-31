import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, type BlockerFunction } from "react-router-dom";
import type { Note } from "../../types";
import { useCastlePlatform } from "../../platform/castle_platform_provider";
import type {
  CastleContentMutations,
  CastleSourceDocument,
} from "../../platform/castle_platform";
import type { BuiltInMarkdownDocument } from "../../lib/builtInDocuments";

export type NoteEditorStatus = "idle" | "loading" | "ready" | "saving";
const autoSaveDelay = 450;

export function useNoteEditorSession(
  note: Note | undefined,
  route: string,
  builtInDocument?: BuiltInMarkdownDocument,
  onSaved?: (markdown: string) => void,
) {
  const platform = useCastlePlatform();
  const mutations = platform.contentMutations;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<NoteEditorStatus>("idle");
  const [document, setDocument] = useState<CastleSourceDocument | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const requestGeneration = useRef(0);
  const latestDraft = useRef("");
  const finishRequested = useRef(false);
  const dirty = Boolean(document && draft !== document.markdown);
  const canEdit = Boolean(
    note &&
      mutations &&
      (builtInDocument
        ? platform.capabilities.createContent
        : platform.capabilities.editContent),
  );
  const navigationBlocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) =>
        dirty &&
        `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}` !==
          `${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}`,
      [dirty],
    ),
  );

  const reset = useCallback(() => {
    requestGeneration.current += 1;
    setOpen(false);
    setStatus("idle");
    setDocument(null);
    setDraft("");
    setError("");
    latestDraft.current = "";
    finishRequested.current = false;
  }, []);

  const load = useCallback(async () => {
    if (!note || !mutations) return;
    const request = ++requestGeneration.current;
    setOpen(true);
    setStatus("loading");
    setError("");
    try {
      const source = builtInDocument
        ? await createBuiltInOverride(note, builtInDocument, mutations)
        : await mutations.readSource(note.id);
      if (request !== requestGeneration.current) return;
      setDocument(source);
      setDraft(source.markdown);
      latestDraft.current = source.markdown;
      setStatus("ready");
    } catch (reason) {
      if (request !== requestGeneration.current) return;
      setDocument(null);
      setStatus("ready");
      setError(editorErrorMessage(reason));
    }
  }, [builtInDocument, mutations, note]);

  const close = useCallback(() => {
    if (dirty && !window.confirm("Discard the unsaved changes to this note?")) {
      return;
    }
    reset();
  }, [dirty, reset]);

  const reload = useCallback(() => {
    if (
      dirty &&
      !window.confirm("Reload the file and discard your unsaved changes?")
    ) {
      return;
    }
    void load();
  }, [dirty, load]);

  const save = useCallback(async () => {
    if (!mutations || !document || !dirty || status === "saving") return;
    const request = requestGeneration.current;
    const markdown = draft;
    setStatus("saving");
    setError("");
    try {
      const result = await mutations.saveSource({
        noteId: document.noteId,
        sourceFile: document.sourceFile,
        markdown,
        expectedRevision: document.revision,
      });
      if (request !== requestGeneration.current) return;
      setDocument({ ...document, markdown, revision: result.revision });
      setStatus("ready");
      onSaved?.(markdown);
      if (finishRequested.current && latestDraft.current === markdown) reset();
    } catch (reason) {
      if (request !== requestGeneration.current) return;
      finishRequested.current = false;
      setStatus("ready");
      setError(editorErrorMessage(reason));
    }
  }, [document, draft, dirty, mutations, onSaved, reset, status]);

  const finish = useCallback(() => {
    finishRequested.current = true;
    if (status === "saving") return;
    if (dirty) void save();
    else reset();
  }, [dirty, reset, save, status]);

  const updateDraft = useCallback((markdown: string) => {
    latestDraft.current = markdown;
    setError("");
    setDraft(markdown);
  }, []);

  useEffect(() => {
    if (navigationBlocker.state !== "blocked") return;
    if (window.confirm("Discard the unsaved changes to this note?")) {
      navigationBlocker.proceed();
    } else {
      navigationBlocker.reset();
    }
  }, [navigationBlocker]);

  useEffect(() => reset(), [reset, route]);

  useEffect(() => {
    if (!open || !dirty || status !== "ready" || error) return;
    const timeout = window.setTimeout(
      () => void save(),
      finishRequested.current ? 0 : autoSaveDelay,
    );
    return () => window.clearTimeout(timeout);
  }, [dirty, error, open, save, status]);

  useEffect(() => {
    if (!dirty) return;
    const preventAccidentalClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalClose);
    return () => window.removeEventListener("beforeunload", preventAccidentalClose);
  }, [dirty]);

  useEffect(() => {
    if (!open) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [finish, open, save, status]);

  return {
    canEdit,
    close,
    dirty,
    document,
    draft,
    error,
    finish,
    load,
    open,
    reload,
    save,
    setDraft: updateDraft,
    status,
  };
}

async function createBuiltInOverride(
  note: Note,
  builtInDocument: BuiltInMarkdownDocument,
  mutations: CastleContentMutations,
) {
  const result = await mutations.createSource({
    markdown: builtInDocument.markdown,
    noteId: note.id,
    sourceFile: builtInDocument.overrideSourceFile,
  });
  return {
    markdown: builtInDocument.markdown,
    noteId: result.noteId,
    revision: result.revision,
    sourceFile: result.sourceFile,
  };
}

function editorErrorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message
    .replace(/^Error invoking remote method '[^']+': Error: /, "")
    .replace(/^Error: /, "");
}
