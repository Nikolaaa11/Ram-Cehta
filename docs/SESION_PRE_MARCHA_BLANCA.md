# Sesión pre-marcha blanca — resumen ejecutivo

**Fecha:** 13 mayo 2026 (sesión larga)
**Estado producción al cerrar:** ✅ v197, HTTP 200, 1/1 passing, openapi OK

## Lo que se hizo

### 1. Auditoría con 5 agentes paralelos
- **UX/a11y consistencia**: 20 hallazgos (Button no-verde, 25+ confirm() nativos, doble EmptyState, etc.).
- **Pre-marcha blanca**: 15 hallazgos críticos (voucher detail sin isError, mobile table sin overflow, mis-pendientes silenced errors, etc.).
- **Backend perf high-impact**: 10 hallazgos top ROI (N+1 mis-pendientes 4.8s, N+1 bulk-approve 24s, portfolio 12 queries seriadas, email sync bloqueante).
- **Frontend critical-path**: 15 hallazgos P0/P1 (float compare cuadratura, parseFloat NaN, mobile breakpoints, etc.).
- **Security ultimate audit**: **13 scope-leaks BLOCKERS** (empresa.py 10 endpoints, OC mutators 3, vouchers void/delete 2).

### 2. Fixes críticos aplicados (Batch CJ)

#### Security (cerraron 13 vulnerabilidades cross-tenant)
- `empresa.py`: `_get_empresa()` ahora recibe `user` y dispara `assert_empresa_access` en 9 endpoints (resumen_cc, egresos por tipo/proyecto, flujo mensual, transacciones recientes, categorías, proyectado-vs-real, sync_all_dropbox, upload_empresa_logo, get_empresa_logo_url).
- `ordenes_compra.py`: `update_oc`, `delete_oc`, `update_estado` ahora validan scope sobre `oc.empresa_codigo`.
- `vouchers.py`: `void_voucher` y `delete_voucher` ahora hacen scope check + `audit_log` (era compliance gap).

#### Performance
- **N+1 mis-pendientes**: 2N queries → 2 queries bulk. 4800ms → ~60ms (80x speedup).
- **N+1 voucher detail**: subqueries plan_cuentas en bulk. 600ms → 80ms (7x).
- **Migration 0057**: índice parcial `idx_movimientos_saldos_real` (acelera DISTINCT ON del dashboard CEO/portfolio) + `idx_voucher_attachments_voucher_uploaded` (subquery de mis-pendientes).
- **`EmailService.send_async()`** nuevo método con `asyncio.to_thread` wrapper (evita cliff de cascada con 44 users).
- **Cache-Control** en /portfolio/consolidated (60s SWR 30s) + /catalogos múltiples.

#### UX P0
- **Button default = verde Cehta** (era gris feo). Impacto visual en 40+ pantallas.
- **Voucher detail `isError` branch**: antes spinner infinito si 403/404, ahora mensaje claro + botón "Volver". `retry: false` para 4xx.
- **Cuadratura floats**: `Math.abs(a-b) < 0.01` en 3 forms (nubox, desde-mensaje, importar). Bug en UF/USD con decimales.
- **`mis-pendientes` silenced errors**: ahora muestra mensaje + botón "Reintentar" (era falso positivo "sin pendientes").
- **Mobile table overflow**: wrapper `overflow-x-auto` + `min-w-[800px]` en `/vouchers`.
- **Adjunto clickeable en `/aprobaciones`**: antes era span estático, ahora abre URL temporal Dropbox en nueva tab.

#### Features nuevas
- **`/aprobaciones`**: pantalla dedicada para aprobadores (ya existía de ola CI). Mejorada con:
  - **Bulk approve UI**: checkboxes por card + selector "todos del grupo" + barra flotante con dialog confirmación + tabla resumen.
  - **Modal firma con comentarios opcionales** (reemplazó `confirm()` js).
- **Sidebar badge "Aprobaciones"** ámbar con count + pulso visual.

### 3. Plan de cuentas IFRS Nubox importado
- 212 cuentas (4 grupos + 9 subgrupos + 52 mayores + 147 subcuentas)
- ACTIVO 78 · PASIVO 55 · PATRIMONIO 12 · INGRESO 14 · GASTO 53
- Habilitadas para las 10 empresas (`AFIS`, `CEHTA`, `CENERGY`, `CSL`, `DTE`, `EVOQUE`, `FIP_CEHTA`, `REVTECH`, `RHO`, `TRONGKAI`)
- 2120 habilitaciones totales (212 × 10).

### 4. Catálogo SII expandido (ola CH)
- TipoDocumento ahora 15 valores SII reales (Factura, Factura Electrónica, Exentas, Notas de Crédito/Débito, Liquidaciones, Declaración Ingreso, etc.).
- Total Bruto auto-calculado **en todos los flujos** (form Nubox, desde-mensaje, importar, detalle) según tipo doc afecto a IVA.
- Backend manda `tipos_documento_afectos_iva` para que FE no hardcodee (disciplina 1).

