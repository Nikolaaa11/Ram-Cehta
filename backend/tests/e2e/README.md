# Smoke Tests E2E — backend Ram-Cehta

## ¿Qué son?

Tests **read-only** que corren contra producción para detectar regresiones graves después de cada deploy. **NUNCA mutan data.**

Si alguno falla, hay un problema serio que típicamente requiere rollback inmediato.

## Cómo correrlos a mano (PowerShell)

```powershell
cd C:\Users\DELL\Documents\0.11.Nikolaya\Ram-Cehta\backend
.\scripts\smoke_test.ps1
```

El script te va a pedir el JWT admin si no está seteado en env.

## Cómo correrlos en CI

Automático: corren todos los días a las 11:00 Chile (14:00 UTC).

Manual: GitHub → Actions → "smoke-backend-prod" → Run workflow.

## Cómo obtener el JWT admin

1. Abrir https://cehta-capital.vercel.app y loguearse como admin
2. F12 → Application → Local Storage → `https://cehta-capital.vercel.app`
3. Buscar key `sb-mowkckwvezudbdcyhwyj-auth-token`
4. Copiar el campo `access_token` (string que empieza con `eyJ...`)

## Qué testea cada uno

| Test | Qué valida | Si falla, qué significa |
|------|------------|--------------------------|
| `test_liveness_endpoint` | `/health` responde 200 | Backend down. Rollback inmediato. |
| `test_root_endpoint` | `/` devuelve service name | Backend down o mal config |
| `test_api_health_endpoint` | `/api/v1/health` responde 200 (incluye DB ping) | Supabase down o creds inválidas |
| `test_openapi_docs_available` | `/openapi.json` accesible + tiene >20 endpoints | Algo se perdió en el deploy |
| `test_cors_headers_present` | CORS preflight desde Vercel funciona | Frontend no puede hablar con backend |
| `test_admin_perf_stats_authorized` | Admin puede consultar `/admin/perf-stats` | JWT o caches rotos |
| `test_admin_feature_usage_authorized` | Admin puede consultar `/admin/feature-usage` | Falta migración SQL R152PPPPP |
| `test_admin_only_endpoint_rejects_no_auth` | Endpoints admin rechazan sin JWT | 🚨 ALERTA SEGURIDAD |
| `test_backend_responds_under_3_seconds` | API responde en <3s después de warmup | Backend o DB lentos |

## Política de rotación del JWT

El JWT de Supabase **expira a los 60 días**. Si ves que los tests con auth empiezan a fallar con 401:

1. Generar nuevo JWT (ver "Cómo obtener" arriba)
2. Actualizar en GitHub Settings → Secrets → `SMOKE_ADMIN_JWT`
3. Re-correr el workflow

## ¿Por qué solo read-only?

Tests mutativos en producción son **proyecto aparte** porque necesitan:
- Empresa de test específica (TEST-CORP) en data
- Cleanup automático
- Manejo de errores parciales

Por ahora, los tests mutativos viven en `backend/tests/integration/` y corren contra DB local con testcontainers.

## ¿Por qué no Playwright para backend?

Playwright es para flujos de UI en browser (frontend). Para backend, `pytest + requests` es:
- Más rápido (no levanta chromium)
- Más simple (50 líneas de Python vs setup Playwright)
- Más confiable (sin flakiness de UI)

Para tests E2E de frontend ver `.github/workflows/e2e-ci.yml`.
