import { fileURLToPath } from "node:url";

process.env.TSX_TSCONFIG_PATH = fileURLToPath(
  new URL("../apps/desktop/tsconfig.json", import.meta.url),
);
await import("tsx");
