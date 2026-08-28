import path from "node:path";
import { readCastleConfiguration } from "../scripts/read-configuration.mjs";

const configuration = readCastleConfiguration();

export const castleApplicationName = configuration.applicationName;
export const castleAppBundleId = configuration.applicationBundleId;
export const castleIconFileName = "castle.png";

export function resolveCastleRuntimeIconPath({
  isPackaged,
  mainBundleDirectory,
  resourcesPath,
}: {
  isPackaged: boolean;
  mainBundleDirectory: string;
  resourcesPath: string;
}) {
  return isPackaged
    ? path.join(resourcesPath, castleIconFileName)
    : path.resolve(
        mainBundleDirectory,
        "../../resources/app-icons",
        castleIconFileName,
      );
}
