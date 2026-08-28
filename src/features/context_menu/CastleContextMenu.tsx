import {
  Children,
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AriaAttributes,
  type KeyboardEvent,
  type KeyboardEventHandler,
  type MouseEvent,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  hideContextMenu,
  Icon,
  Menu,
  MenuDivider,
  MenuItem,
  showContextMenu,
} from "@patkepa/kantzen-ui/primitives";
import { useNavigate } from "react-router-dom";
import type { CastlePlatform } from "../../platform/castle_platform";
import { useCastlePlatform } from "../../platform/castle_platform_provider";
import type {
  CastleContextMenuAction,
  CastleContextMenuModel,
  CastleContextMenuOperation,
  CastleContextMenuPoint,
} from "./context_menu_types";

interface CastleContextMenuApi {
  openMenu: (
    menu: CastleContextMenuModel,
    point: CastleContextMenuPoint,
  ) => void;
}

interface FeedbackMessage {
  id: number;
  title: string;
  detail: string;
  tone: "success" | "error";
}

interface ContextTargetProps {
  onContextMenu?: MouseEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  className?: string;
  "aria-haspopup"?: AriaAttributes["aria-haspopup"];
  "aria-keyshortcuts"?: string;
}

const CastleContextMenuContext = createContext<CastleContextMenuApi | null>(
  null,
);

