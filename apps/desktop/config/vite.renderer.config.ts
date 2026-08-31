import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(import.meta.dirname, ".."),
  plugins: [react()],
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
