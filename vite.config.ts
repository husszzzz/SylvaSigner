import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022"
  },
  optimizeDeps: {
    entries: ["index.html"]
  },
  worker: {
    format: "es"
  }
});
