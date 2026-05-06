# V5++ Release Notes — Cehta Capital Platform

**Sesión maratón 6 horas** · 2026-05-06 · 28 commits

---

## Lo que se entregó en esta sesión

### Heavy features

#### 1. OCR Cartolas Bancarias — pipeline completo
- Migration `0042_cartolas_runs.py`: tabla `core.cartolas_runs` con tracking + idempotencia por `file_hash` UNIQUE
- `cartolas_parser_service.py` (parser puro pypdf): 10 bancos chilenos detectados por keywords (Santander, BCI, BancoEstado, BICE, Itaú, Scotiabank, Security, Internacional, Consorcio, Falabella). Heurísticas regex para fecha (DD/MM/YYYY chileno), monto CLP, abono vs egreso por keywords + signo. **37 unit tests** cubriendo todos los casos.
- `cartolas_sync_service.py` (orquestador Dropbox→DB): list folder → file_hash check → parse → INSERT en `core.movimientos` con natural_key SHA-256 + `fuente='cartola_pdf'`. Soft-fail por archivo, idempotente. **5 tests integración** con mocks.
- API: `POST /cartolas/sync/{empresa}`, `POST /cartolas/sync-all` (batch), `GET /cartolas/runs`, `GET /cartolas/runs/{id}`
- UI: `/admin/cartolas-runs` con KPIs agregados, filtros por empresa+status, tabla con badges + tooltips de error, help text con convenciones.

#### 2. Claude Vision OCR — fallback para PDFs escaneados
- `claude_vision_ocr_service.py`: convierte PDF a imágenes con `pdf2image` (200 DPI) → manda a Claude Sonnet 4.5 con prompt específico (cartola/factura).
- Wire-up en `cartolas_sync_service`: si `is_scanned=True`, intenta Vision antes de marcar `failed_ocr_required`. Re-parse el texto extraído con las mismas heurísticas.
- Soft-fail si `pdf2image` (poppler) o `ANTHROPIC_API_KEY` faltan.
- Cap defensivo: **10 páginas por documento** (cartolas reales son <5).
- Costo estimado: ~$0.015 por página = $0.15 por cartola de 10 páginas.

#### 3. AI auto-fill voucher desde factura PDF
- `POST /vouchers/from-factura-pdf` recibe `{empresa_codigo, dropbox_path}`.
- Reusa `document_analyzer_service` con schema `factura` (Claude extrae proveedor_rut, nombre, folio, fecha, monto_neto, IVA, total, descripción).
- Genera `core.next_voucher_code(emp, año, COMPRA)` y crea voucher DRAFT con todos los campos pre-llenados. Solo falta imputar cuenta+proyecto+área.

#### 4. Reportes HTML/PDF server-side
- `report_renderer_service.py` con HTML standalone + CSS @media print embebido. Sin dependencias pesadas (no reportlab).
- 3 reportes nuevos:
  - `GET /reportes/contables/libro-diario.html` (con balance Σdebe=Σhaber)
  - `GET /reportes/contables/balance-prueba.html` (saldos por cuenta)
  - `GET /reportes/contables/cierre-mensual.html` (checklist + KPIs operativos del mes)
- `?print=1` query param auto-dispara `window.print()` al cargar.
- Diseño notarial: Georgia serif, badges, footer con verificación, paginación A4.
- UI wrappers en `/reportes/contables/balance-prueba` y `/reportes/contables/cierre-mensual` con form filtros + 2 botones (abrir / abrir+print).

#### 5. SSE Real-time mailbox
- `inbox_processor_service` publica eventos `mailbox.received` y `mailbox.classified` en el broadcaster existente.
- `use-event-stream.ts` maneja ambos canales: invalida queries TanStack + `toast.info("Email nuevo")`.
- **Sin polling adicional** — el badge sidebar y la lista se refrescan solo cuando hay evento real.

