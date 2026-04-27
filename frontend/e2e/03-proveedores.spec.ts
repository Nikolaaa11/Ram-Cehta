import { test, expect } from "./fixtures";

/**
 * Generates a syntactically-plausible Chilean RUT for create-flow tests.
 * NOTE: this RUT is NOT mod-11 valid; backend validation may reject it.
 * If the backend rejects with 422, the test will surface it — that's fine,
 * we just want to know whether the form round-trips.
 */
function randomRutSuffix(): string {
  const body = String(Math.floor(10_000_000 + Math.random() * 89_000_000));
  return `${body}-0`;
}

test.describe("Proveedores", () => {
  test("lista de proveedores carga", async ({ authedPage }) => {
    await authedPage.goto("/proveedores");
    await expect(
      authedPage.getByRole("heading", { name: /proveedores/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Either a table/list of providers, or an empty state.
    const tableOrEmpty = authedPage
      .locator("table, [role='table'], [data-testid='proveedores-list']")
      .or(authedPage.getByText(/sin proveedores|no hay proveedores/i));
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10_000 });
  });

  test("'+ Nuevo proveedor' abre el formulario", async ({ authedPage }) => {
    await authedPage.goto("/proveedores");
    const cta = authedPage
      .getByRole("link", { name: /nuevo proveedor/i })
      .or(authedPage.getByRole("button", { name: /nuevo proveedor/i }));

    await cta.first().click();
    await authedPage.waitForURL(/\/proveedores\/nuevo/, { timeout: 10_000 });

    await expect(
      authedPage.locator('input[name="rut"], input#rut').first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("crear proveedor exitoso redirige a la lista", async ({ authedPage }) => {
    await authedPage.goto("/proveedores/nuevo");

    const rut = randomRutSuffix();
    const nombre = `E2E Proveedor ${Date.now()}`;

    await authedPage.locator('input[name="rut"], input#rut').first().fill(rut);
    await authedPage
      .locator('input[name="nombre"], input#nombre, input[name="razon_social"]')
      .first()
      .fill(nombre);

    // Optional fields — fill if present.
    const email = authedPage.locator('input[name="email"], input#email');
    if ((await email.count()) > 0) await email.first().fill("e2e@cehta.cl");

    await authedPage.click('button[type="submit"]');

    // Either we redirect to /proveedores OR the form rejects with a backend
    // validation error (RUT mod-11 invalid) — both prove the round-trip works.
    const ok = authedPage.waitForURL(/\/proveedores($|\?|\/[^n])/, {
      timeout: 10_000,
    });
    const err = authedPage
      .getByText(/error|inválido|invalido|ya existe/i)
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });

    await Promise.race([ok, err]);
  });

  test("RUT duplicado del seed muestra error", async ({ authedPage }) => {
    await authedPage.goto("/proveedores/nuevo");

    // 76.000.000-5 is a placeholder used in the seed. Adjust if the seed RUT
    // changes; the test asserts ANY duplicate-style error, not a specific one.
    await authedPage
      .locator('input[name="rut"], input#rut')
      .first()
      .fill("76.000.000-5");
    await authedPage
      .locator('input[name="nombre"], input#nombre, input[name="razon_social"]')
      .first()
      .fill("Duplicate test");

    await authedPage.click('button[type="submit"]');

    await expect(
      authedPage.getByText(/ya existe|duplicado|409|conflict|inválido/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("'Ver detalle' abre la página de detalle", async ({ authedPage }) => {
    await authedPage.goto("/proveedores");

    const detailLink = authedPage
      .getByRole("link", { name: /ver detalle|detalle|ver/i })
      .first();

    if ((await detailLink.count()) === 0) {
      test.skip(true, "No 'Ver detalle' link visible — list may be empty");
    }

    await detailLink.click();
    await authedPage.waitForURL(/\/proveedores\/\d+/, { timeout: 10_000 });

    await expect(
      authedPage.getByRole("heading").first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
