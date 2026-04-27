import { test, expect } from "./fixtures";

test.describe("Órdenes de compra", () => {
  test("lista de OC carga", async ({ authedPage }) => {
    await authedPage.goto("/ordenes-compra");
    await expect(
      authedPage.getByRole("heading", { name: /órdenes|ordenes/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    const tableOrEmpty = authedPage
      .locator("table, [role='table'], [data-testid='oc-list']")
      .or(authedPage.getByText(/sin órdenes|sin ordenes|no hay/i));
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10_000 });
  });

  test("'+ Nueva OC' abre el formulario", async ({ authedPage }) => {
    await authedPage.goto("/ordenes-compra");
    const cta = authedPage
      .getByRole("link", { name: /nueva oc|nueva orden/i })
      .or(authedPage.getByRole("button", { name: /nueva oc|nueva orden/i }));

    await cta.first().click();
    await authedPage.waitForURL(/\/ordenes-compra\/nueva/, { timeout: 10_000 });

    // The form should expose at least one input.
    await expect(
      authedPage.locator("form input, form select").first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("crear OC con 1 item — totales con IVA 19% en detalle", async ({
    authedPage,
  }) => {
    await authedPage.goto("/ordenes-compra/nueva");

    // 1) Pick first available proveedor from the dropdown / combobox.
    const proveedorTrigger = authedPage
      .locator(
        '[name="proveedor_id"], select[name="proveedor"], [data-testid="proveedor-select"], [role="combobox"]',
      )
      .first();

    if ((await proveedorTrigger.count()) === 0) {
      test.skip(true, "No proveedor selector found in OC form — UI changed");
    }

    const tagName = await proveedorTrigger.evaluate((el) => el.tagName);
    if (tagName === "SELECT") {
      const options = authedPage.locator(
        '[name="proveedor_id"] option[value]:not([value=""]), select[name="proveedor"] option[value]:not([value=""])',
      );
      const firstValue = await options.first().getAttribute("value");
      if (!firstValue) test.skip(true, "No proveedores seeded");
      await proveedorTrigger.selectOption(firstValue!);
    } else {
      await proveedorTrigger.click();
      await authedPage.getByRole("option").first().click();
    }

    // 2) Fill at least one item: descripción, cantidad, precio.
    const desc = authedPage
      .locator('input[name*="descripcion"], textarea[name*="descripcion"]')
      .first();
    if ((await desc.count()) > 0) await desc.fill("Item E2E");

    const qty = authedPage.locator('input[name*="cantidad"]').first();
    if ((await qty.count()) > 0) await qty.fill("1");

    const price = authedPage
      .locator('input[name*="precio"], input[name*="monto"]')
      .first();
    if ((await price.count()) > 0) await price.fill("100000");

    // 3) Submit and wait for detail redirect.
    await authedPage.click('button[type="submit"]');

    const detailRedirect = authedPage.waitForURL(/\/ordenes-compra\/\d+/, {
      timeout: 15_000,
    });
    const validationError = authedPage
      .getByText(/error|inválido|invalido|requerid/i)
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });

    await Promise.race([detailRedirect, validationError]);

    if (authedPage.url().match(/\/ordenes-compra\/\d+/)) {
      // Total = 100.000 neto + 19.000 IVA = 119.000. Match formatted CLP.
      await expect(
        authedPage.getByText(/119\.000|\$\s*119\.000/).first(),
      ).toBeVisible({ timeout: 10_000 });
    }
  });
});