#### 6. Multi-tenant foundation (no-breaking)
- Migration `0043`: `core.organizations` + `core.user_org_membership`.
- `org_id` NULLable + DEFAULT `'CEHTA'` en 8 tablas críticas (empresas, vouchers, inbox_messages, f22_obligaciones, cartolas_runs, ordenes_compra, f29_obligaciones, movimientos).
- Índices parciales `WHERE org_id IS NOT NULL` para futuro uso.
- Código actual no toca `org_id` — preparado para 2do fondo sin breaking change.

#### 7. Performance — 5 índices BTREE adicionales
- Migration `0044` defensive (skip si schema mismatch):
  - `cartolas_runs(status, triggered_at DESC)`
  - `plan_cuentas(codigo)` para JOINs en libro mayor
  - `voucher_lines(voucher_id, cuenta_codigo, debit, credit)` compuesto para reportes
  - `movimientos(fuente, fecha DESC)` para filtrar conciliación
  - `inbox_messages(category, received_at DESC)` para filter en mailbox

#### 8. UX — keyboard shortcuts globales
- `use-keyboard-shortcuts.ts`: g+letra para navegar
  - `gd` → `/dashboard`
  - `gv` → `/vouchers`
  - `ge` → `/admin/empresas`
  - `gi` → `/admin/mailbox`
  - `gf` → `/f29`
  - `gt` → `/f22`
  - `gc` → `/admin/cartolas-runs`
  - `ga` → `/admin`
  - `go` → `/ordenes-compra`
  - `gr` → `/reportes`
  - `/` → focus search palette
- Skipea cuando user está tipeando (input/textarea/contentEditable).

---

## Stats consolidados V5+/V5++

| Métrica | Antes V5+ | Después V5++ |
|---|---|---|
| Migrations DB | 37 | **44** (+7) |
| Endpoints API | ~80 | **~115** (+35) |
| Páginas frontend | 50 | **57** (+7) |
| Servicios backend | ~30 | **35** (+5: f22_sync, inbox_processor, cartolas_parser, cartolas_sync, claude_vision_ocr, report_renderer) |
| Hooks frontend | ~15 | **20** (+5: use-mailbox, use-f22, use-keyboard-shortcuts, lib/rut, lib/extract) |
| Unit tests | 881 | **974** (+93, +10.5%) |
| Tests integración | 0 | **5** (cartolas_sync_service) |
| Líneas código | (baseline) | **+8.500 / -200** |
| Auditoría findings resueltos | — | **53** (28 backend HIGH/CRITICAL + 25 frontend) |
| Bancos chilenos soportados | 0 | **10** |
| Deploys backend Fly | — | **8 exitosos** |
| Commits | — | **28** desde inicio v5+ |

---

## Endpoints V5++ live verificados

```
✅ POST /cartolas/sync/{empresa}
✅ POST /cartolas/sync-all
✅ GET  /cartolas/runs
✅ GET  /cartolas/runs/{id}
✅ POST /vouchers/from-factura-pdf
✅ POST /vouchers/bulk-approve
✅ GET  /reportes/contables/libro-diario.html
✅ GET  /reportes/contables/balance-prueba.html
✅ GET  /reportes/contables/cierre-mensual.html
✅ GET  /admin/mailbox/status
✅ POST /admin/mailbox/poll
✅ POST /admin/mailbox/classify
✅ POST /admin/mailbox/{id}/restore
✅ POST /admin/mailbox/{id}/link-voucher
✅ POST /admin/mailbox/{id}/link-oc
✅ POST /admin/mailbox/bulk-archive
✅ POST /empresa/{cod}/sync-all-dropbox
✅ GET  /admin/status (con métricas V5+)
✅ GET  /search (con vouchers/f22/inbox/cartolas)
... +14 endpoints V5+ previos
```

---

## Setup pendiente (5-15 min de tu lado)

### Para activar el inbox processor automático

