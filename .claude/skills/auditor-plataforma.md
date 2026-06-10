---
name: auditor-plataforma
description: Auditoría completa de Ram-Cehta con agentes en paralelo — 8 dimensiones (seguridad, multi-tenant, contable, race conditions, performance, frontend, integraciones, datos). Cada hallazgo se verifica antes de reportar. Correr semanalmente o antes de hitos (marcha blanca, cierre mensual).
---

# Skill: Auditor de Plataforma (multi-agente)

Auditoría exhaustiva usando **agentes en paralelo** — uno por dimensión.
Cada agente reporta hallazgos con archivo:línea + severidad. Después un
paso de **verificación adversarial**: cada hallazgo crítico se re-verifica
leyendo el código real antes de reportarlo (mata falsos positivos).

## Regla de oro

Los hallazgos se contrastan contra `docs/SUPER_PROMPT_MAESTRO.md`
(22 invariantes). Un hallazgo que viola un invariante es automáticamente
🔴 CRÍTICO.

## Las 8 dimensiones (lanzar agentes en paralelo)

### Agente 1 — Seguridad
- Endpoints sin auth (`CurrentUser` faltante), admin-only sin `_require_admin`
- Secrets hardcodeados, credenciales en logs, error messages que filtran internals
- `nrietta@cehtacapital.com` NUNCA debe poder ser password-reset por otro flujo
- API tokens: expiración, revocación, scopes

### Agente 2 — Multi-tenant
- Cada endpoint no-admin debe filtrar por `get_allowed_empresa_codes` /
  `EmpresaScopeDep` / `assert_empresa_access`
- Buscar queries `SELECT ... FROM vouchers/ordenes_compra/empleados` sin
  filtro de empresa en el WHERE
- Exports, búsquedas, dashboards y PDFs son los lugares donde más se filtra

### Agente 3 — Integridad contable
- Decimal everywhere (no float en montos), ROUND_HALF_UP comercial
- Partida doble: débitos = créditos en asientos
- Estados de voucher: transiciones válidas solamente (DRAFT→firmas→EXECUTED)
- IVA = 19%, neto+IVA=total en OCs y vouchers
- Folios SII únicos por (empresa, tipo_dte, folio, rut)

### Agente 4 — Race conditions
- Flujos de firma/aprobación: ¿FOR UPDATE antes de UPDATE?
- Crons/workers: ¿FOR UPDATE SKIP LOCKED?
- Contadores/secuencias: ¿advisory lock o UNIQUE constraint de respaldo?
- Doble-submit del frontend: ¿idempotencia en POSTs críticos?

### Agente 5 — Performance
- N+1 queries (loop con await db.execute adentro)
- Endpoints sin paginación que devuelven listas completas
- Índices faltantes para WHERE/ORDER BY frecuentes
- Bundle frontend: páginas > 200 kB first load

### Agente 6 — Frontend/UX
- Estados de error sin manejar (fetch sin .catch, sin error boundary)
- Loading states faltantes (pantalla congelada sin feedback)
- Mobile: tablas sin overflow-x, touch targets < 44px
- Textos en inglés que deberían estar en español chileno

### Agente 7 — Integraciones
- SII/Nubox/Dropbox/Resend/IMAP: timeouts configurados, retry con backoff,
  errores logueados (no silenciados), credenciales solo via Fernet
- Outbox de email: ¿FAILED acumulándose?

### Agente 8 — Datos/DB
- Migraciones pendientes vs aplicadas (comparar scripts/sql/ vs information_schema)
- Constraints: FKs huérfanas, CHECKs que el código puede violar
- Datos demo/test que quedaron en producción

## Verificación adversarial (obligatoria)

Por cada hallazgo 🔴: releer el archivo:línea citado y confirmar que el
problema ES real (no un falso positivo del grep). Descartar lo refutado.

## Formato del reporte final

```
# Auditoría Ram-Cehta — YYYY-MM-DD

## Resumen: X críticos / Y medios / Z bajos

## 🔴 Críticos (violan invariante o rompen producción)
| # | Dimensión | Archivo:línea | Problema | Invariante violado | Fix propuesto |

## 🟡 Medios  ...
## 🟢 Bajos   ...

## Comparación vs auditoría anterior
- Resueltos desde la última: ...
- Nuevos: ...
```

Guardar el reporte en `docs/AUDITORIA_YYYY_MM_DD.md` y actualizar
`docs/BACKLOG.md` con los hallazgos no resueltos.

## Después del reporte

Preguntar a Nicolás: "¿Arreglo los críticos ahora?" — si dice sí, arreglar
en orden de severidad, validando con la skill `debug-continuo` después.