export function CastleContextMenuProvider({
  children,
}: {
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const platform = useCastlePlatform();
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  const showFeedback = useCallback(
    (
      title: string,
      detail: string,
      tone: FeedbackMessage["tone"],
    ) => {
      setFeedback({ id: Date.now(), title, detail, tone });
    },
    [],
  );

  const executeOperation = useCallback(
    async (action: CastleContextMenuAction) => {
      const operation = action.operation;
      if (!operation) return;
      hideContextMenu();

      try {
        switch (operation.type) {
          case "navigate":
            if (operation.newTab) {
              window.open(
                new URL(operation.to, window.location.href).href,
                "_blank",
                "noopener,noreferrer",
              );
            } else {
              navigate(operation.to);
            }
            return;
          case "copy":
            await copyText(operation.value);
            showFeedback(operation.feedback, action.label, "success");
            return;
          case "copy-route":
            await copyText(new URL(operation.route, window.location.href).href);
            showFeedback(operation.feedback, action.label, "success");
            return;
          case "move-source": {
            const mutations = platform.contentMutations;
            if (!platform.capabilities.moveContent || !mutations) {
              throw new Error("Moving content is unavailable");
            }
            const destinationSourceFile = promptForMoveDestination(operation);
            if (!destinationSourceFile || destinationSourceFile === operation.sourceFile) {
              return;
            }
            const source = await mutations.readSource(operation.noteId);
            const moved = await mutations.moveSource({
              noteId: source.noteId,
              sourceFile: source.sourceFile,
              destinationSourceFile,
              expectedRevision: source.revision,
            });
            showFeedback(
              operation.mode === "rename" ? "Note renamed" : "Note moved",
              moved.sourceFile,
              "success",
            );
            if (window.location.pathname === operation.route) {
              window.addEventListener(
                "castle:generated-content-change",
                () => {
                  if (window.location.pathname === operation.route) {
                    navigate(moved.route, { replace: true });
                  }
                },
                { once: true },
              );
            }
            return;
          }
          case "callback":
            operation.execute();
            return;
        }
      } catch {
        showFeedback(
          "Couldn’t complete action",
          operationFailureMessage(operation),
          "error",
        );
      }
    },
    [navigate, platform, showFeedback],
  );

  const openMenu = useCallback(
    (menu: CastleContextMenuModel, point: CastleContextMenuPoint) => {
      const availableMenu = filterAvailableContextMenu(menu, platform);
      if (availableMenu.groups.length === 0) return;

      showContextMenu({
        content: (
          <CastleContextMenuContent
            menu={availableMenu}
            onAction={(action) => void executeOperation(action)}
          />
        ),
        targetOffset: point,
        placement: "right-start",
        popoverClassName: "castle-context-menu-popover",
        transitionDuration: 80,
      });
    },
    [executeOperation, platform],
  );

  const value = useMemo(() => ({ openMenu }), [openMenu]);

  return (
    <CastleContextMenuContext.Provider value={value}>
      {children}
      <ContextActionFeedback
        feedback={feedback}
        onDismiss={() => setFeedback(null)}
      />
    </CastleContextMenuContext.Provider>
  );
}

export function ContextMenuTarget({
  children,
  menu,
  onOpen,
}: {
  children: ReactElement<ContextTargetProps>;
  menu?: CastleContextMenuModel;
  onOpen?: () => void;
}) {
  const child = Children.only(children);
  const context = useContext(CastleContextMenuContext);
  if (!context || !menu) return child;

  const { openMenu } = context;
  const childContextMenu = child.props.onContextMenu;
  const childKeyDown = child.props.onKeyDown;
  const existingShortcuts = child.props["aria-keyshortcuts"];

  const handleContextMenu = (event: MouseEvent<HTMLElement>) => {
    childContextMenu?.(event);
    if (event.defaultPrevented || shouldKeepNativeContextMenu(event)) return;

    event.preventDefault();
    event.stopPropagation();
    onOpen?.();
    openMenu(menu, { left: event.clientX, top: event.clientY });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    childKeyDown?.(event);
    if (event.defaultPrevented || !isContextMenuKey(event)) return;

    event.preventDefault();
    event.stopPropagation();
    onOpen?.();
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(menu, {
      left: Math.min(rect.left + 20, window.innerWidth - 24),
      top: Math.min(rect.top + Math.min(rect.height, 32), window.innerHeight - 24),
    });
  };

  return cloneElement(child, {
    onContextMenu: handleContextMenu,
    onKeyDown: handleKeyDown,
    "aria-haspopup": "menu",
    "aria-keyshortcuts": [existingShortcuts, "Shift+F10"]
      .filter(Boolean)
      .join(" "),
  });
}

export function useCastleContextMenu() {
  const context = useContext(CastleContextMenuContext);
  if (!context) {
    throw new Error(
      "CastleContextMenuProvider is missing from the application root.",
    );
  }
  return context;
}

function CastleContextMenuContent({
  menu,
  onAction,
}: {
  menu: CastleContextMenuModel;
  onAction: (action: CastleContextMenuAction) => void;
}) {
  return (
    <Menu
      aria-label={`${menu.subject} actions`}
      className="castle-context-menu"
    >
      <li className="castle-context-menu-header" role="presentation">
        <span>{menu.kind}</span>
        <strong title={menu.subject}>{menu.subject}</strong>
      </li>
      {menu.groups.map((group, groupIndex) => (
        <ContextMenuGroup
          group={group}
          key={group.id}
          separated={groupIndex > 0}
          onAction={onAction}
        />
      ))}
    </Menu>
  );
}

function ContextMenuGroup({
  group,
  separated,
  onAction,
}: {
  group: CastleContextMenuModel["groups"][number];
  separated: boolean;
  onAction: (action: CastleContextMenuAction) => void;
}) {
  return (
    <>
      {separated ? <MenuDivider /> : null}
      {group.actions.map((action) => (
        <ContextActionItem action={action} key={action.id} onAction={onAction} />
      ))}
    </>
  );
}

function ContextActionItem({
  action,
  onAction,
}: {
  action: CastleContextMenuAction;
  onAction: (action: CastleContextMenuAction) => void;
}) {
  return (
    <MenuItem
      disabled={action.disabled}
      icon={action.icon}
      intent={action.intent}
      onClick={action.children ? undefined : () => onAction(action)}
      text={action.label}
    >
      {action.children?.map((child) => (
        <ContextActionItem action={child} key={child.id} onAction={onAction} />
      ))}
    </MenuItem>
  );
}

function ContextActionFeedback({
  feedback,
  onDismiss,
}: {
  feedback: FeedbackMessage | null;
  onDismiss: () => void;
}) {
  if (!feedback) return null;

  return (
    <div
      className={`context-action-feedback context-action-feedback--${feedback.tone}`}
      key={feedback.id}
      role="status"
    >
      <Icon
        icon={feedback.tone === "success" ? "tick-circle" : "error"}
        aria-hidden="true"
      />
      <span>
        <strong>{feedback.title}</strong>
        <small>{feedback.detail}</small>
      </span>
      <button aria-label="Dismiss notification" onClick={onDismiss} type="button">
        <Icon icon="cross" aria-hidden="true" />
      </button>
    </div>
  );
}

function filterAvailableContextMenu(
  menu: CastleContextMenuModel,
  platform: CastlePlatform,
): CastleContextMenuModel {
  return {
    ...menu,
    groups: menu.groups.flatMap((group) => {
      const actions = group.actions.flatMap((action) => {
        const availableAction = filterAvailableAction(action, platform);
        return availableAction ? [availableAction] : [];
      });
      return actions.length > 0 ? [{ ...group, actions }] : [];
    }),
  };
}

function filterAvailableAction(
  action: CastleContextMenuAction,
  platform: CastlePlatform,
): CastleContextMenuAction | null {
  if (action.children) {
    const children = action.children.flatMap((child) => {
      const availableChild = filterAvailableAction(child, platform);
      return availableChild ? [availableChild] : [];
    });
    return children.length > 0 ? { ...action, children } : null;
  }

  return contextMenuOperationAvailable(action.operation, platform)
    ? action
    : null;
}

function contextMenuOperationAvailable(
  operation: CastleContextMenuOperation,
  platform: CastlePlatform,
) {
  if (operation.type === "move-source") {
    return Boolean(
      platform.capabilities.moveContent && platform.contentMutations,
    );
  }
  return true;
}

function isContextMenuKey(event: KeyboardEvent<HTMLElement>) {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

function shouldKeepNativeContextMenu(event: MouseEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, [contenteditable='true']")) return true;

  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (anchor && isExternalOrSystemLink(anchor.href)) return true;

  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

function isExternalOrSystemLink(href: string) {
  try {
    const url = new URL(href, window.location.href);
    return !["http:", "https:"].includes(url.protocol) || url.origin !== window.location.origin;
  } catch {
    return true;
  }
}

async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

function operationFailureMessage(operation: CastleContextMenuOperation) {
  return operation.type === "copy" || operation.type === "copy-route"
    ? "Clipboard access is unavailable."
    : "Please try again.";
}

function promptForMoveDestination(
  operation: Extract<CastleContextMenuOperation, { type: "move-source" }>,
) {
  if (operation.mode === "move") {
    return window.prompt(
      "Move to a Markdown path inside the library:",
      operation.sourceFile,
    )?.trim() ?? null;
  }
  const separator = operation.sourceFile.lastIndexOf("/");
  const directory = separator < 0 ? "" : operation.sourceFile.slice(0, separator + 1);
  const currentName = operation.sourceFile.slice(separator + 1);
  const requestedName = window.prompt("Rename Markdown file:", currentName)?.trim();
  if (!requestedName) return null;
  if (requestedName.includes("/") || requestedName.includes("\\")) {
    throw new Error("A file name cannot contain a path separator");
  }
  const fileName = /\.mdx?$/iu.test(requestedName)
    ? requestedName
    : `${requestedName}.md`;
  return `${directory}${fileName}`;
}
