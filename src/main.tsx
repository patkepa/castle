import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  useRouteError,
} from "react-router-dom";
import { ErrorBoundary } from "@patkepa/kantzen-ui/app-shell";
import { ThemeProvider } from "@patkepa/kantzen-ui/theme";
import { Icon } from "@patkepa/kantzen-ui/primitives";
import "@patkepa/kantzen-ui/styles.css";
import "@patkepa/kantzen-ui/app-shell/styles.css";
import "@patkepa/kantzen-ui/command-palette/styles.css";
import "@videojs/react/video/skin.css";
import "./styles.css";
import "./styles/responsive.css";
import { App } from "./App";
import { CastlePlatformProvider } from "./platform/castle_platform_provider";
import {
  createDesktopCastlePlatform,
  resolveCastlePlatform,
} from "./platform/runtime_castle_platform";
import { CastleContextMenuProvider } from "./features/context_menu/CastleContextMenu";
import { LibraryChooser } from "./components/LibraryChooser";
import type {
  CastleContentServiceStatus,
  CastleDesktopBridge,
  CastleDesktopInfo,
} from "./platform/desktop_bridge";
import {
  configureCastleIconLoader,
  preloadCastleSidebarIcons,
} from "./generated/blueprint_icon_paths";

configureCastleIconLoader();
const staleBannerGracePeriodMilliseconds = 4_000;
document.documentElement.classList.add("dark", "kui-dark", "bp6-dark");
if (window.castleDesktop) {
  document.documentElement.classList.add(
    "castle-desktop",
    `castle-desktop--${window.castleDesktop.operatingSystem}`,
  );
}

function RoutedCastleApp() {
  return (
    <CastleContextMenuProvider>
      <App />
    </CastleContextMenuProvider>
  );
}

const castleRouter = createBrowserRouter([
  {
    path: "*",
    element: <RoutedCastleApp />,
    errorElement: <CastleRouteError />,
  },
]);

function CastleRouteError() {
  const routeError = useRouteError();
  const message =
    routeError instanceof Error
      ? routeError.message
      : "An unexpected error occurred while opening this view.";

  return (
    <main className="castle-error-boundary" role="alert">
      <Icon icon="error" size={32} aria-hidden="true" />
      <h1>Castle could not display this view</h1>
      <p>{message}</p>
      <button type="button" onClick={() => window.location.reload()}>
        Reload Castle
      </button>
    </main>
  );
}