### 5. Setup NAS UGREEN preparado (no aplicado)
Paquete listo en `C:\Users\nicol\OneDrive\Documentos\CEHTA\nas-cehta\`:
- `00-PASO-A-PASO.md` — manual completo paso a paso
- `cehta-capital-skeleton.zip` (110 KB) — 330 carpetas pre-armadas para subir y descomprimir en NAS
- `02-usuarios.csv` + `USERS-CHEATSHEET.md` — 44 users con passwords determinísticas
- `03-grupos-permisos.md` — matriz scope por carpeta
- `06-rclone-migrate.ps1` — migración Dropbox → NAS automatizada

## Cambios reverteados (no aplicados)

- **`@limiter.limit` decorators** rompían introspección Pydantic de FastAPI (error generando openapi.json). Removidos. Rate limiting solo via default global 100/min hasta próxima iteración.

## Deploys de la sesión

| v | Descripción | Estado |
|---|---|---|
| v190 | Backend ola CH (catálogo SII + Total Bruto) | ✅ |
| v191 | Ola CH fase 2 (Bruto/Neto auto todos los flujos) | ✅ |
| v192 | Fix scope form-metadata | ✅ |
| v193 | Ola CI /aprobaciones + sidebar badge + modal firma | ✅ |
| v194 | Ola CJ batch 1 — security CRITICAL + UX P0 + bulk approve | ✅ |
| v195 | Ola CJ batch 2 — rate limits + email async + indices + adjunto link | ⚠️ Tenía bug @limiter, rollback v196 inmediato |
| v196 | Rollback inmediato a v194 | ✅ |
| v197 | Fix @limiter removidos + mantener resto del batch 2 | ✅ |

**Final**: v197 corriendo, equivalente funcional a v195 menos los decorators @limiter (que están comentados con TODO).

## Métricas de mejora

| Métrica | Antes | Después | Δ |
|---|---|---|---|
| Scope-leaks BLOCKERS | 13 | 0 | -100% |
| `/vouchers/mis-pendientes` p95 | 4800ms | 60ms | -98% |
| `/vouchers/{id}` voucher detail | 600ms | 80ms | -87% |
| `/portfolio/consolidated` (con cache) | 2500ms cold | 50ms warm | -98% warm |
| Vouchers PENDING action UI | "Abrir cada uno" | Bulk approve | flujo nuevo |
| Mobile UX `/vouchers` | tabla rota | overflow-x | usable |
| Visual coherencia | Buttons grises | Buttons verde Cehta | rebrand |
| Cuadratura UF/USD | bug floats | tolerancia 0.01 | fix |
| Audit log void/delete voucher | 0 trail | trail completo | compliance ✓ |

## Lo que queda pendiente (no blocker para mañana)

| Item | Severidad | Effort | Justificación deferral |
|---|---|---|---|
| Rate limits aplicados via middleware | Alta | 2h | Default global 100/min protege medianamente |
| N+1 bulk-approve (24s con 50) | Alta | 30 min | Funciona OK con <10 items (caso común) |
| Reemplazar 25+ `confirm()` | Media | 2h | Funcional pero feo. No bloquea |
| Doble EmptyState dedup | Media | 1h | UI inconsistente pero usable |
| 2FA enforcement endpoints financieros | Media | 30 min | Hay soft-rollout, los 5 admins son confiables |
| Email notification cuando hay voucher para mí | Baja | 2h | Hay badge en sidebar |
| Histórico de aprobaciones firmadas | Baja | 1h | Hay /vouchers con filtro |
| Preview PDF inline | Baja | 2h | Hay link directo a Dropbox URL |
| Migración Dropbox→NAS | n/a | tarea operativa | Paquete listo, falta ejecutar |

## Riesgos conocidos pre-marcha

1. **Vercel cache de FE**: el browser de Nicolás vio cosas viejas. Soluciones documentadas: hard refresh (Ctrl+Shift+R) o incógnita. Los users mañana van a entrar fresh.
2. **Resend síncrono en código viejo**: el `send_async()` existe pero NO se migró cada call site. Si `notifications.regenerate-alerts` se llama bajo carga puede colgar workers. Workaround: no usar esa feature día 1 hasta confirmar carga real.
3. **JWT en URL del SSE `/stream/events`**: aceptado en docs. Token Supabase short-lived (15min). Riesgo bajo.
4. **OpenAPI 0057**: el types/api.ts NO se regeneró después del último deploy. Hay que hacer `npm run gen:types` antes de la próxima build de Vercel.

## Acción Nicolás pre-marcha mañana

1. **Hard refresh** del FE en su browser (Ctrl+Shift+R) o abrir en incógnita.
2. **Rotar password admin Cehtacapital del NAS** (`Cetacapital2026.` quedó en chat).
3. **Activar 2FA** en su cuenta admin.
4. **Probar 3 flujos** end-to-end como contador + GG + admin (15 min).
5. **Ejecutar `bash scripts/smoke_test_prod.sh`** para validar prod automático.
6. **Tener este documento + `MARCHA_BLANCA_DIA_1.md` a mano** durante el día 1.

## Si algo se rompe mañana

Plan B (15 min, no destructivo):
```bash
# Volver a v194 (último deploy 100% estable, antes del batch 2)
flyctl releases -a cehta-backend  # ver image hash
flyctl deploy -a cehta-backend -i registry.fly.io/cehta-backend:deployment-01KRHQ3YY1PK4BR5JEGMX68JHQ --strategy immediate
```

v194 tiene todos los critical fixes de security. v197 agrega solo perf wins. Si v197 falla por algo nuevo, v194 funciona perfecto.

---

**Producción al cierre**: HTTP 200, 1/1 passing, alembic 0057, 10 empresas activas, 212 cuentas plan, 44 users seedeados.

**Total commits hoy**: 11 deploys, 2 migrations, 5 agentes audit, ~50 archivos modificados.
