import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type WebContents,
} from "electron";
import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertTrustedIpcSenderUrl,
  canvasPreviewPartition,
  castleContentSecurityPolicy,
  configureCanvasPreviewWebPreferences,
  isAllowedExternalUrl,
  isAllowedCanvasPreviewUrl,
  isTrustedRendererUrl,
  packagedAssetCacheControl,
  resolvePackagedFilePath,
} from "./security_policy";
import {
  libraryCacheKey,
  readDesktopSettings,
  rememberDesktopLibrary,
  repositoryRootForLibrary,
  resolveDesktopDataRoot,
  resolveSelectedLibraryRoot,
  writeDesktopSettings,
  type DesktopSettings,
} from "./library_location";
import {
  aiChatEventChannel,
  cancelAiChatChannel,
  chooseLibraryChannel,
  clearAiChatAuditChannel,
  contentDeltaChannel,
  contentServiceStatusChannel,
  desktopInfoChannel,
  fullScreenStateChannel,
  getAiChatAuditChannel,
  getFullScreenStateChannel,
  openLibraryChannel,
  loadUserPreferencesChannel,
  listManagedSheetsChannel,
  listManagedCanvasesChannel,
  saveUserPreferencesChannel,
  parseChatCancellation,
  parseChatRequest,
  parseOpenLibraryInput,
  parseManagedSheetPathInput,
  parseManagedCanvasPathInput,
  parseManagedCanvasWriteInput,
  parseUserPreferencesInput,
  restartAppChannel,
  retryContentServiceChannel,
  readManagedSheetChannel,
  saveManagedSheetChannel,
  readManagedCanvasChannel,
  createManagedCanvasChannel,
  saveManagedCanvasChannel,
  importCanvasMediaChannel,
  openCanvasMediaChannel,
  resolveVideoPosterChannel,
  parseCanvasMediaImportInput,
  parseCanvasMediaPathInput,
  sourceChangeChannel,
  startAiChatChannel,
} from "./ipc_contract";
import {
  parseVideoPosterInput,
  resolveVideoPoster,
} from "./video_poster";
import { listManagedSheets, readManagedSheet, saveManagedSheet } from "./sheet_library";
import {
  createManagedCanvas,
  listManagedCanvases,
  readManagedCanvas,
  saveManagedCanvas,
} from "./canvas_library";
import { importCanvasMedia, resolveCanvasMedia } from "./canvas_media_library";
import { readUserPreferences, writeUserPreferences } from "./user_preferences";
import type {
  CastleContentServiceStatus,
  CastleDesktopInfo,
  CastleDesktopLibrary,
  CastleLibrarySelectionResult,
} from "../src/platform/desktop_bridge";
import {
  CastleNativeService,
  resolveCastleNativeBinary,
} from "./native_service";
import { createCastleWindowChrome } from "./window_chrome";
import { CastleChatOrchestrator } from "./ai/chat_orchestrator";
import {
  CodexCliChatProvider,
  LocalRetrievalChatProvider,
  resolveCodexExecutable,
} from "./ai/chat_provider";
import {
  externalRequestAllowedByPolicy,
  type ExternalRequestPreview,
} from "./ai/privacy_policy";
import type { CastleChatEvent } from "../src/platform/ai_chat";
import { CastleChatAuditLog } from "./ai/chat_audit_log";
import {
  registerContentIpc,
  type DesktopServiceAccess,
} from "./content_ipc";
import {
  castleApplicationName,
  resolveCastleRuntimeIconPath,
} from "./app_identity";

const castleScheme = "castle";

protocol.registerSchemesAsPrivileged([
  {
    scheme: castleScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
    },
  },
]);
app.setName(castleApplicationName);
app.enableSandbox();

function castleRuntimeIconPath() {
  return resolveCastleRuntimeIconPath({
    isPackaged: app.isPackaged,
    mainBundleDirectory: __dirname,
    resourcesPath: process.resourcesPath,
  });
}

function isFile(filePath: string) {
  return existsSync(filePath) && statSync(filePath).isFile();
}

