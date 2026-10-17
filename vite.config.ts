import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: "index.html", mapLab: "experiments/map-lab/index.html" } } },
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:8080", rewrite: path => path.replace(/^\/api/, "") } },
  },
  test: { environment: "jsdom" },
});
