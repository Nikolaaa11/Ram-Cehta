import { test as base, expect, type Page } from "@playwright/test";

export { expect };

/**
 * Auth fixture: an `authedPage` that has performed Supabase email/password
 * login and landed on `/dashboard`.
 *
 * Requires `E2E_EMAIL` and `E2E_PASSWORD` env vars. When either is missing the
 * test is skipped (instead of failing) so the suite stays green on machines
 * without test credentials configured.
 */
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;

    test.skip(
      !email || !password,
      "E2E_EMAIL / E2E_PASSWORD env vars not set — skipping authenticated test",
    );

    await page.goto("/login");

    // Login form uses id-based selectors (id="email", id="password"). We try
    // name-based first (in case of refactor) then fall back to id.
    const emailInput = page.locator(
      'input[name="email"], input#email, input[type="email"]',
    );
    const passwordInput = page.locator(
      'input[name="password"], input#password, input[type="password"]',
    );

    await emailInput.first().fill(email!);
    await passwordInput.first().fill(password!);
    await page.click('button[type="submit"]');

    // On success the login page redirects to /dashboard.
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    await use(page);
  },
});
