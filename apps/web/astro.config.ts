import react from "@astrojs/react";
import { defineConfig } from "astro/config";

const configuredBase = process.env.CASTLE_BASE_PATH ?? "/";
const base = `/${configuredBase.split("/").filter(Boolean).join("/")}`;

export default defineConfig({
  base: base === "/" ? "/" : `${base}/`,
  integrations: [react()],
  output: "static",
  publicDir: ".castle/public",
  trailingSlash: "always",
  build: {
    assets: "app-assets",
    format: "directory",
  },
});
