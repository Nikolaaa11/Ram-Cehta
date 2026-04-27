# E2E Tests — Cehta Capital frontend

Smoke tests for happy paths across the OC / Pagos platform. Built with
[Playwright](https://playwright.dev/).

## What is covered

| File                          | Scope                                                 |
| ----------------------------- | ----------------------------------------------------- |
| `01-login.spec.ts`            | Auth redirect, invalid creds, successful login        |
| `02-dashboard.spec.ts`        | Dashboard heading, KPIs, ETL badge, logout, filtros   |
| `03-proveedores.spec.ts`      | List load, create flow, RUT duplicado, detail view    |
| `04-ordenes-compra.spec.ts`   | List load, create flow, IVA 19% en total              |

Authentication is provided by the `authedPage` fixture in
`e2e/fixtures.ts`. It performs a real Supabase email/password login.

## Setup local

1. Backend running on `http://localhost:8000` with seed data.
2. Frontend can be left **off** — `playwright.config.ts` will launch
   `npm run dev` automatically and reuse an already-running server if any.
3. Create a test user in Supabase Dashboard → Authentication. Then assign
   role `admin` in the `core.user_roles` table.
4. Set env vars (in `.env.local` or your shell):

   ```bash
   E2E_EMAIL=test@cehta.cl
   E2E_PASSWORD=...
   ```

5. First run only — install browser binaries:

   ```bash
   npx playwright install chromium
   ```

6. Run the suite:

   ```bash
   npm run e2e
   ```

When `E2E_EMAIL` / `E2E_PASSWORD` are missing, authenticated tests are
**skipped** (not failed) so the suite still passes on dev machines without
credentials.

## Setup CI

The job `.github/workflows/e2e-ci.yml` runs against the Vercel preview URL
on every PR. Configure these GitHub Actions secrets:

- `E2E_EMAIL`
- `E2E_PASSWORD`
- `E2E_BASE_URL` — preview deployment URL (or use a static staging URL)

PRs from forks (where secrets aren't exposed) are skipped automatically.

## Selector strategy

Where possible we use **semantic** selectors (`getByRole`, `getByText`)
over fragile CSS. Forms still rely on `name=`/`id=` attributes from the
existing pages.

> **TODO** — once the apple-style refactor lands across `proveedores`,
> `ordenes-compra`, `solicitudes-pago`, `movimientos`, `f29`, follow up
> with two follow-up changes:
>
> 1. Add `data-testid` attributes to KPI cards, table rows, action
>    buttons, and form fields. Tests will start preferring them
>    automatically thanks to the `or()` fallbacks.
> 2. Replace the remaining `alert(...)` calls in the pages with
>    `toast.error(...)` from `@/components/ui/toast`. Currently confirmed:
>    - `app/(app)/solicitudes-pago/page.tsx:45` —
>      `alert(\`Error al actualizar la OC: ${...}\`)` → `toast.error(...)`.
>    - Re-run `grep -rn "alert(" app/` after the refactor lands to catch
>      any new ones.

## Anti-flakiness rules

- Always `await expect(...).toBeVisible({ timeout })` — never `setTimeout`.
- Use `page.waitForURL(...)` for navigation, not arbitrary delays.
- Generate unique RUTs / names with `Date.now()` to avoid duplicate-row
  failures when re-running locally.
