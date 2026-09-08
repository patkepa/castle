import type { BrowserWindowConstructorOptions } from "electron";

type CastleWindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
>;

const titleBarHeight = 32;

export function createCastleWindowChrome(
  platform: NodeJS.Platform,
): CastleWindowChromeOptions {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 12, y: 10 },
    };
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#060606",
      symbolColor: "#b8b8b8",
      height: titleBarHeight,
    },
  };
}
