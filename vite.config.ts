import { execFile } from "node:child_process";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  parseVideoPosterInput,
  resolveVideoPosterWithFetcher,
} from "./src/lib/videoPosterServer";
import { readCastleConfiguration } from "./scripts/read-configuration.mjs";

const viewerRoot = import.meta.dirname;
const configuration = readCastleConfiguration({ castleRoot: viewerRoot });
const libraryRoot = configuration.libraryPath;
const nativeGeneratorPath = path.join(
  viewerRoot,
  "native",
  "target",
  "release",
  process.platform === "win32" ? "castle.exe" : "castle",
);

export default defineConfig({
  base: process.env.CASTLE_BASE_PATH ?? "/",
  plugins: [react(), videoPosterMetadata(), reloadGeneratedContent()],
  resolve: {
    dedupe: ["react", "react-dom", "react-router-dom"],
  },
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ["import", "if-function"],
      },
    },
  },
  build: {
    assetsDir: "app-assets",
    sourcemap: true,
  },
});

function videoPosterMetadata(): Plugin {
  const requests = new Map<string, Promise<string | null>>();
  return {
    name: "video-poster-metadata",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url ?? "/", "http://castle.local");
        if (requestUrl.pathname !== "/__castle/video-poster") {
          next();
          return;
        }
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.setHeader("cache-control", "private, max-age=3600");
        if (request.method !== "GET") {
          response.statusCode = 405;
          response.end(JSON.stringify({ posterUrl: null }));
          return;
        }
        try {
          const { url } = parseVideoPosterInput({
            url: requestUrl.searchParams.get("url"),
          });
          let posterRequest = requests.get(url);
          if (!posterRequest) {
            posterRequest = resolveVideoPosterWithFetcher(url, fetch)
              .catch(() => null);
            requests.set(url, posterRequest);
          }
          response.end(JSON.stringify({ posterUrl: await posterRequest }));
        } catch {
          response.statusCode = 400;
          response.end(JSON.stringify({ posterUrl: null }));
        }
      });
    },
  };
}

function reloadGeneratedContent(): Plugin {
  return {
    name: "reload-generated-content",
    apply: "serve",
    configureServer(server) {
      let debounceTimer: NodeJS.Timeout | undefined;
      let generating = false;
      let regenerationQueued = false;

      server.watcher.add(libraryRoot);

      const regenerate = () => {
        if (generating) {
          regenerationQueued = true;
          return;
        }

        generating = true;
        execFile(
          nativeGeneratorPath,
          ["build"],
          { cwd: viewerRoot },
          (error, stdout, stderr) => {
            generating = false;

            if (error) {
              server.config.logger.error(
                `[content] Regeneration failed:\n${stderr || error.message}`,
              );
            } else {
              const message = stdout.trim();
              if (message) server.config.logger.info(`[content] ${message}`);
              server.ws.send({ type: "full-reload", path: "*" });
            }

            if (regenerationQueued) {
              regenerationQueued = false;
              regenerate();
            }
          },
        );
      };

      const scheduleRegeneration = (file: string) => {
        if (!isLibraryContent(file)) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(regenerate, 75);
      };

      server.watcher.on("add", scheduleRegeneration);
      server.watcher.on("change", scheduleRegeneration);
      server.watcher.on("unlink", scheduleRegeneration);

      server.httpServer?.once("close", () => {
        clearTimeout(debounceTimer);
        server.watcher.off("add", scheduleRegeneration);
        server.watcher.off("change", scheduleRegeneration);
        server.watcher.off("unlink", scheduleRegeneration);
      });
    },
  };
}

export function isLibraryContent(file: string) {
  const absoluteFile = path.resolve(file);
  const relative = path.relative(libraryRoot, absoluteFile);

  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative) &&
    !relative.split(path.sep).some((segment) => segment.startsWith("."))
  );
}