function CastleApp() {
  const desktopBridge = window.castleDesktop;
  const [platform, setPlatform] = useState(() =>
    resolveCastlePlatform(desktopBridge),
  );
  const [desktopInfo, setDesktopInfo] = useState<CastleDesktopInfo | null>(null);
  const [desktopInfoError, setDesktopInfoError] = useState("");
  const [contentServiceStatus, setContentServiceStatus] =
    useState<CastleContentServiceStatus | null>(null);

  useEffect(() => {
    if (!desktopBridge) return;
    let active = true;
    const unsubscribe = desktopBridge.onContentServiceStatusChange((status) => {
      if (!active) return;
      setContentServiceStatus(status);
      setDesktopInfo((current) =>
        current ? { ...current, contentServiceStatus: status } : current,
      );
      if (status.state !== "ready") {
        if (status.state !== "stale") {
          setPlatform(createDesktopCastlePlatform(desktopBridge));
        }
        return;
      }
      void desktopBridge
        .getInfo()
        .then((info) => {
          if (active) {
            setPlatform(
              createDesktopCastlePlatform(desktopBridge, info.capabilities),
            );
          }
        })
        .catch((reason: unknown) => {
          console.error("Castle could not refresh desktop capabilities", reason);
        });
    });
    void desktopBridge
      .getInfo()
      .then((info) => {
        if (!active) return;
        setDesktopInfo(info);
        setDesktopInfoError("");
        setPlatform(createDesktopCastlePlatform(desktopBridge, info.capabilities));
        setContentServiceStatus(info.contentServiceStatus);
      })
      .catch((reason: unknown) => {
        console.error("Castle could not load desktop capabilities", reason);
        if (!active) return;
        setDesktopInfoError(
          reason instanceof Error ? reason.message : String(reason),
        );
        setPlatform(createDesktopCastlePlatform(desktopBridge));
        setContentServiceStatus({
          state: "unavailable",
          message: reason instanceof Error ? reason.message : String(reason),
          generatedAt: "",
        });
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktopBridge]);

  if (desktopBridge && !desktopInfo) {
    return (
      <ThemeProvider>
        <DesktopStartupState error={desktopInfoError} />
      </ThemeProvider>
    );
  }

  if (desktopBridge && desktopInfo && !desktopInfo.library) {
    return (
      <ThemeProvider>
        <LibraryChooser bridge={desktopBridge} libraries={desktopInfo.libraries} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      {desktopBridge && desktopInfo?.library && contentServiceStatus ? (
        <DesktopContentServiceBanner
          bridge={desktopBridge}
          status={contentServiceStatus}
          onStatusChange={setContentServiceStatus}
          onPlatformChange={setPlatform}
        />
      ) : null}
      <ErrorBoundary
        action="reload"
        actionLabel="Reload Castle"
        className="castle-error-boundary"
        description={(error) =>
          error.message || "An unexpected rendering error occurred."
        }
        title="Castle could not display this view"
      >
        <CastlePlatformProvider platform={platform}>
          <RouterProvider router={castleRouter} />
        </CastlePlatformProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

function DesktopStartupState({ error }: { error: string }) {
  return (
    <main className="library-launcher library-launcher--loading" role="status">
      <div className="library-startup-status">
        <Icon icon={error ? "error" : "refresh"} size={24} aria-hidden="true" />
        <strong>{error ? "Castle could not read its settings" : "Opening Castle…"}</strong>
        {error ? <small>{error}</small> : null}
      </div>
    </main>
  );
}

function DesktopContentServiceBanner({
  bridge,
  status,
  onStatusChange,
  onPlatformChange,
}: {
  bridge: CastleDesktopBridge;
  status: CastleContentServiceStatus;
  onStatusChange: (status: CastleContentServiceStatus) => void;
  onPlatformChange: (platform: ReturnType<typeof createDesktopCastlePlatform>) => void;
}) {
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirmedStaleStatus, setConfirmedStaleStatus] =
    useState<CastleContentServiceStatus | null>(null);

  useEffect(() => {
    if (status.state !== "stale") return;
    const timeout = window.setTimeout(
      () => setConfirmedStaleStatus(status),
      staleBannerGracePeriodMilliseconds,
    );
    return () => window.clearTimeout(timeout);
  }, [status]);

  const visibleStatus =
    status.state === "stale" && confirmedStaleStatus !== status
      ? null
      : status;
  if (!visibleStatus || visibleStatus.state === "ready") return null;

  const retry = async () => {
    setWorking(true);
    setActionError("");
    try {
      const nextStatus = await bridge.retryContentService();
      const info = await bridge.getInfo();
      onStatusChange(nextStatus);
      onPlatformChange(createDesktopCastlePlatform(bridge, info.capabilities));
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(false);
    }
  };

  return (
    <aside
      className={`desktop-service-banner desktop-service-banner--${visibleStatus.state}`}
      role="alert"
    >
      <Icon
        icon={
          visibleStatus.state === "starting"
            ? "refresh"
            : visibleStatus.state === "stale"
              ? "warning-sign"
              : "offline"
        }
        size={16}
        aria-hidden="true"
      />
      <span>
        <strong>
          {visibleStatus.state === "stale"
            ? "Library changes could not be loaded"
            : visibleStatus.state === "starting"
              ? "Checking the library"
              : "Castle editing is unavailable"}
        </strong>
        <small>{actionError || visibleStatus.message}</small>
      </span>
      {visibleStatus.state === "starting" ? null : visibleStatus.state === "stale" ? (
        <button type="button" disabled={working} onClick={() => void retry()}>
          {working ? "Checking…" : "Try again"}
        </button>
      ) : (
        <button type="button" onClick={() => void bridge.restartApp()}>
          Restart Castle
        </button>
      )}
    </aside>
  );
}

function DesktopCastleApp() {
  const desktopBridge = window.castleDesktop!;
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = desktopBridge.onFullScreenStateChange((nextState) => {
      if (active) setIsFullScreen(nextState);
    });
    void desktopBridge
      .getFullScreenState()
      .then((nextState) => {
        if (active) setIsFullScreen(nextState);
      })
      .catch((reason: unknown) => {
        console.error("Castle could not read the fullscreen state", reason);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktopBridge]);

  return (
    <>
      <div
        className={`desktop-titlebar${
          isFullScreen ? " desktop-titlebar--hidden" : ""
        }`}
        aria-hidden="true"
      >
        <span>Castle</span>
      </div>
      <div className="castle-desktop-viewport">
        <CastleApp />
      </div>
    </>
  );
}

function renderCastle() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {window.castleDesktop ? (
        <DesktopCastleApp />
      ) : (
        <CastleApp />
      )}
    </StrictMode>,
  );
}

void preloadCastleSidebarIcons().then(renderCastle, (error: unknown) => {
  console.error("Castle could not preload sidebar icons", error);
  renderCastle();
});
