import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { CastlePlatform } from "./castle_platform";

const CastlePlatformContext = createContext<CastlePlatform | null>(null);

export function CastlePlatformProvider({
  children,
  platform,
}: {
  children: ReactNode;
  platform: CastlePlatform;
}) {
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
