import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Temporary friend-test tunnel; replace this host when a new tunnel is issued.
    allowedHosts: ["cubic-moves-probably-thinks.trycloudflare.com"],
    // Wait for editors/formatters to finish writing before caching an HMR update.
    watch: {
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
    },
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
