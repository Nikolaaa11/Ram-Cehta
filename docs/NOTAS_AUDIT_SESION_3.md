# Auditoría continua — Sesión 3 cont. (ola CG-audit)

**Fecha:** 13 de mayo 2026, segunda mitad de la sesión 3.
**Foco:** auditoría amplia y aplicación de fixes con agentes en paralelo.

## TL;DR — qué cambió

Lancé 5 agentes auditando en paralelo (backend perf, frontend perf, security, las 5 disciplinas, dead code). Cada uno produjo entre 9 y 32 hallazgos clasificados por severidad. Apliqué **todos los críticos y los altos** que eran cambios localizados y de bajo riesgo. Producción se mantiene **HTTP 200, 1/1 passing** después de 3 deploys consecutivos (v187 → v188 → v189). Cero outages.

---

## Fixes de seguridad (críticos + altos) — 10 endpoints corregidos

Estos eran bugs de **scope multi-tenant** que permitían cross-tenant leak. La regla V5++ ola CB exige que cualquier query por empresa pase por `assert_empresa_access` o `scope.filter_codes`. Los olas recientes (CD-CG) introdujeron endpoints sin replicar el patrón.

| Endpoint | Severidad | Fix |
|---|---|---|
| `GET /plan-cuentas` (con `?empresa_codigo=`) | Crítico | scope check al filtrar |
| `GET /plan-cuentas/tree` (con `?empresa_codigo=`) | Crítico | scope check |
| `PATCH /plan-cuentas/{codigo}/empresas/{empresa_codigo}` | Crítico | scope check antes del UPSERT |
| `POST /admin/reset/movimientos/{empresa_codigo}` | Crítico | `require_scope("legal:delete")` admin-only |
| `POST /admin/reset/cartolas-runs/{empresa_codigo}` | Crítico | `require_scope("legal:delete")` admin-only |
| `GET /compliance-grade/{empresa_codigo}` | Crítico | scope check (import existía sin usar — dead code revelador) |
| `GET /proyectos-contables` | Alto | scope filtering por empresa |
| `GET/POST/PATCH/DELETE /proyectos-contables/{codigo}` | Alto | scope check leyendo `empresa_codigo` del row |
| `GET /areas` (con `?empresa_codigo=`) | Alto | scope check |
| `PATCH /areas/{codigo}/empresas/{empresa_codigo}` | Alto | scope check |
| `GET/POST/etc /admin/nubox/export-batches/*` | Alto | scope filtering + check por batch.empresa_codigo |

**Verificado limpio**: SQL injection (todos los `text(f"...")` interpolan strings controlados por el server), bcrypt (cero), secrets commiteados (cero), CORS (`allow_origins=settings.cors_origins`, no `*`), endpoints públicos `by-token/*` (estrictos en token + GET/POST específicos).

**Pendiente medio** (no crítico): JWT pasado por query `?token=` en `/stream/events` (SSE). Riesgo de log leakage en Cloudflare/Vercel proxies. Fix futuro: emitir token efímero solo-SSE en vez del JWT principal.

---

## Wins de performance

| Cambio | Impacto |
|---|---|
| **N+1 en `GET /vouchers/{id}` resuelto** | 5–15 queries de `SELECT nombre FROM plan_cuentas` colapsadas en 1 `WHERE codigo = ANY(...)`. Sobre Supabase Ohio (RTT ~80ms) eso baja el detalle de voucher de ~600ms a ~80ms (-86%). |
| **`Cache-Control: 5min stale-while-revalidate=60s`** agregado en `/plan-cuentas`, `/plan-cuentas/tree`, `/areas`, `/proyectos-contables`. | Catálogos cuasi-estáticos. El FE reutiliza el response sin pegar al backend en navegación normal. |
| **`Cache-Control: 60s SWR 30s`** en `GET /portfolio/consolidated`. | El CEO dashboard ya no repega su query de ~2.5s al refrescar. SWR muestra UI instantánea mientras revalida. |
| **`useCatalogoEmpresas` staleTime 30 min** (era 2 min default). | Reduce queries cross-page del FE cuando navegás entre pantallas que muestran selectores de empresa. |
| **`OrdenCompraCreate.neto` ahora opcional** (computado en backend de los items) | Disciplina 2: el FE deja de calcular y enviar el neto. El backend es single source of truth. |

