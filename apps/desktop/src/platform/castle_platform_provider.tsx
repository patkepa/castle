import {
  createContext,
  useEffect,
  useContext,
  type ReactNode,
} from "react";
import type { CastlePlatform } from "./castle_platform";
import { configureCastleUserPreferenceServices } from "../lib/userPreferences";

const CastlePlatformContext = createContext<CastlePlatform | null>(null);

export function CastlePlatformProvider({
  children,
  platform,
}: {
  children: ReactNode;
  platform: CastlePlatform;
}) {
  useEffect(
    () => configureCastleUserPreferenceServices(platform.desktopServices),
    [platform.desktopServices],
  );
  return (
    <CastlePlatformContext.Provider value={platform}>
      {children}
    </CastlePlatformContext.Provider>
  );
}

export function useCastlePlatform() {
  const platform = useContext(CastlePlatformContext);
  if (!platform) {
    throw new Error("CastlePlatformProvider is missing from the application root.");
  }
  return platform;
}
