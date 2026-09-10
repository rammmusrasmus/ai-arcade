import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, `${process.cwd()}/../..`, "");
  const apiTarget = env.VITE_API_URL || "http://127.0.0.1:4000";

  return {
    // Read env files from the monorepo root so VITE_API_URL is shared with the API.
    envDir: "../..",
    plugins: [react(), tailwind()],
    server: {
      port: 5173,
      strictPort: true,
      host: "127.0.0.1",
      // Serve game bundles / images same-origin so sandboxed iframes load
      // reliably (the API still stamps `CSP: sandbox` on game documents).
      proxy: {
        "/files": { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
