import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: "index.html", mapLab: "experiments/map-lab/index.html" } } },
  server: {
    proxy: { "/api": { target: process.env.VITE_API_PROXY || "http://127.0.0.1:8080", changeOrigin: true, rewrite: path => path.replace(/^\/api/, "") } },
  },
  // e2e/ holds the Playwright tests (npm run e2e).
  test: { environment: "jsdom", exclude: [...configDefaults.exclude, "e2e/**"] },
});