async function servePackagedAsset(
  rendererRoot: string,
  contentRoot: string,
  requestUrl: string,
) {
  const filePath = resolvePackagedFilePath({
    contentRoot,
    fileExists: isFile,
    rendererRoot,
    requestUrl,
  });
  if (!filePath) return new Response("Not found", { status: 404 });

  const response = await net.fetch(pathToFileURL(filePath).toString());
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set(
    "cache-control",
    packagedAssetCacheControl({ contentRoot, filePath, rendererRoot }),
  );
  if (path.extname(filePath).toLowerCase() === ".html") {
    headers.set("content-security-policy", castleContentSecurityPolicy);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function registerPackagedProtocol(contentRoot: string) {
  const rendererRoot = path.join(
    __dirname,
    "../renderer",
    MAIN_WINDOW_VITE_NAME,
  );
  protocol.handle(castleScheme, (request) =>
    servePackagedAsset(rendererRoot, contentRoot, request.url),
  );
}

function desktopDataRoot() {
  return resolveDesktopDataRoot(
    app.getPath("userData"),
    process.env.CASTLE_DESKTOP_DATA_ROOT,
  );
}

function logDesktopDiagnostic(message: string, details?: unknown) {
  if (process.env.CASTLE_DESKTOP_DIAGNOSTICS !== "1") return;
  console.log(`[castle:desktop] ${message}`, details ?? "");
  try {
    const dataRoot = desktopDataRoot();
    mkdirSync(dataRoot, { recursive: true });
    appendFileSync(
      path.join(dataRoot, "startup.log"),
      `${new Date().toISOString()} ${message} ${JSON.stringify(details ?? null)}\n`,
      "utf8",
    );
  } catch {
    // Diagnostics must never alter normal startup behavior.
  }
}

function desktopSettingsPath() {
  return path.join(desktopDataRoot(), "settings.json");
}

function readCurrentDesktopSettings() {
  return readDesktopSettings(desktopSettingsPath());
}

function selectedStartupLibraryRoot(settings: DesktopSettings) {
  const configuredRoot = process.env.CASTLE_LIBRARY_ROOT;
  if (configuredRoot) {
    const resolvedRoot = resolveSelectedLibraryRoot(configuredRoot);
    if (resolvedRoot) return resolvedRoot;
    logDesktopDiagnostic("configured library is unavailable", { configuredRoot });
  }
  return settings.activeLibraryRoot;
}

function describeLibrary(
  storedRoot: string,
  activeLibraryRoot: string | null,
): CastleDesktopLibrary {
  const resolvedRoot = resolveSelectedLibraryRoot(storedRoot);
  const libraryRoot = resolvedRoot ?? path.resolve(storedRoot);
  return {
    name: path.basename(repositoryRootForLibrary(libraryRoot)) || "Library",
    path: libraryRoot,
    available: Boolean(resolvedRoot),
    active: Boolean(
      resolvedRoot &&
      activeLibraryRoot &&
      libraryPathsEqual(resolvedRoot, activeLibraryRoot)
    ),
  };
}

function describeLibraries(
  settings: DesktopSettings,
  activeLibraryRoot: string | null,
) {
  const storedRoots = activeLibraryRoot
    ? [activeLibraryRoot, ...settings.recentLibraryRoots]
    : settings.recentLibraryRoots;
  const seen = new Set<string>();
  return storedRoots.flatMap((storedRoot) => {
    const library = describeLibrary(storedRoot, activeLibraryRoot);
    const key = process.platform === "win32"
      ? library.path.toLocaleLowerCase()
      : library.path;
    if (seen.has(key)) return [];
    seen.add(key);
    return [library];
  });
}

function libraryPathsEqual(left: string, right: string) {
  return process.platform === "win32"
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right;
}

function rememberSelectedLibrary(
  selection: string,
): CastleLibrarySelectionResult {
  const libraryRoot = resolveSelectedLibraryRoot(selection);
  if (!libraryRoot) {
    return {
      status: "invalid",
      message:
        "Choose a Castle repository containing library/, or a library folder with notes, tasks, wiki, or another supported section.",
    };
  }

  const settings = rememberDesktopLibrary(readCurrentDesktopSettings(), libraryRoot);
  writeDesktopSettings(desktopSettingsPath(), settings);
  return {
    status: "selected",
    library: describeLibrary(libraryRoot, libraryRoot),
  };
}

function openAllowedExternalUrl(url: string) {
  if (isAllowedExternalUrl(url)) void shell.openExternal(url);
}

function publishContentServiceStatus(status: CastleContentServiceStatus) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(contentServiceStatusChannel, status);
    }
  }
}

