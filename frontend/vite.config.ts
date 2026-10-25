import { defineConfig } from "vite";

// Dev: vite on :5173, PocketBase on :8090. Prod: PocketBase serves dist/ itself.
export default defineConfig({
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8090", changeOrigin: false },
      "/_": { target: "http://127.0.0.1:8090", changeOrigin: false },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
