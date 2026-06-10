# Auditoría Ram-Cehta — 2026-06-10 (R152JJJJJJ)

Suite completa de PROMPTS_MAESTROS.md: debug-continuo (7 capas) +
auditor-plataforma (6 agentes paralelos + verificación adversarial) +
performance-scan + qa-produccion + ux-gerentes (code-level).

## Resumen ejecutivo

**1 crítico-bloqueante encontrado y arreglado** (build frontend roto),
**9 hallazgos reales arreglados** en la misma sesión, **6 falsos positivos
descartados** por verificación adversarial, **4 ítems a backlog**.

## 🔴 Críticos — ARREGLADOS hoy

| # | Archivo | Problema | Fix |
|---|---|---|---|
| 1 | `frontend/app/(app)/rrhh/page.tsx:359` | **Build Vercel ROTO**: comentario `{/* */}` en posición de expresión JSX (introducido en R152GGGGGG). El próximo deploy de Vercel habría fallado. | Comentario JS plano. Build verde (TSC 0 / BUILD 0). |
| 2 | `backend/app/api/v1/flujos_caja_proyecto.py` | **Leak multi-tenant**: GET/PUT/POST/DELETE de flujos de caja proyectados sin validar acceso a la empresa del proyecto — cualquier usuario autenticado podía leer Y escribir proyecciones financieras de las 9 empresas. | `_check_proyecto_exists` ahora valida `get_allowed_empresa_codes` en los 4 endpoints. |
| 3 | `backend/app/api/v1/vouchers.py:2908` | **Race en reject_voucher**: sin FOR UPDATE (approve sí lo tenía). 2 rechazos simultáneos = doble approval + doble webhook. | SELECT FOR UPDATE antes del get (mismo patrón que approve). |
| 4 | `backend/app/services/nubox_api_mapper.py:144` | **IVA con `round()` float**: banker's rounding (150×19% = 28 en vez de 29). Afecta emisión DTE vía Nubox API. | Decimal × Decimal + quantize ROUND_HALF_UP. Test verificado. |

## 🟡 Medios — ARREGLADOS hoy

| # | Archivo | Problema | Fix |
|---|---|---|---|
| 5 | `ordenes_compra.py` bulk_update_estado | Sin FOR UPDATE por OC en el loop (el PATCH single sí tenía). | Lock por OC en el loop. |
| 6 | `areas.py` empresas-matrix | Devolvía la matriz organizacional completa de las 9 empresas a cualquier usuario. | Filtrado por scope (admin ve todo). |
| 7 | `corfo_rendiciones.py:182-187` | Acumulación de montos en float. | Decimal en acumuladores. |
| 8 | `rrhh.py`, `empresa.py`, `empresa_oc_branding.py` | `str(exc)` crudo al frontend (constraints DB, errores Dropbox). | Mensajes genéricos accionables + detalle al log. |
| 9 | `oc_cuotas.py:164` | Última cuota podía quedar ≤ 0 con totales chicos. | Guard con error claro. |
| 10 | `components/fondos/FondoTable.tsx` | Tabla desbordaba en mobile 390px. | Wrapper overflow-x-auto. |

## ✅ Falsos positivos descartados (verificación adversarial)

- `proveedores.py` ×4 "leaks": `core.proveedores` NO tiene columna empresa —
  es **catálogo global por diseño** (verificado en information_schema).
- `oc_cuotas` residuo "crítico": la suma SIEMPRE = total exacto (solo faltaba
  el guard de cuota ≤ 0, agregado).
- `DropboxNotConfigured` con `str(exc)`: excepción nuestra con mensaje
  controlado — seguro.
- `admin_data.py` "N+1": es dict-lookup fuera del loop, no N+1.

## 📋 A backlog (no urgente)

1. `approval_rules.py` GETs (91, 119, 264) sin `require_scope` — lectura de
   config visible a cualquier autenticado. Decidir scope de lectura.
2. `ordenes_compra_extract.py:198` — neto inverso (÷1.19) sin validar si el
   doc es exento. Es flujo de sugerencia IA (el usuario revisa), bajo riesgo.
3. `components/shared/edit-button.tsx` size sm h-7 (28px) < 44px touch
   target — subir a h-9 requiere revisar layouts de tablas.
4. `nubox_export_service.py:314` — UPDATE a SYNCED sin WHERE de estado
   anterior (flujo solo-admin, bajo riesgo).

## Estado de producción al momento de la auditoría

- Backend Fly: health 200 en 0.6s, 431 paths OpenAPI ✅
- Frontend Vercel: ambos alias responden (307 → login, esperado) ✅
- DB: 0 incidentes abiertos, pool 8/15 conexiones, 77 vouchers reales
  (60 DRAFT / 14 PENDING / 1 APPROVED / 1 EXECUTED / 1 VOID) ✅
- Crons Fly: auto_sync_runs vacío → **schedules NO configurados aún**
  (pendiente #5 de marcha blanca) ⚙️
- email_outbox: vacío (sin actividad) · sii_sync: inerte (esperado) ⚙️

## Limpias (6 agentes, sin hallazgos adicionales)

Seguridad: sin secrets hardcodeados, sin PII en logs, auth completa.
Performance: sin N+1 reales, paginación OK, sin APIs externas en
transacción. Frontend: manejo de errores con toast, doble-submit protegido,
estados vacíos con mensaje, labels en español.

## Validación final

- AST: 268 archivos backend + 10 editados ✅
- Import: 523 rutas / 431 paths (baseline exacto) ✅
- Frontend: TSC 0 + BUILD 0 ✅
- Test IVA half-up: 150×19% = 29 ✅
