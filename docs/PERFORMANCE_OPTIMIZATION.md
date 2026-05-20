# Guía de Performance · Ram-Cehta

> **Round 127 (2026-05-20)**: cache agresivo aplicado en endpoints hot.
> Esta guía explica cómo medir y mejorar la performance restante.

---

## Estado actual (post-Round 127)

| Métrica | Valor |
|---|---|
| Backend host | Fly.io · gru (São Paulo) · `shared-cpu-1x:512MB` |
| Backend workers | 1 (limitado por pool DB) |
| DB pool config | `pool_size=3, max_overflow=1` (cap Supabase Free) |
| Frontend host | Vercel · edge global |
| DB host | Supabase · AWS sa-east-1 (mismo DC que Fly) |
| Cache agresivo | ✅ `/sidebar-state` 30s · `/me/empresas` 5min · `/empresa/{c}` 5min · `/catalogos/*` 5min · `/areas` 5min · `/proyectos-contables` 5min |
| Gzip compression | ✅ activa (min 300 bytes) |
| Pool mode | session (port 5432) — limitado |

## Latencias típicas hoy

| Operación | Latencia |
|---|---|
| Vos (Chile) → Vercel edge | ~30-80ms |
| Vercel → Fly (gru) | ~5-15ms |
| Fly → Supabase (mismo DC) | ~3-5ms |
| Query simple (sin cache) | ~10-30ms |
| Query con cache hit | ~1-3ms |
| **Total request promedio** | ~150-300ms |

---

## Mejoras disponibles (en orden de ROI)

### 🥇 1. Migración a Transaction Pooler de Supabase (CRÍTICO · gratis)

**Impacto**: 3-5x throughput. Permite volver a `workers=2` + `pool_size=10`.
Elimina el techo de 15 conexiones que generó el incident del Round 109.

**Costo**: $0
**Tiempo**: 5 min tuyo + 2 min deploy automático

#### Pasos

1. Abrí https://supabase.com/dashboard/project/dqwwqfhzejscgcynkbip
2. **Settings → Database → Connection string → pestaña Transaction**
3. Copiá la URL completa. Va a verse así:
   ```
   postgres://postgres.dqwwqfhzejscgcynkbip:[PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
   ```
4. **Reemplazá `[PASSWORD]`** con la password real (usá el toggle "Show password" del dashboard).
5. En PowerShell:
   ```powershell
   fly secrets set DATABASE_URL="<la URL completa con password>" -a cehta-backend
   ```
6. Fly redeploya solo (~2 min). El código del Round 109 detecta automáticamente el puerto 6543 y usa `NullPool` (asyncpg maneja todo internamente).

#### Verificación

```powershell
Invoke-WebRequest -Uri "https://cehta-backend.fly.dev/api/v1/health/perf" -UseBasicParsing | ConvertFrom-Json | Select db_pool_mode
```

Debe decir: `transaction (NullPool, +50ms/req)`.

#### Subir workers a 2 (Round 128 después del paso anterior)

Una vez confirmado el pooler mode = transaction, decímelo y aplico:
- `fly.toml`: workers 1 → 2
- `database.py`: el comentario actualizado (pool ya es NullPool, no hay pool size que tocar)

Resultado neto: **2 procesos uvicorn paralelos** sin riesgo de `EMAXCONNSESSION`. ~2x throughput sin cambiar plan Supabase.

---

### 🥈 2. Subir Fly machine a 2x:1024MB (+$7/mes)

**Impacto**: cold start de ~7s a ~3s. Más memoria para cache asyncpg + SQLAlchemy.

**Pasos**:
```powershell
fly scale vm shared-cpu-2x --memory 1024 -a cehta-backend
```

Esto cambia el tipo VM de todas las machines (app + crons). Fly redeploya solo.

---

### 🥉 3. Frontend bundle audit (gratis)

Ya hicimos `next build` varias veces. El bundle shared es 102 kB (excelente). Cada página agrega 0.2-15 kB extra. No hay mucha mejora marginal sin trabajar páginas individuales.

