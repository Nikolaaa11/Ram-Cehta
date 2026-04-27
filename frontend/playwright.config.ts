import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Cehta Capital frontend E2E tests.
 *
 * Tests live in `./e2e`. Run with `npm run e2e`. CI runs against the Vercel
 * preview deployment URL via `E2E_BASE_URL`; locally we spin up `next dev`.
 *
 * Auth fixtures expect `E2E_EMAIL` and `E2E_PASSWORD` env vars — tests that
 * require authentication skip cleanly when these are absent.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30 * 1000,
  expect: { timeout: 5 * 1000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
});