**Pendiente alta prioridad** (no aplicado, requiere tests E2E primero):
- N+1 más grande detectado: `GET /portfolio/consolidated` corre 12 queries serializadas para el monthly trend. Refactor con `generate_series + LATERAL JOIN` → 1 query. ROI: ~2s p95 de mejora. Lo dejé documentado porque romperlo afecta al CEO dashboard.
- `avance.py:114` (list_proyectos) N+1 con `hito_repo.list_for_proyecto` por proyecto.
- `vouchers_nubox_form.py:249` itera 9 empresas con query por iteración.
- `cartolas.py /sync-all` corre 9 empresas serial con OCR inline (riesgo OOM en Fly 1GB).

---

## Disciplinas inquebrantables — hallazgos pendientes (NO aplicados aún)

Los más críticos según el audit:

1. **`PortafolioReportView.tsx` y `FondoReportView.tsx`** suman totales en FE (`.reduce()` sobre saldos contables). Son reportes oficiales del FIP — el backend debería devolver `totales` pre-calculados.
2. **`VouchersClientView.tsx:337`** computa KPIs (draft/pending/approved/totalAmount) en FE. Fix: endpoint `/vouchers/stats`.
3. **`reportes/contables/libro-diario/page.tsx:48`** suma `totalDebe`/`totalHaber` en FE. Fix: backend devuelve `total_debe`, `total_haber`, `cuadrado: bool`.
4. **`hooks/use-my-empresas.ts:95`**: `const ADMIN_EMPRESAS = new Set(["AFIS", "FIP_CEHTA", "CENERGY"])` hardcoded. Fix: backend marca `is_admin_entity: bool` en `EmpresaRead`.
5. **`admin/proyectos-contables/page.tsx:629`**: mapping de códigos de empresa hardcoded (`REVTECH→RVT`, etc.) que se persiste. Fix: endpoint `/proyectos-contables/preview-codigo`.
6. **`admin/layout.tsx:32`**: gate completo del módulo admin por `app_role`. Fix: backend exponer `allowed_actions.includes("admin:access")`.

Esos quedan pendientes porque requieren cambios coordinados FE+BE (no son 1-liners).

---

## Dead code & sync

- ✅ **OpenAPI ↔ types/api.ts**: regenerado con `npm run gen:types`. Los 6 endpoints de la sesión 3 (extract-from-upload/text, logo upload/url, /{id}.html, DELETE OC) ya están en `types/api.ts`.
- **Componentes huérfanos FE detectados** (no borrados por precaución): `components/dashboard/ChartsPlaceholder.tsx` + 5 archivos en `components/portafolio/` que parecen WIP de V4 fase 4. Si confirmás que están abandonados los borramos.
- **Imports unused detectados** en backend: `bitacora.py` (4 imports), `entregables.py` (1 import → reveló el bug crítico), `ordenes_compra_extract.py`, `vouchers_extract.py`, `reset_data.py`, `reportes_contables.py`. Cleanup pendiente (no funcional, solo lint).
- **Endpoints sin caller en FE**: 8 detectados (`audit/integrity`, `notifications/test`, `inbox/generate-alerts`, `lp-contratos/{id}/resolver`, `currency/refresh`, `webhooks/test`, `reset-data/*`). Mayoría son admin/cron tools — documentar o limpiar.

---

## Sumario de commits de la sesión 3 segunda mitad

| Commit | Descripción |
|---|---|
| `8e9ac97` | chore: regenerar openapi.json + types TS |
| `1359ba9` | chore(audit): batch fixes ola CG-audit (security + perf + disciplina) |
| `3206d22` | perf(backend): voucher detail N+1 + portfolio Cache-Control 60s |
| `e8b0d72` | fix(entregables): scope check faltante en compliance-grade/{empresa} |

**Producción**: v189 corriendo, health 200, 1 total / 1 passing.

---

## Recomendaciones para la próxima sesión

1. **Aplicar las disciplinas 1 y 2 pendientes** (totales en backend para PortafolioReport + FondoReport + KPIs vouchers + libro-diario). Requiere nuevos endpoints `/stats` y adaptar los FE.
2. **N+1 portfolio monthly_trend** con LATERAL JOIN — ROI 2s p95 pero necesita tests E2E.
3. **Backgroundize endpoints pesados**: `cartolas/sync-all`, `avance/sync-all`, `vouchers/extract-from-upload`, `mailbox/classify`. Mover a job runner con `POST 202` + `GET /jobs/{id}`.
4. **RSC migration** de pages admin "tipo CRUD" (plan-cuentas, proyectos-contables, policies-fondo, approval-rules) — bundle JS -30%.
5. **`dynamic()` para charts** en `/ceo`, `/portafolio`, `/empresa/[codigo]` — -95KB gzip del bundle compartido.
6. **`legal:delete` scope** asignado solo a admin actual. Si querés que finance también pueda hacer reset, agregamos un scope `data:reset` separado en `rbac.py`.