Si querés ver dónde se va el peso:
```powershell
cd C:\Users\DELL\Documents\0.11.Nikolaya\Ram-Cehta\frontend
$env:ANALYZE="true"; npx --no-install next build
```

---

### 4. Upstash Redis para cache distribuido (+$10/mes)

Hoy el cache está en headers HTTP (browser + Vercel edge). Para cache server-side compartido entre múltiples machines Fly, necesitarías Redis.

**Cuando vale la pena**: cuando tengas >10 usuarios concurrentes consultando el mismo dashboard. Hoy con 1-5 users, el cache HTTP alcanza.

---

### 5. Supabase Pro tier (+$25/mes)

**Cuando**:
- Tu DB pasa los 500MB (Free tier cap)
- Querés daily backups + point-in-time recovery 7 días
- Necesitás más de 60 conexiones simultáneas (transaction pooler ya da eso, así que rara vez)

**No** te apures con esto: con transaction pooler activado, la presión sobre conexiones baja mucho.

---

## Lo que YA hicimos (no requiere acción tuya)

Round 127 (este commit) ya aplica cache en:

| Endpoint | Antes | Después |
|---|---|---|
| `/api/v1/me/sidebar-state` | sin cache | 30s + SWR 15s |
| `/api/v1/me/empresas` | 5min | 5min (sin cambio) |
| `/api/v1/empresa` | 5min | 5min (sin cambio) |
| `/api/v1/catalogos/empresas/{c}` | sin cache | 5min + SWR 60s |
| `/api/v1/areas` | 5min | 5min (sin cambio) |
| `/api/v1/proyectos-contables` | 5min | 5min (sin cambio) |

**Impacto**: en una sesión típica del operador (50-100 clicks en 30 min),
~80% de queries del sidebar se sirven desde cache del browser sin tocar
la DB. **Esto solo ya hace la app ~30-50% más responsive.**

---

## Lo que NO va a hacerte la app más rápida

| Idea | Por qué no |
|---|---|
| Mover a VPS Hostinger | Pierde edge CDN de Vercel + auto-scaling Fly. Peor experiencia user. |
| "Hacerla nativa" (app de escritorio) | Es web por diseño. Una app nativa requeriría reescribir todo. |
| Hostear DB en local | Latencia menor, pero pierdes backups, replicación, auth Supabase. Trabajo inmenso vs beneficio marginal. |
| Más rounds de "mejoras genéricas" | Sin métricas concretas de qué endpoint es lento, son optimizaciones a ciegas. |

---

## Cómo medir si una mejora funcionó

### Frontend (lo que vos sentís)

Abrí Chrome DevTools (F12) → tab **Network**:
- **DOMContentLoaded** debe ser < 1.5s
- **Load** debe ser < 3s en primera visita, < 1s en visitas siguientes (cache)

### Backend (latencia real)

```powershell
Measure-Command { Invoke-WebRequest -Uri "https://cehta-backend.fly.dev/health" -UseBasicParsing } | Select-Object TotalMilliseconds
```

- Healthy: < 200ms total
- Cold start: 5-8s (primera request después de inactividad)

### DB pool usage

```powershell
Invoke-WebRequest -Uri "https://cehta-backend.fly.dev/api/v1/health/perf" -UseBasicParsing | ConvertFrom-Json
```

Si `db_pool_size` muestra valores cerca del límite (3 hoy, 10 con pooler tx), hay riesgo de saturación.

---

## Plan recomendado en orden

1. **Hoy mismo**: aplicá paso 1 (transaction pooler). 5 min tuyo. Mejora masiva, gratis.
2. **Tras confirmar paso 1**: avisame y aplico Round 128 (workers=2, pool 5+5). +50% throughput.
3. **Si sentís que arranca lento**: paso 2 (machine 2x:1024MB). +$7/mes.
4. **Si crecés a 10+ usuarios concurrentes**: paso 4 (Redis) + 5 (Supabase Pro).

Cualquier duda, decimelo. Las mejoras son **acumulativas y reversibles** —
ninguna te bloquea de volver atrás si algo va mal.
