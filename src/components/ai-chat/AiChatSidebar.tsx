import { WorkspacePortal } from "@patkepa/kantzen-ui/app-shell";
import { Button, Icon } from "@patkepa/kantzen-ui/primitives";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Note } from "../../types";
import type {
  CastleChatCitation,
  CastleChatEvent,
} from "../../platform/ai_chat";
import { useCastlePlatform } from "../../platform/castle_platform_provider";
import {
  shortcutCatalog,
  shortcutDisplayText,
} from "../../keyboard/shortcut_catalog";
import {
  findMatchingCommands,
  findMatchingNotes,
  formatNoteLocation,
  getCommandQuery,
  getMentionQuery,
  localCommands,
  type LocalCommandId,
} from "./aiChatMatching";

interface AiChatSidebarProps {
  currentNote?: Note;
  notes: readonly Note[];
  open: boolean;
  onOpenNote: (note: Note) => void;
  onOpenChange: (open: boolean) => void;
}

interface ChatMessage {
  id: string;
  requestId: string;
  role: "user" | "assistant";
  text: string;
  context: Note[];
  status?: string;
  pending?: boolean;
  error?: boolean;
  citations: CastleChatCitation[];
  unsupportedCitationHandles: string[];
  provider?: {
    kind: "local" | "external";
    name: string;
    model: string;
  };
  externalTransmission?: boolean;
  searchLibrary?: boolean;
}