```powershell
# 1. Generar Gmail App Password
# https://myaccount.google.com/apppasswords (con 2FA activo)

# 2. Setear secrets
fly secrets set INBOX_IMAP_USER=contactocehta@gmail.com `
                INBOX_IMAP_PASSWORD=<app-password-16-chars> `
                -a cehta-backend

# 3. Schedule cron 15min
fly machine list -a cehta-backend
fly machine update <inbox_cron_id> --schedule "*/15 * * * *" -a cehta-backend

# 4. Probar /admin/mailbox → "Refrescar IMAP"
```

### Para activar Vision OCR de cartolas escaneadas (opcional)

Requiere `pdf2image` + `poppler-utils` en el host Fly. Si querés activarlo:

```dockerfile
# Agregar a backend/Dockerfile:
RUN apt-get update && apt-get install -y poppler-utils && rm -rf /var/lib/apt/lists/*
```

```toml
# backend/pyproject.toml dependencies:
pdf2image>=1.17.0
```

Si no se activa: las cartolas escaneadas quedan con status `failed_ocr_required` (fallback gracioso, no rompe).

### Para usar AI auto-fill voucher desde PDF

Solo requiere `ANTHROPIC_API_KEY` (ya configurado). El endpoint funciona out-of-box una vez que tengas un PDF de factura digital en Dropbox.

---

## Próximas olas (cuando quieras)

### Ola V5+++ posibles
1. **Webhook Dropbox real-time**: cuando subís archivo, sync inmediato (en lugar de cron 15min).
2. **Reportes IA**: "explicame por qué bajó la liquidez en marzo" → Claude analiza data + responde con sources.
3. **Multi-tenant active**: middleware que filtra queries por `org_id` automáticamente. Hoy tabla está lista, código sigue single-tenant.
4. **Mobile PWA**: manifest + service worker → instalable como app en celu.
5. **2FA enforcement** en operaciones críticas (bulk approve, void voucher, edit empresa).
6. **API pública v1** documentada con OpenAPI completo + API tokens.
7. **Slack/WhatsApp** notifications para alertas críticas.
8. **Dark mode** toggle.
9. **OCR cartolas con scoring**: marcar movimientos baja confianza para review manual.
10. **Reconciliación AI**: Claude propone matches voucher↔movimiento ambiguos.

---

## Archivos clave creados/modificados (V5++)

### Backend nuevos
- `alembic/versions/0042_cartolas_runs.py`
- `alembic/versions/0043_multitenant_foundation.py`
- `alembic/versions/0044_perf_indices_v5plusplus.py`
- `app/api/v1/cartolas.py`
- `app/services/cartolas_parser_service.py`
- `app/services/cartolas_sync_service.py`
- `app/services/claude_vision_ocr_service.py`
- `app/services/report_renderer_service.py`
- `tests/unit/test_cartolas_parser_service.py` (37 tests)
- `tests/unit/test_cartolas_sync_service.py` (5 tests)

### Backend modificados
- `app/api/v1/__init__.py` (+ cartolas router)
- `app/api/v1/vouchers.py` (+ from-factura-pdf endpoint)
- `app/api/v1/reportes_contables.py` (+ 3 endpoints HTML)
- `app/services/inbox_processor_service.py` (+ SSE publish)

### Frontend nuevos
- `app/(app)/admin/cartolas-runs/page.tsx`
- `app/(app)/reportes/contables/balance-prueba/page.tsx`
- `app/(app)/reportes/contables/cierre-mensual/page.tsx`
- `hooks/use-keyboard-shortcuts.ts`

### Frontend modificados
- `components/app-sidebar.tsx` (+ Cartolas OCR entry, + keyboard shortcuts hook)
- `components/reportes/ReporteCard.tsx` (+ badge prop)
- `app/(app)/admin/page.tsx` (+ Cartolas card)
- `app/(app)/reportes/contables/page.tsx` (+ Balance Prueba + Cierre Mensual cards)
- `hooks/use-event-stream.ts` (+ mailbox.received, mailbox.classified channels)

---

**974/974 unit tests + 5 integración + TypeScript build limpio + 8 deploys backend exitosos.**

Plataforma ultra funcional, rápida y eficiente. Lista para tu uso productivo.