function contentServiceCapabilities(access: DesktopServiceAccess | null) {
  const available = Boolean(
    access?.service && access.status.state === "ready",
  );
  return {
    editContent: available,
    createContent: available,
    moveContent: available,
    deleteContent: available,
  };
}

function requireContentService(access: DesktopServiceAccess | null) {
  if (!access?.service || access.status.state !== "ready") {
    throw new Error("Castle source access is unavailable for this window.");
  }
  return access.service;
}

function requireRunningContentService(access: DesktopServiceAccess | null) {
  if (!access?.service) {
    throw new Error("Castle source access is unavailable for this window.");
  }
  return access.service;
}

function secureWebContents(contents: WebContents) {
  contents.on("will-attach-webview", (event, webPreferences, params) => {
    if (!configureCanvasPreviewWebPreferences(webPreferences, params)) {
      event.preventDefault();
    }
  });
  contents.on("did-attach-webview", (_event, guestContents) => {
    secureCanvasPreviewContents(guestContents);
  });
  contents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url, MAIN_WINDOW_VITE_DEV_SERVER_URL)) return;
    event.preventDefault();
    openAllowedExternalUrl(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    openAllowedExternalUrl(url);
    return { action: "deny" };
  });
}

function secureCanvasPreviewContents(contents: WebContents) {
  const preventUnsafeNavigation = (
    event: Electron.Event,
    url: string,
  ) => {
    if (!isAllowedCanvasPreviewUrl(url)) event.preventDefault();
  };
  contents.on("will-navigate", preventUnsafeNavigation);
  contents.on("will-redirect", preventUnsafeNavigation);
  contents.setWindowOpenHandler(({ url }) => {
    openAllowedExternalUrl(url);
    return { action: "deny" };
  });
}