export function AiChatSidebar({
  currentNote,
  notes,
  open,
  onOpenNote,
  onOpenChange,
}: AiChatSidebarProps) {
  const platform = useCastlePlatform();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const [draft, setDraft] = useState("");
  const [attachedNotes, setAttachedNotes] = useState<Note[]>([]);
  const [searchLibrary, setSearchLibrary] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activePickerIndex, setActivePickerIndex] = useState(0);
  const mentionQuery = getMentionQuery(draft);
  const commandQuery = getCommandQuery(draft);
  const matchingNotes = useMemo(
    () => findMatchingNotes(notes, mentionQuery, attachedNotes),
    [attachedNotes, mentionQuery, notes],
  );
  const matchingCommands = useMemo(
    () => findMatchingCommands(commandQuery),
    [commandQuery],
  );
  const notesById = useMemo(
    () => new Map(notes.map((note) => [note.id, note])),
    [notes],
  );
  const notesByRoute = useMemo(
    () => new Map(notes.map((note) => [note.route, note])),
    [notes],
  );
  const isPickerOpen = mentionQuery !== null;
  const isCommandPickerOpen = commandQuery !== null;
  const activeRequests = messages.filter(
    (message) => message.role === "assistant" && message.pending,
  );

  useEffect(() => {
    const chat = platform.aiChat;
    if (!chat) return;
    return chat.onEvent(handleChatEvent);
  }, [platform.aiChat]);

  useEffect(() => {
    const toggleSidebar = () => onOpenChange(!open);
    window.addEventListener("toggle-right-sidebar", toggleSidebar);
    return () => window.removeEventListener("toggle-right-sidebar", toggleSidebar);
  }, [onOpenChange, open]);

  useEffect(() => {
    setActivePickerIndex(0);
  }, [commandQuery, mentionQuery]);

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) triggerRef.current?.focus();
      wasOpenRef.current = false;
      return;
    }

    wasOpenRef.current = true;
    inputRef.current?.focus();

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onOpenChange(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages]);

  const trigger = (
    <WorkspacePortal slot="navbar-end">
        <Button
          active={open}
          aria-controls="castle-ai-chat"
          aria-expanded={open}
          aria-keyshortcuts={shortcutCatalog.castleAi.ariaKeyShortcuts}
          aria-label={`${open ? "Close" : "Open"} Castle chat`}
          className="ai-chat-trigger"
          icon="chat"
          minimal
          ref={triggerRef}
          title={`Castle chat (${shortcutDisplayText("castleAi")})`}
          onClick={() => onOpenChange(!open)}
        />
    </WorkspacePortal>
  );

  const sidebar = open ? (
    <WorkspacePortal slot="main-overlay">
        <>
          <button
            aria-label="Close Castle chat"
            className="ai-chat-backdrop"
            tabIndex={-1}
            type="button"
            onClick={() => onOpenChange(false)}
          />
          <aside
            aria-labelledby="castle-ai-title"
            className="ai-chat-sidebar"
            id="castle-ai-chat"
          >
            <header className="ai-chat-header">
              <div>
                <h2 id="castle-ai-title">Castle chat</h2>
                <span>{platform.aiChat ? "Confirm before sending" : "Unavailable"}</span>
              </div>
              <Button
                aria-label="Close Castle chat"
                className="ai-chat-close"
                icon="cross"
                minimal
                onClick={() => onOpenChange(false)}
              />
            </header>

            <div className="ai-chat-body" aria-live="polite" ref={bodyRef}>
              {messages.length === 0 ? (
                <section className="ai-chat-welcome">
                  <Icon icon="chat" size={20} aria-hidden="true" />
                  <h3>Ask your Castle</h3>
                  <p>
                    Attach only the notes you want to use, or turn on library
                    search when you need it. Every OpenAI request is confirmed
                    in a system dialog before anything leaves this device.
                  </p>
                </section>
              ) : (
                <ol className="ai-chat-messages" aria-label="Castle chat messages">
                  {messages.map((message) => (
                    <li
                      key={message.id}
                      className={`ai-chat-message is-${message.role}${
                        message.error ? " is-error" : ""
                      }`}
                    >
                      <span className="ai-chat-message-role">
                        {message.role === "user" ? "You" : "Castle"}
                      </span>
                      {message.text ? <p>{message.text}</p> : null}
                      {message.context.length > 0 || message.searchLibrary ? (
                        <ul className="ai-chat-message-context" aria-label="Message context">
                          {message.context.map((note) => (
                            <li key={note.id}>
                              <Icon icon="document" size={11} aria-hidden="true" />
                              {note.title}
                            </li>
                          ))}
                          {message.searchLibrary ? (
                            <li>
                              <Icon icon="search" size={11} aria-hidden="true" />
                              Library search
                            </li>
                          ) : null}
                        </ul>
                      ) : null}
                      {message.citations.length > 0 ? (
                        <ul className="ai-chat-citations" aria-label="Answer citations">
                          {message.citations.map((citation) => {
                            const note =
                              notesById.get(citation.noteId) ??
                              notesByRoute.get(citation.route);
                            return (
                              <li key={citation.handle}>
                                <button
                                  disabled={!note}
                                  type="button"
                                  onClick={() => note && onOpenNote(note)}
                                >
                                  [{citation.handle}] {citation.title}, lines{" "}
                                  {citation.startLine}–{citation.endLine}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                      {message.unsupportedCitationHandles.length > 0 ? (
                        <small className="ai-chat-citation-warning">
                          Unsupported citation handles removed: {message.unsupportedCitationHandles.join(", ")}
                        </small>
                      ) : null}
                      {message.status ? <small>{message.status}</small> : null}
                      {message.pending ? (
                        <button
                          className="ai-chat-cancel"
                          type="button"
                          onClick={() => void cancelRequest(message.requestId)}
                        >
                          Cancel
                        </button>
                      ) : message.error ? (
                        <button
                          className="ai-chat-cancel"
                          type="button"
                          onClick={() => retryRequest(message.requestId)}
                        >
                          Retry
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <form className="ai-chat-composer" onSubmit={submitMessage}>
              <label className="sr-only" htmlFor="castle-ai-input">
                Ask Castle
              </label>
              {attachedNotes.length > 0 ? (
                <ul className="ai-chat-context" aria-label="Selected note context">
                  {attachedNotes.map((note) => (
                    <li key={note.id}>
                      <Icon icon="document" size={11} aria-hidden="true" />
                      <button
                        className="ai-chat-context-open"
                        title={`Open ${note.relativePath}`}
                        type="button"
                        onClick={() => onOpenNote(note)}
                      >
                        {note.title}
                      </button>
                      <button
                        className="ai-chat-context-remove"
                        aria-label={`Remove ${note.title} from context`}
                        type="button"
                        onClick={() => removeAttachedNote(note.id)}
                      >
                        <Icon icon="cross" size={10} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="ai-chat-scope-row">
                <button
                  aria-pressed={searchLibrary}
                  className={`ai-chat-library-scope${searchLibrary ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setSearchLibrary((current) => !current)}
                >
                  <Icon
                    icon={searchLibrary ? "tick-circle" : "search"}
                    size={12}
                    aria-hidden="true"
                  />
                  <span>Search library</span>
                  <small>{searchLibrary ? "On" : "Off"}</small>
                </button>
                <span>
                  {searchLibrary
                    ? "May add up to 8 relevant excerpts"
                    : attachedNotes.length > 0
                      ? `${attachedNotes.length} selected note${attachedNotes.length === 1 ? "" : "s"} only`
                      : "No files selected"}
                </span>
              </div>
              <div className={`ai-chat-input-row${currentNote ? " has-current-note" : ""}`}>
                <textarea
                  aria-activedescendant={
                    isPickerOpen && matchingNotes[activePickerIndex]
                      ? `castle-ai-mention-${matchingNotes[activePickerIndex].id}`
                      : undefined
                  }
                  aria-controls={isPickerOpen ? "castle-ai-mention-picker" : undefined}
                  aria-describedby="castle-ai-local-note"
                  autoComplete="off"
                  id="castle-ai-input"
                  maxLength={8_000}
                  placeholder="Message Castle…"
                  ref={inputRef}
                  rows={2}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                />
                {currentNote ? (
                  <button
                    aria-label={`Add current note: ${currentNote.title}`}
                    className="ai-chat-attach-current"
                    title="Add current note to context (⌘↵)"
                    type="button"
                    onClick={attachCurrentNote}
                  >
                    <Icon icon="pin" size={13} aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  aria-label="Review and send message"
                  disabled={!draft.trim() && attachedNotes.length === 0}
                  title="Review in a system dialog before sending"
                  type="submit"
                >
                  <Icon icon="arrow-right" aria-hidden="true" />
                </button>
              </div>
              {isPickerOpen ? (
                <div
                  className="ai-chat-mention-picker"
                  id="castle-ai-mention-picker"
                  role="listbox"
                  aria-label="Add note context"
                >
                  {matchingNotes.length > 0 ? (
                    matchingNotes.map((note, index) => (
                      <button
                        key={note.id}
                        aria-selected={activePickerIndex === index}
                        className={activePickerIndex === index ? "is-active" : undefined}
                        id={`castle-ai-mention-${note.id}`}
                        role="option"
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActivePickerIndex(index)}
                        onClick={() => attachNote(note)}
                      >
                        <Icon icon="document" size={13} aria-hidden="true" />
                        <span>
                          <strong>{note.title}</strong>
                          <small>{formatNoteLocation(note)}</small>
                        </span>
                      </button>
                    ))
                  ) : (
                    <p>No unselected notes match “{mentionQuery}”.</p>
                  )}
                </div>
              ) : null}
              {isCommandPickerOpen ? (
                <div
                  className="ai-chat-mention-picker ai-chat-command-picker"
                  role="listbox"
                  aria-label="Local chat commands"
                >
                  {matchingCommands.map((command, index) => (
                    <button
                      key={command.id}
                      aria-selected={activePickerIndex === index}
                      className={activePickerIndex === index ? "is-active" : undefined}
                      role="option"
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActivePickerIndex(index)}
                      onClick={() => runLocalCommand(command.id)}
                    >
                      <Icon icon="console" size={13} aria-hidden="true" />
                      <span>
                        <strong>{command.label}</strong>
                        <small>{command.description}</small>
                      </span>
                    </button>
                  ))}
                  {matchingCommands.length === 0 ? (
                    <p>No local command matches “{commandQuery}”.</p>
                  ) : null}
                </div>
              ) : null}
              <p className="ai-chat-privacy-note" id="castle-ai-local-note">
                <Icon icon="shield" size={10} aria-hidden="true" />
                {platform.aiChat
                  ? "OpenAI requests always require system confirmation."
                  : "Local chat requires the Castle desktop app."}
              </p>
            </form>
          </aside>
        </>
    </WorkspacePortal>
  ) : null;

  return (
    <>
      {trigger}
      {sidebar}
    </>
  );

  function handleChatEvent(event: CastleChatEvent) {
    setMessages((current) =>
      current.map((message) => {
        if (message.requestId !== event.requestId || message.role !== "assistant") {
          return message;
        }
        if (event.type === "delta") {
          return { ...message, text: message.text + event.text };
        }
        if (event.type === "context") {
          return {
            ...message,
            citations: event.citations,
            provider: event.provider,
            externalTransmission: event.externalTransmission,
          };
        }
        if (event.type === "complete") {
          return {
            ...message,
            pending: false,
            status: providerStatus(message.provider, message.externalTransmission),
            citations: event.citations,
            unsupportedCitationHandles: event.unsupportedCitationHandles,
          };
        }
        if (event.type === "error") {
          return {
            ...message,
            error: true,
            pending: false,
            status: event.recoverable ? "You can retry this request." : undefined,
            text: event.message,
          };
        }
        return {
          ...message,
          pending: event.status !== "cancelled",
          status: event.message,
        };
      }),
    );
  }

  function attachNote(note: Note) {
    setAttachedNotes((current) =>
      current.length >= 10 || current.some((item) => item.id === note.id)
        ? current
        : [...current, note],
    );
    setDraft((current) => current.replace(/@[^\s@]*$/u, `@${note.title} `));
    inputRef.current?.focus();
  }

  function attachCurrentNote() {
    if (!currentNote) return;
    attachNote(currentNote);
  }

  function removeAttachedNote(noteId: string) {
    setAttachedNotes((current) => current.filter((note) => note.id !== noteId));
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && currentNote) {
      event.preventDefault();
      attachCurrentNote();
      return;
    }

    if (event.key === "Escape" && isPickerOpen) {
      event.preventDefault();
      setDraft((current) => current.replace(/@[^\s@]*$/u, ""));
      return;
    }

    if (event.key === "Escape" && isCommandPickerOpen) {
      event.preventDefault();
      setDraft("");
      return;
    }

    const options = isPickerOpen ? matchingNotes : matchingCommands;
    if ((isPickerOpen || isCommandPickerOpen) && options.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActivePickerIndex((current) =>
          (current + direction + options.length) % options.length,
        );
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (isPickerOpen) attachNote(matchingNotes[activePickerIndex]);
        else runLocalCommand(matchingCommands[activePickerIndex].id);
        return;
      }
    }

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (runTypedCommand(text)) return;
    if (!text && attachedNotes.length === 0) return;

    const requestId = crypto.randomUUID();
    const question = text || "Summarize the attached notes.";
    const context = [...attachedNotes];
    setMessages((current) => [
      ...current,
      createUserMessage(requestId, question, context, searchLibrary),
      createAssistantMessage(requestId),
    ]);
    setDraft("");
    setAttachedNotes([]);
    setSearchLibrary(false);
    inputRef.current?.focus();

    if (!platform.aiChat) {
      setMessages((current) =>
        current.map((message) =>
          message.id === `assistant-${requestId}`
            ? {
                ...message,
                error: true,
                pending: false,
                text: "Local Castle chat is available in the desktop app.",
              }
            : message,
        ),
      );
      return;
    }
    void platform.aiChat
      .start({
        requestId,
        question,
        currentNoteId: searchLibrary ? currentNote?.id : undefined,
        attachedNoteIds: context.map((note) => note.id),
        searchLibrary,
      })
      .catch((reason: unknown) => {
        handleChatEvent({
          type: "error",
          requestId,
          message: reason instanceof Error ? reason.message : String(reason),
          recoverable: true,
        });
      });
  }

  function runTypedCommand(value: string) {
    const [command, ...arguments_] = value.split(/\s+/u);
    if (!command.startsWith("/")) return false;
    const commandId = command.slice(1) as LocalCommandId;
    if (!localCommands.some((item) => item.id === commandId)) return false;
    runLocalCommand(commandId, arguments_.join(" "));
    return true;
  }

  function runLocalCommand(commandId: LocalCommandId, argument = "") {
    if (commandId === "clear") {
      for (const message of activeRequests) {
        void platform.aiChat?.cancel(message.requestId).catch(() => undefined);
      }
      setMessages([]);
      setAttachedNotes([]);
      setSearchLibrary(false);
      setDraft("");
      inputRef.current?.focus();
      return;
    }

    if (commandId === "attach-current") {
      attachCurrentNote();
      setDraft("");
      return;
    }

    if (commandId === "search") {
      setDraft(`@${argument}`);
      inputRef.current?.focus();
      return;
    }

    setDraft("Summarize the selected notes.");
    inputRef.current?.focus();
  }

  async function cancelRequest(requestId: string) {
    try {
      await platform.aiChat?.cancel(requestId);
    } catch (reason) {
      handleChatEvent({
        type: "error",
        requestId,
        message: reason instanceof Error ? reason.message : String(reason),
        recoverable: true,
      });
    }
  }

  function retryRequest(requestId: string) {
    const previous = messages.find(
      (message) => message.requestId === requestId && message.role === "user",
    );
    if (!previous) return;
    setDraft(previous.text);
    setAttachedNotes(previous.context);
    setSearchLibrary(previous.searchLibrary ?? false);
    inputRef.current?.focus();
  }
}

function createUserMessage(
  requestId: string,
  question: string,
  context: Note[],
  searchLibrary: boolean,
): ChatMessage {
  return {
    id: `user-${requestId}`,
    requestId,
    role: "user",
    text: question,
    context,
    searchLibrary,
    citations: [],
    unsupportedCitationHandles: [],
  };
}

function createAssistantMessage(requestId: string): ChatMessage {
  return {
    id: `assistant-${requestId}`,
    requestId,
    role: "assistant",
    text: "",
    context: [],
    status: "Preparing request…",
    pending: true,
    citations: [],
    unsupportedCitationHandles: [],
  };
}

function providerStatus(
  provider: ChatMessage["provider"],
  externalTransmission: boolean | undefined,
) {
  if (!provider) return "Completed.";
  return externalTransmission
    ? `${provider.name} · sent after approval`
    : `${provider.name} · kept on this device`;
}
