import { test, expect } from "./fixtures";

test.describe("Login flow", () => {
  test("redirige a /login si no hay sesión", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/login(\?|$)/, { timeout: 10_000 });
    expect(page.url()).toContain("/login");
  });

  test("muestra error con credenciales inválidas", async ({ page }) => {
    await page.goto("/login");

    const emailInput = page.locator(
      'input[name="email"], input#email, input[type="email"]',
    );
    const passwordInput = page.locator(
      'input[name="password"], input#password, input[type="password"]',
    );

    await emailInput.first().fill("nope@cehta.cl");
    await passwordInput.first().fill("wrong-password-xyz");
    await page.click('button[type="submit"]');

    // The login page surfaces a localized error string.
    await expect(page.getByText(/credenciales incorrectas/i)).toBeVisible({
      timeout: 10_000,
    });
    expect(page.url()).toContain("/login");
  });

  test("login exitoso redirige a /dashboard", async ({ authedPage }) => {
    expect(authedPage.url()).toContain("/dashboard");
    await expect(
      authedPage.getByRole("heading", { name: /dashboard/i }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
