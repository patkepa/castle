import react from "@astrojs/react";
import { defineConfig } from "astro/config";

const configuredBase = process.env.CASTLE_BASE_PATH ?? "/";
const base = `/${configuredBase.split("/").filter(Boolean).join("/")}`;
const configuredOutDir = process.env.CASTLE_OUT_DIR ?? "dist";
const outDir = configuredOutDir.replace(/^\/+|\/+$/g, "");

export default defineConfig({
  base: base === "/" ? "/" : `${base}/`,
  integrations: [react()],
  output: "static",
  publicDir: "public",
  outDir,
  trailingSlash: "always",
  build: {
    assets: "app-assets",
    format: "directory",
  },
});
