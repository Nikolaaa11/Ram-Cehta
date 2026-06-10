---
name: performance-scan
description: Escaneo de performance de Ram-Cehta — mide latencias reales en producción, detecta N+1, pool saturation, bundles pesados. Entrega quick wins ordenados por impacto/esfuerzo. Correr quincenal o cuando "la plataforma se siente lenta".
---

# Skill: Performance Scan

Regla: **medir primero, optimizar después**. Nada de optimización
especulativa. Referencia: `docs/PERFORMANCE_OPTIMIZATION.md`.

## Paso 1 — Medición real en producción (5 min)

```powershell
# Latencia de endpoints clave (correr 3 veces c/u, tomar mediana)
Measure-Command { Invoke-RestMethod https://cehta-backend.fly.dev/api/v1/health }
Measure-Command { Invoke-RestMethod https://cehta-backend.fly.dev/api/v1/health/perf }
```

Y el panel interno: `GET /api/v1/perf/stats` (telemetría Round 152PPPPP)
→ endpoints más lentos por p95, más llamados, errores.

### Umbrales

| Métrica | OK | Atención | Crítico |
|---|---|---|---|
| p95 endpoint de lectura | < 500ms | 500ms–2s | > 2s |
| p95 endpoint de escritura | < 1s | 1–3s | > 3s |
| db_pool_in_use / db_pool_size | < 50% | 50–80% | > 80% |
| First Load JS por página | < 150 kB | 150–250 kB | > 250 kB |

## Paso 2 — Diagnóstico backend

1. **Pool**: si in_use alto → buscar transacciones largas
   (llamadas a Claude/Dropbox/SII DENTRO de una transacción DB = veneno;
   sacarlas fuera del `async with db.begin()`).
2. **N+1**: `grep -rn "for .* in" app/services/ -A3 | grep "await db.execute"`
   → cada match es candidato a UNNEST bulk o JOIN.
3. **Sin paginación**: endpoints que devuelven `.fetchall()` sin LIMIT.
4. **Índices**: para queries lentas, correr `EXPLAIN ANALYZE` en Supabase
   Studio. Seq Scan en tabla > 10k filas = falta índice.

## Paso 3 — Diagnóstico frontend

```bash
cd frontend && npm run build 2>&1 | grep -A40 "First Load JS"
```

- Páginas pesadas → lazy-load (dynamic import) de Recharts, editores, PDF
- `staleTime` en queries semi-estáticas (catálogos, empresas) → 5+ min
- Verificar prefetch on hover en navegación frecuente

## Paso 4 — Quick wins (formato de entrega)

| # | Mejora | Impacto | Esfuerzo | ¿Hacer ya? |
|---|---|---|---|---|
| 1 | ... | Alto (p95 -60%) | 15 min | ✅ |

Implementar SOLO los de impacto Alto/esfuerzo Bajo en la misma sesión.
El resto → `docs/BACKLOG.md`.

## Paso 5 — Validar que no rompiste nada

Correr capas 1-3 de la skill `debug-continuo` (sintaxis + import + build).
Después medir DE NUEVO el endpoint optimizado y reportar antes/después.

## Recordatorio pendiente (alto impacto, requiere acción de Nicolás)

Migrar `DATABASE_URL` al **transaction pooler (puerto 6543)** con NullPool —
detalle en `docs/PERFORMANCE_OPTIMIZATION.md`. Es el cambio de mayor impacto
para la saturación de conexiones del free tier (cap 15 conexiones).
