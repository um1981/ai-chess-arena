import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `npm run dev` runs the spectator UI on :5173 and proxies API/MCP/WebSocket
// traffic to `wrangler dev` (npm run dev:worker) on :8787.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", ws: true, changeOrigin: true },
      "/mcp": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
});
