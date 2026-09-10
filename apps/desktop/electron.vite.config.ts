import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// Baked in at build time. Set AI_ARCADE_API_URL to your deployed server so a
// fresh install connects with no setup; falls back to localhost for dev builds.
const DEFAULT_API_URL = process.env.AI_ARCADE_API_URL || "";

export default defineConfig({
  main: {
    // Bundle electron-updater (+ its deps) into the main chunk. In an npm
    // workspace its transitive deps hoist to the repo root and electron-builder's
    // file walker misses them, so leaving it external ships a broken require().
    plugins: [externalizeDepsPlugin({ exclude: ["electron-updater"] })],
    define: { __DEFAULT_API_URL__: JSON.stringify(DEFAULT_API_URL) },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    envDir: resolve(__dirname, "../.."),
    // Keep off 5173 so it never fights the web app's dev server.
    server: { port: 5273, strictPort: true },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
    plugins: [react()],
  },
});
