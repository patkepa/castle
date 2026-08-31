import { fileURLToPath } from "node:url";

process.env.TSX_TSCONFIG_PATH = fileURLToPath(
  new URL("../tsconfig.json", import.meta.url),
);
await import("tsx");
