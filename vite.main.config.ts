import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@main": resolve(__dirname, "src/main"),
    },
  },
  build: {
    lib: {
      entry: "src/main/index.ts",
      fileName: () => "main.js",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: ["electron", "better-sqlite3"],
    },
  },
});
