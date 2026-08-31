import {
  flipFuses,
  FuseV1Options,
  FuseVersion,
  type FuseV1Config,
} from "@electron/fuses";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type {
  ForgeConfig,
  ForgePlatform,
} from "@electron-forge/shared-types";
import path from "node:path";
import {
  castleAppBundleId,
  castleApplicationName,
} from "../electron/app_identity";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const nativeExecutableName = process.platform === "win32" ? "castle.exe" : "castle";
const nativeExecutablePath = path.resolve(
  repositoryRoot,
  "native",
  "target",
  "release",
  nativeExecutableName,
);
const appIconPngPath = path.resolve(repositoryRoot, "resources", "app-icons", "castle.png");
const appIconIcnsPath = path.resolve(repositoryRoot, "resources", "app-icons", "castle.icns");

const fuseConfig: FuseV1Config = {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.WasmTrapHandlers]: true,
};

function electronExecutablePath(buildPath: string, platform: ForgePlatform) {
  const basePath = path.resolve(buildPath, "../..");
  if (platform === "darwin" || platform === "mas") {
    return path.join(basePath, "MacOS", "Electron");
  }
  return path.join(basePath, platform === "win32" ? "electron.exe" : "electron");
}

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: castleAppBundleId,
    asar: true,
    executableName: castleApplicationName,
    extraResource: [nativeExecutablePath, appIconPngPath],
    icon: appIconIcnsPath,
    name: castleApplicationName,
  },
  hooks: {
    packageAfterCopy: async (
      resolvedConfig,
      buildPath,
      _electronVersion,
      platform,
      arch,
    ) => {
      const osxSign = resolvedConfig.packagerConfig.osxSign;
      const hasOsxSign =
        Boolean(osxSign) &&
        (typeof osxSign !== "object" || Object.keys(osxSign).length > 0);
      const resetAdHocDarwinSignature =
        !hasOsxSign &&
        (platform === "darwin" || platform === "mas") &&
        arch === "arm64";

      await flipFuses(electronExecutablePath(buildPath, platform), {
        resetAdHocDarwinSignature,
        ...fuseConfig,
      });
    },
  },
  makers: [new MakerZIP({}, ["darwin"])],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "electron/main.ts",
          config: "config/vite.main.config.ts",
          target: "main",
        },
        {
          entry: "electron/preload.ts",
          config: "config/vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "config/vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
