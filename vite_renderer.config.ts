import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
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
