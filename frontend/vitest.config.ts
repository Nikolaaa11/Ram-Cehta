import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Round 74 — Vitest pickeaba los .spec.ts de Playwright en e2e/ y
    // tiraba 4 "FAIL" pre-existentes ("test.describe() not expected here").
    // Excluyo el directorio para que `vitest run` quede limpio. Playwright
    // sigue corriendo aparte via su propio `playwright.config.ts`.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/e2e/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