function registerDesktopIpc(
  libraryRoot: string | null,
  serviceAccess: DesktopServiceAccess | null,
) {
  const videoPosterRequests = new Map<string, Promise<string | null>>();
  const chatOwners = new Map<string, WebContents>();
  const observedChatOwners = new WeakSet<WebContents>();
  const chatAudit = new CastleChatAuditLog();
  const codexExecutable = resolveCodexExecutable();
  const codexWorkingDirectory = path.join(desktopDataRoot(), "codex-chat-workspace");
  if (codexExecutable) mkdirSync(codexWorkingDirectory, { recursive: true });
  const chat = new CastleChatOrchestrator(
    {
      search: (request) =>
        requireContentService(serviceAccess).request(
          "searchKnowledge",
          request,
        ),
      readNote: (request) =>
        requireContentService(serviceAccess).request(
          "readNoteContext",
          request,
        ),
    },
    codexExecutable
      ? new CodexCliChatProvider({
          executable: codexExecutable,
          workingDirectory: codexWorkingDirectory,
        })
      : new LocalRetrievalChatProvider(),
    codexExecutable
      ? (preview) => confirmCodexRequest(preview, chatOwners)
      : undefined,
    codexExecutable ? { providerChunkTimeoutMilliseconds: 120_000 } : undefined,
  );
  app.once("before-quit", () => chat.cancelAll());

  ipcMain.handle(getFullScreenStateChannel, (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSenderUrl(
      event.senderFrame?.url,
      MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
  });

  ipcMain.handle(
    resolveVideoPosterChannel,
    (event: IpcMainInvokeEvent, rawInput: unknown) => {
      assertTrustedIpcSenderUrl(
        event.senderFrame?.url,
        MAIN_WINDOW_VITE_DEV_SERVER_URL,
      );
      const { url } = parseVideoPosterInput(rawInput);
      let request = videoPosterRequests.get(url);
      if (!request) {
        request = resolveVideoPoster(url).catch(() => null);
        videoPosterRequests.set(url, request);
      }
      return request;
    },
  );

  ipcMain.handle(chooseLibraryChannel, async (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSenderUrl(
      event.senderFrame?.url,
      MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );
    const options: OpenDialogOptions = {
      title: "Open a Castle library",
      message:
        "Choose the repository containing library/ or the library folder itself.",
      buttonLabel: "Open library",
      properties: ["openDirectory"],
    };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner && !owner.isDestroyed()
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return { status: "cancelled" } satisfies CastleLibrarySelectionResult;
    }
    return rememberSelectedLibrary(result.filePaths[0]);
  });

  ipcMain.handle(
    openLibraryChannel,
    (event: IpcMainInvokeEvent, rawInput: unknown) => {
      assertTrustedIpcSenderUrl(
        event.senderFrame?.url,
        MAIN_WINDOW_VITE_DEV_SERVER_URL,
      );
      const input = parseOpenLibraryInput(rawInput);
      const settings = readCurrentDesktopSettings();
      const requestedPath = path.resolve(input.path);
      const storedRoot = settings.recentLibraryRoots.find((candidate) =>
        libraryPathsEqual(path.resolve(candidate), requestedPath),
      );
      if (!storedRoot) {
        return {
          status: "invalid",
          message: "That folder is not one of Castle's remembered libraries.",
        } satisfies CastleLibrarySelectionResult;
      }
      return rememberSelectedLibrary(storedRoot);
    },
  );

  ipcMain.handle(desktopInfoChannel, (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSenderUrl(
      event.senderFrame?.url,
      MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );

    const libraries = describeLibraries(
      readCurrentDesktopSettings(),
      libraryRoot,
    );
    return {
      runtime: "desktop",
      operatingSystem: process.platform,
      library:
        libraries.find((library) => library.active) ??
        (libraryRoot ? describeLibrary(libraryRoot, libraryRoot) : null),
      libraries,
      capabilities: {
        ...contentServiceCapabilities(libraryRoot ? serviceAccess : null),
      },
      contentServiceStatus: serviceAccess?.status ?? {
        state: "unavailable",
        message: libraryRoot
          ? "Castle content service is unavailable."
          : "Choose a library to start Castle.",
        generatedAt: "",
      },
    } satisfies CastleDesktopInfo;
  });

  ipcMain.handle(loadUserPreferencesChannel, (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSenderUrl(
      event.senderFrame?.url,
      MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );
    return libraryRoot ? readUserPreferences(libraryRoot) : null;
  });

  ipcMain.handle(listManagedSheetsChannel, (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSenderUrl(
      event.senderFrame?.url,
      MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );
    if (!libraryRoot) return [];
    return listManagedSheets(libraryRoot);
  });

  ipcMain.handle(
    readManagedSheetChannel,
    (event: IpcMainInvokeEvent, rawInput: unknown) => {
      assertTrustedIpcSenderUrl(
        event.senderFrame?.url,
        MAIN_WINDOW_VITE_DEV_SERVER_URL,
      );
      if (!libraryRoot) throw new Error("Choose a library before opening sheets.");
      const input = parseManagedSheetPathInput(rawInput);
      return readManagedSheet(libraryRoot, input.relativePath);
    },
  );

  ipcMain.handle(
    saveManagedSheetChannel,
    (event: IpcMainInvokeEvent, rawInput: unknown) => {
      assertTrustedIpcSenderUrl(
        event.senderFrame?.url,
        MAIN_WINDOW_VITE_DEV_SERVER_URL,
      );
      if (!libraryRoot) throw new Error("Choose a library before saving sheets.");
      if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
        throw new Error("Castle rejected an invalid sheet save.");
      }
      const input = rawInput as Record<string, unknown>;
      const { relativePath } = parseManagedSheetPathInput({ relativePath: input.relativePath });
      if (!(input.archive instanceof ArrayBuffer)) {
        throw new Error("Castle rejected invalid spreadsheet bytes.");
      }
      return saveManagedSheet(libraryRoot, relativePath, input.archive);
    },
  );

  ipcMain.handle(listManagedCanvasesChannel, (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSenderUrl(
      event.senderFrame?.url,
      MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );
    if (!libraryRoot) return [];
    return listManagedCanvases(libraryRoot);
  });

  ipcMain.handle(
    readManagedCanvasChannel,
    (event: IpcMainInvokeEvent, rawInput: unknown) => {
      assertTrustedIpcSenderUrl(
        event.senderFrame?.url,
        MAIN_WINDOW_VITE_DEV_SERVER_URL,
      );
      if (!libraryRoot) throw new Error("Choose a library before opening canvases.");
      const input = parseManagedCanvasPathInput(rawInput);
      return readManagedCanvas(libraryRoot, input.relativePath);
    },
  );

  ipcMain.handle(
    createManagedCanvasChannel,
    (event: IpcMainInvokeEvent, rawInput: unknown) => {
      assertTrustedIpcSenderUrl(
        event.senderFrame?.url,
        MAIN_WINDOW_VITE_DEV_SERVER_URL,
      );
      if (!libraryRoot) throw new Error("Choose a library before creating canvases.");
      const input = parseManagedCanvasWriteInput(rawInput);
      return createManagedCanvas(libraryRoot, input.relativePath, input.source);
    },
  );

  ipcMain.handle(
    saveManagedCanvasChannel,
    (event: IpcMainInvokeEvent, rawInput: unknown) => {
      assertTrustedIpcSenderUrl(
        event.senderFrame?.url,
        MAIN_WINDOW_VITE_DEV_SERVER_URL,
      );
      if (!libraryRoot) throw new Error("Choose a library before saving canvases.");
      const input = parseManagedCanvasWriteInput(rawInput);
      return saveManagedCanvas(libraryRoot, input.relativePath, input.source);
    },
  );

  ipcMain.handle(
    importCanvasMediaChannel,
    async (event: IpcMainInvokeEvent, rawInput: unknown) => {
      assertTrustedIpcSenderUrl(
        event.senderFrame?.url,
        MAIN_WINDOW_VITE_DEV_SERVER_URL,
      );
      if (!libraryRoot) throw new Error("Choose a library before adding canvas media.");
      return importCanvasMedia(libraryRoot, parseCanvasMediaImportInput(rawInput));
    },
  );

  ipcMain.handle(
    openCanvasMediaChannel,
    async (event: IpcMainInvokeEvent, rawInput: unknown) => {
      assertTrustedIpcSenderUrl(
        event.senderFrame?.url,
        MAIN_WINDOW_VITE_DEV_SERVER_URL,
      );
      if (!libraryRoot) throw new Error("Choose a library before opening canvas media.");
      const { relativePath } = parseCanvasMediaPathInput(rawInput);
      const openError = await shell.openPath(await resolveCanvasMedia(libraryRoot, relativePath));
      if (openError) throw new Error(`Castle could not open this media file: ${openError}`);
    },
  );

  ipcMain.handle(
    saveUserPreferencesChannel,
    (event: IpcMainInvokeEvent, rawInput: unknown) => {
      assertTrustedIpcSenderUrl(
        event.senderFrame?.url,
        MAIN_WINDOW_VITE_DEV_SERVER_URL,
      );
      if (!libraryRoot) throw new Error("Choose a library before saving preferences.");
      const preferences = parseUserPreferencesInput(rawInput);
      writeUserPreferences(libraryRoot, preferences);
      return preferences;
    },
  );

  registerContentIpc({
    developmentServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    libraryRoot,
    serviceAccess,
  });
  ipcMain.handle(
    startAiChatChannel,
    (event: IpcMainInvokeEvent, rawInput: unknown) => {
      assertTrustedIpcSenderUrl(
        event.senderFrame?.url,
        MAIN_WINDOW_VITE_DEV_SERVER_URL,
      );
      if (!libraryRoot) {
        throw new Error("Castle chat is unavailable for this window.");
      }
      const request = parseChatRequest(rawInput);
      if (chatOwners.has(request.requestId)) {
        throw new Error("Castle rejected a duplicate chat request ID.");
      }
      const owner = event.sender;
      chatOwners.set(request.requestId, owner);
      chatAudit.begin(request.requestId);
      if (!observedChatOwners.has(owner)) {
        observedChatOwners.add(owner);
        owner.once("destroyed", () => {
          for (const [requestId, candidate] of chatOwners) {
            if (candidate !== owner) continue;
            chat.cancel(requestId);
            chatOwners.delete(requestId);
          }
        });
      }
      try {
        chat.start(request, (chatEvent: CastleChatEvent) => {
          chatAudit.observe(chatEvent);
          if (
            chatEvent.type === "complete" ||
            chatEvent.type === "error" ||
            (chatEvent.type === "status" && chatEvent.status === "cancelled")
          ) {
            chatOwners.delete(request.requestId);
          }
          if (!owner.isDestroyed()) owner.send(aiChatEventChannel, chatEvent);
        });
      } catch (reason) {
        chatOwners.delete(request.requestId);
        chatAudit.failStart(request.requestId);
        throw reason;
      }
      return { requestId: request.requestId };
    },
  );

  ipcMain.handle(
    cancelAiChatChannel,
    (event: IpcMainInvokeEvent, rawInput: unknown) => {
      assertTrustedIpcSenderUrl(
        event.senderFrame?.url,
        MAIN_WINDOW_VITE_DEV_SERVER_URL,
      );
      const { requestId } = parseChatCancellation(rawInput);
      if (chatOwners.get(requestId) !== event.sender) {
        throw new Error("Castle cannot cancel that chat request.");
      }
      chat.cancel(requestId);
    },
  );

  ipcMain.handle(getAiChatAuditChannel, (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSenderUrl(
      event.senderFrame?.url,
      MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );
    return chatAudit.snapshot();
  });

  ipcMain.handle(clearAiChatAuditChannel, (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSenderUrl(
      event.senderFrame?.url,
      MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );
    return chatAudit.clear();
  });

  ipcMain.handle(retryContentServiceChannel, async (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSenderUrl(
      event.senderFrame?.url,
      MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );
    const service = requireRunningContentService(serviceAccess);
    try {
      const state = await service.request("refresh", {});
      if (!serviceAccess) throw new Error("Castle content service is unavailable.");
      serviceAccess.status = {
        state: "ready",
        message: "Castle content is current.",
        generatedAt: state.generatedAt,
      };
      publishContentServiceStatus(serviceAccess.status);
      return serviceAccess.status;
    } catch (reason) {
      if (serviceAccess) {
        serviceAccess.status = {
          state: "stale",
          message: reason instanceof Error ? reason.message : String(reason),
          generatedAt: serviceAccess.status.generatedAt,
        };
        publishContentServiceStatus(serviceAccess.status);
      }
      throw reason;
    }
  });

  ipcMain.handle(restartAppChannel, (event: IpcMainInvokeEvent) => {
    assertTrustedIpcSenderUrl(
      event.senderFrame?.url,
      MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );
    app.relaunch();
    app.exit(0);
  });
}

