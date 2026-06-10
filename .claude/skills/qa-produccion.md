---
name: qa-produccion
description: Smoke test E2E contra producción de Ram-Cehta (read-only, sin crear ni modificar datos). Verifica backend Fly + frontend Vercel + DB + integraciones. Correr después de CADA deploy y diariamente en marcha blanca.
---

# Skill: QA Producción (smoke test E2E)

**REGLA DURA: solo lecturas.** Este skill NUNCA crea vouchers, ni firma,
ni envía emails, ni modifica datos. Si una prueba requiere escritura,
se hace solo con autorización explícita de Nicolás y con datos marcados
de prueba.

## Bloque 1 — Backend vivo (1 min)

```powershell
# 1. Health
Invoke-RestMethod https://cehta-backend.fly.dev/api/v1/health
# 2. OpenAPI completo (si da 500, un router está roto)
(Invoke-RestMethod https://cehta-backend.fly.dev/openapi.json).paths.PSObject.Properties.Count
# 3. Máquinas Fly
fly status -a cehta-backend
```

PASS: health ok, ~431 paths, máquinas `started`.

## Bloque 2 — Frontend vivo (1 min)

```powershell
(Invoke-WebRequest https://ram-cehta.vercel.app -UseBasicParsing).StatusCode      # 200
(Invoke-WebRequest https://cehta-capital.vercel.app -UseBasicParsing).StatusCode  # 200
```

Si hay browser disponible (Playwright/Chrome MCP): abrir el login, verificar
que renderiza sin pantalla en blanco ni errores de consola.

## Bloque 3 — Flujos críticos (read-only, con browser)

Con sesión de prueba (pedir a Nicolás si no hay cookies guardadas):

1. **Dashboard** carga con KPIs reales (no NaN, no "undefined")
2. **Vouchers** lista carga + filtros responden
3. **OCs** lista carga + un PDF de OC abre sin "Failed to fetch"
4. **RRHH** lista empleados carga
5. **Búsqueda Cmd+K** devuelve resultados
6. **Conciliación** página carga sin 500
7. Navegar como usuario NO-admin: verificar que NO ve empresas fuera de
   su scope (multi-tenant check visual)

## Bloque 4 — Integraciones (estado, no acción)

```powershell
# Estado de credenciales/sync sin disparar syncs:
Invoke-RestMethod https://cehta-backend.fly.dev/api/v1/sii/empresas -Headers @{Authorization="Bearer $token"}
Invoke-RestMethod https://cehta-backend.fly.dev/api/v1/nubox-api/empresas -Headers @{Authorization="Bearer $token"}
```

Y en DB (Supabase Studio):
```sql
SELECT status, COUNT(*) FROM core.email_outbox GROUP BY status;          -- FAILED creciendo = mal
SELECT * FROM core.system_incidents WHERE status != 'RESOLVED' LIMIT 5;  -- vacío = bien
SELECT MAX(started_at) FROM core.auto_sync_runs;                          -- ¿cron corriendo?
```

## Bloque 5 — Checklist marcha blanca

Abrir `/admin/marcha-blanca` y reportar el status global
(READY / ALMOST_READY / NEEDS_ATTENTION / NOT_READY) + los ítems en rojo.

## Reporte

```
# QA Producción — YYYY-MM-DD HH:MM
| Bloque | Estado | Detalle |
|---|---|---|
| Backend | ✅ | 431 paths, 1 máquina started |
| Frontend | ✅ | ambos alias 200 |
| Flujos | ✅/⚠️ | ... |
| Integraciones | ⚙️ | SII/Nubox inertes (esperado) |
| Marcha blanca | ... | ... |
```

Si algo falla → invocar skill `incident-response` inmediatamente.
También existe el workflow de GitHub Actions
`.github/workflows/smoke-backend-prod.yml` que corre esto automático.
