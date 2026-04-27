import { test, expect } from "./fixtures";

test.describe("Dashboard", () => {
  test("header muestra el title 'Dashboard'", async ({ authedPage }) => {
    await expect(
      authedPage.getByRole("heading", { name: /dashboard/i }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("muestra los 4 hero KPIs cards", async ({ authedPage }) => {
    // KPI cards live in the dashboard hero row. We accept either a
    // `data-testid` (preferred, future-friendly) or fall back to a
    // semantic check on the kpi-lg typography class injected by the
    // tailwind config.
    const kpiByTestId = authedPage.locator('[data-testid="kpi-card"]');
    const kpiByClass = authedPage.locator(".text-kpi-lg, .text-kpi-sm");

    const found = (await kpiByTestId.count()) > 0 ? kpiByTestId : kpiByClass;

    await expect(found.first()).toBeVisible({ timeout: 10_000 });
    expect(await found.count()).toBeGreaterThanOrEqual(4);
  });

  test("muestra ETL status badge", async ({ authedPage }) => {
    // ETL badge surfaces a dot or label like "ETL OK" / "ETL retraso".
    const badge = authedPage.getByText(/etl/i).first();
    await expect(badge).toBeVisible({ timeout: 10_000 });
  });

  test("logout button redirige a /login", async ({ authedPage }) => {
    const logout = authedPage
      .getByRole("button", { name: /cerrar sesión|logout|salir/i })
      .or(authedPage.getByRole("link", { name: /cerrar sesión|logout|salir/i }));

    await logout.first().click();
    await authedPage.waitForURL(/\/login(\?|$)/, { timeout: 10_000 });
    expect(authedPage.url()).toContain("/login");
  });

  test("filtro empresa cambia URL con ?empresa=", async ({ authedPage }) => {
    const empresaSelector = authedPage
      .locator('select[name="empresa"], [data-testid="empresa-filter"]')
      .first();

    if ((await empresaSelector.count()) === 0) {
      test.skip(true, "Empresa filter not found on dashboard — UI may not expose it yet");
    }

    // Try selecting any non-empty option.
    const tagName = await empresaSelector.evaluate((el) => el.tagName);
    if (tagName === "SELECT") {
      const options = await empresaSelector.locator("option").all();
      const target = options.find(async (o) => {
        const v = await o.getAttribute("value");
        return v && v.length > 0;
      });
      if (target) {
        const value = await target.getAttribute("value");
        await empresaSelector.selectOption(value!);
      }
    } else {
      await empresaSelector.click();
      await authedPage.getByRole("option").first().click();
    }

    await expect(authedPage).toHaveURL(/[?&]empresa=/, { timeout: 5_000 });
  });
});