async function confirmCodexRequest(
  preview: ExternalRequestPreview,
  chatOwners: ReadonlyMap<string, WebContents>,
) {
  const permitted = externalRequestAllowedByPolicy(
    {
      schemaVersion: 1,
      externalTransmission: "confirm_each_request",
      excludedSections: [],
      excludedNoteIds: [],
    },
  );
  if (!permitted) return false;

  const selectedNotes = preview.request.attachedNoteIds.length;
  const scope = [
    selectedNotes === 0
      ? "• No notes explicitly attached"
      : `• ${selectedNotes} explicitly attached note${selectedNotes === 1 ? "" : "s"}`,
    preview.request.searchLibrary
      ? `• Search Castle for up to ${preview.maximumSources} relevant note excerpts`
      : "• Library-wide search is off",
  ].join("\n");
  const question = preview.request.question.length > 420
    ? `${preview.request.question.slice(0, 419)}…`
    : preview.request.question;
  const options = {
    type: "question" as const,
    title: "Send message to OpenAI?",
    message: `Send this message to ${preview.provider.name}?`,
    detail: `“${question}”\n\nScope\n${scope}\n\nCastle will send only the approved message and selected context (up to ${preview.maximumContextCharacters.toLocaleString()} characters).`,
    buttons: ["Send", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const owner = chatOwners.get(preview.request.requestId);
  const parentWindow = owner && !owner.isDestroyed()
    ? BrowserWindow.fromWebContents(owner)
    : null;
  const result = parentWindow && !parentWindow.isDestroyed()
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: "#060606",
    icon: castleRuntimeIconPath(),
    show: false,
    title: castleApplicationName,
    ...createCastleWindowChrome(process.platform),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
    },
  });

  secureWebContents(mainWindow.webContents);
  mainWindow.on("enter-full-screen", () => {
    mainWindow.webContents.send(fullScreenStateChannel, true);
  });
  mainWindow.on("leave-full-screen", () => {
    mainWindow.webContents.send(fullScreenStateChannel, false);
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadURL("castle://app/");
  }
  return mainWindow;
}

void app.whenReady().then(async () => {
  const appIconPath = castleRuntimeIconPath();
  if (process.platform === "darwin" && app.dock && isFile(appIconPath)) {
    app.dock.setIcon(appIconPath);
  }

  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  const canvasPreviewSession = session.fromPartition(canvasPreviewPartition);
  canvasPreviewSession.setPermissionCheckHandler(() => false);
  canvasPreviewSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  canvasPreviewSession.on("will-download", (event) => event.preventDefault());

  const settings = readCurrentDesktopSettings();
  const libraryRoot = selectedStartupLibraryRoot(settings);
  logDesktopDiagnostic("resolved startup settings", {
    dataRoot: desktopDataRoot(),
    hasSelectedLibrary: Boolean(libraryRoot),
    rememberedLibraryCount: settings.recentLibraryRoots.length,
  });

  const cacheRoot = libraryRoot
    ? path.join(
        desktopDataRoot(),
        "libraries",
        libraryCacheKey(libraryRoot),
        "snapshot",
      )
    : path.join(desktopDataRoot(), "no-library");
  const cachedPublicRoot = path.join(cacheRoot, "public");
  const hasCachedSnapshot = isFile(
    path.join(cachedPublicRoot, "generated", "catalog.json"),
  );
  const serviceAccess: DesktopServiceAccess | null = libraryRoot
    ? {
        service: null,
        status: {
          state: "starting",
          message: "Castle is checking the library for changes.",
          generatedAt: "",
        },
      }
    : null;
  registerDesktopIpc(libraryRoot, serviceAccess);

  if (!MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    registerPackagedProtocol(cachedPublicRoot);
  }
  let mainWindowPromise =
    !libraryRoot || MAIN_WINDOW_VITE_DEV_SERVER_URL || hasCachedSnapshot
      ? createMainWindow()
      : null;
  let nativeService: CastleNativeService | null = null;

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });

  if (!libraryRoot || !serviceAccess) {
    await mainWindowPromise;
    return;
  }

  try {
    const binaryPath = resolveCastleNativeBinary({
      appRoot: app.getAppPath(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      platform: process.platform,
    });
    logDesktopDiagnostic("starting native content service", {
      binaryPath,
      cacheRoot,
    });
    nativeService = await CastleNativeService.start({
      binaryPath,
      libraryRoot,
      repositoryRoot: repositoryRootForLibrary(libraryRoot),
      cacheRoot,
    });
    logDesktopDiagnostic("native snapshot is ready", {
      generatedAt: nativeService.state.generatedAt,
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    logDesktopDiagnostic("local snapshot failed", { message });
    serviceAccess.status = {
      state: "unavailable",
      message,
      generatedAt: "",
    };
    if (mainWindowPromise) {
      await mainWindowPromise;
      publishContentServiceStatus(serviceAccess.status);
    } else {
      dialog.showErrorBox("Castle could not open the library", message);
      app.quit();
    }
    return;
  }

  serviceAccess.service = nativeService;
  serviceAccess.status = {
    state: "ready",
    message: "Castle content is current.",
    generatedAt: nativeService.state.generatedAt,
  };
  nativeService.onSnapshotChanged((state) => {
    serviceAccess.status = {
      state: "ready",
      message: "Castle content is current.",
      generatedAt: state.generatedAt,
    };
    publishContentServiceStatus(serviceAccess.status);
  });
  nativeService.onSourceChanged((change) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(sourceChangeChannel, change);
      }
    }
  });
  nativeService.onContentDelta((delta) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(contentDeltaChannel, delta);
      }
    }
  });
  nativeService.onSnapshotError((reason) => {
    console.error("[castle] Library regeneration failed", reason);
    serviceAccess.status = {
      state: "stale",
      message: reason.message,
      generatedAt: serviceAccess.status.generatedAt,
    };
    publishContentServiceStatus(serviceAccess.status);
  });
  nativeService.onExit((reason) => {
    console.error("[castle] Native content service stopped", reason);
    serviceAccess.status = {
      state: "unavailable",
      message: reason.message,
      generatedAt: serviceAccess.status.generatedAt,
    };
    serviceAccess.service = null;
    publishContentServiceStatus(serviceAccess.status);
  });
  app.once("before-quit", () => nativeService.stop());
  mainWindowPromise ??= createMainWindow();
  await mainWindowPromise;
  publishContentServiceStatus(serviceAccess.status);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
