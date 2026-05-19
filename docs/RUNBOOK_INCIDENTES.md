# Runbook · Incidentes en producción

> **Para Nicolas (no-ingeniero)**: cuando algo se cae en producción,
> seguí estos pasos. Cada bloque es copy-paste y dice qué esperar.
> Está pensado para que puedas diagnosticar y, en muchos casos,
> arreglar vos solo sin esperar a un dev.

**Última actualización:** 2026-05-19 (post-Round 109 EMAXCONNSESSION incident).

---

## Síntomas comunes

| Lo que ves | Lo más probable | Sección |
|---|---|---|
| HTTP 500 en una pantalla | Backend caído / pool DB lleno | [§ 1](#1-revisar-salud-del-backend) |
| HTTP 404 en muchas pantallas | Vercel bloqueado por Security Checkpoint | [§ 4](#4-vercel-security-checkpoint-403404) |
| "No se pudo cargar..." con error rojo | El frontend cargó OK pero el backend respondió mal | [§ 1](#1-revisar-salud-del-backend) |
| El sidebar dice "0" cuando deberías tener pendientes | Cache stale o backend cayó | [§ 2](#2-flush-de-cache-del-browser) |
| Spinner infinito | Backend lento o pool lleno | [§ 1](#1-revisar-salud-del-backend) |

---

## 1. Revisar salud del backend

Abrí PowerShell y corré:

```powershell
Invoke-WebRequest -Uri "https://cehta-backend.fly.dev/health" -UseBasicParsing | Select-Object StatusCode, Content
```

**Lo que tiene que devolver:**
```
StatusCode Content
---------- -------
       200 {"status":"alive"}
```

Si devuelve algo distinto a 200 → el backend está caído. Saltá a [§ 3](#3-revisar-logs-fly).

Si devuelve 200 pero las pantallas siguen 500-eando → puede ser pool DB lleno. Pegale a:

```powershell
$h = @{ Authorization = "Bearer <tu-jwt>" }  # opcional, /health/perf es público
Invoke-WebRequest -Uri "https://cehta-backend.fly.dev/api/v1/health/perf" -UseBasicParsing | Select-Object -ExpandProperty Content
```

Mirá las `recommendations`. Si dice algo de **EMAXCONNSESSION** → saltá a [§ 5](#5-fix-permanente-emaxconnsession).

---

## 2. Flush de cache del browser

Muchas veces el problema es bundle JS viejo cacheado:

1. **Chrome / Edge**: `Ctrl + Shift + R` (hard reload)
2. **Si sigue mal**: F12 → Network tab → activar "Disable cache" → recargar
3. **Último recurso**: ventana de incógnito (`Ctrl + Shift + N`) y entrá a https://ram-cehta.vercel.app/login

---

## 3. Revisar logs Fly

Para ver qué dice el backend:

```powershell
fly logs -a cehta-backend --no-tail | Select-Object -Last 50
```

**Patrones que indican problema concreto:**

- `EMAXCONNSESSION` o `max clients reached` → pool DB lleno. [§ 5](#5-fix-permanente-emaxconnsession)
- `Traceback (most recent call last)` → bug de código. Mandale a Claude el bloque completo.
- `500 Internal Server Error` repetido en un endpoint → ese endpoint está roto. Mandale a Claude el path + traceback.
- `Health check failed` → la machine no responde. Ver si hay deploy en curso.

Para enfocar en errores:

```powershell
fly logs -a cehta-backend --no-tail | Select-String -Pattern 'ERROR|Traceback|500 Internal' | Select-Object -Last 20
```

---

## 4. Vercel Security Checkpoint (403/404)

Si **toda** la plataforma da 404 / 403 / "página de Vercel" en `cehta-capital.vercel.app`:

1. Abrí https://vercel.com/dashboard
2. Proyecto `cehta-capital` → **Settings**
3. **Security** o **Firewall** → desactivar **Attack Challenge Mode**
4. **Deployment Protection** → Vercel Authentication = **Disabled**
5. Esperá 30s, recargá la página en incógnito

**Mientras tanto** usá `https://ram-cehta.vercel.app/login` — sirve el mismo deploy sin estos bloqueos.

---

## 5. Fix permanente EMAXCONNSESSION

Supabase Free Tier permite máximo **15 conexiones simultáneas** en session pooler.
Si la app crece, vamos a chocar contra eso de nuevo. La solución
permanente es migrar al **transaction pooler** (port 6543) que permite
60+ conexiones concurrentes.

### Pasos exactos

1. **Conseguir la nueva URL** desde Supabase:
   - Entrá a https://supabase.com/dashboard → proyecto `dqwwqfhzejscgcynkbip`
   - **Settings** → **Database** → **Connection string**
   - Pestaña **Transaction** (NO "Session")
   - Copiá la URL completa. Va a verse así:
     ```
     postgres://postgres.dqwwqfhzejscgcynkbip:[PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
     ```
   - Reemplazá `[PASSWORD]` con la password real (Supabase la oculta — usá el toggle "show password" o ponela del 1Password de Cehta)

2. **Setear el secret en Fly:**

   ```powershell
   fly secrets set DATABASE_URL="postgres://postgres.dqwwqfhzejscgcynkbip:TUPASSWORD@aws-0-sa-east-1.pooler.supabase.com:6543/postgres" -a cehta-backend
   ```

   Fly redeploya automáticamente (~2 min). Vas a ver el output:
   ```
   Secrets are staged for the next deployment
   ```

3. **Verificar** que tomó:

   ```powershell
   Invoke-WebRequest -Uri "https://cehta-backend.fly.dev/api/v1/health/perf" -UseBasicParsing | ConvertFrom-Json | Select-Object -ExpandProperty db_pool_mode
   ```

   Tiene que decir: `transaction (NullPool, +50ms/req)`.

4. **(Opcional) Subir el throughput** de vuelta a `--workers 2`:

   Editar `backend/fly.toml` línea 49 — cambiar `--workers 1` por `--workers 2`. Commit + push + deploy.
   Con transaction pooler no hay riesgo de EMAXCONNSESSION.

### ¿Por qué no se hizo de una?

Trade-off: transaction pooler agrega **~50ms por request** porque no soporta
prepared statements (los pre-compila el cliente y se reusan; sin eso, cada query
se parsea de cero). Para esta app es irrelevante (la latencia humana de un click es
~200ms igual), pero hasta el incident de hoy estábamos optimizando para velocidad
con la limitación de Free Tier en mente.

---

## 6. Rollback rápido si un deploy rompe algo

Si después de un deploy las cosas empeoraron:

```powershell
fly releases -a cehta-backend
```

Ves la lista de releases (v123, v124...). Para volver al anterior:

```powershell
fly deploy --image-from-release v<N-1> -a cehta-backend
```

Esto restaura el código + la config del release anterior **sin hacer commit** (Git queda como estaba).

---

## 7. Cuándo escalar a un dev

Llamame (o pasale los datos a quien sea el dev de turno) si:

- El backend devuelve 500 y los logs no muestran un error obvio
- Aparecen errores de DB constraints / migraciones
- El frontend tira "white screen" sin nada en la consola
- Necesitás cambiar la lógica de aprobaciones, threshold, o flow de vouchers
- Hay que tocar Supabase RLS / policies

**Información a pasarle al dev (siempre):**

1. URL exacta donde aparece el error
2. Screenshot de la pantalla
3. Captura del Network tab del DevTools (F12 → Network → la request roja)
4. Output de:
   ```powershell
   fly logs -a cehta-backend --no-tail | Select-Object -Last 100
   ```

Con eso 99% de las veces el dev puede diagnosticar sin pedirte más.

---

## Histórico de incidentes resueltos

| Fecha | Síntoma | Causa raíz | Fix |
|---|---|---|---|
| 2026-05-19 | 500 en /empresa/REVTECH/resumen-cc | Pool DB de 14 conns saturaba el cap de 15 del session pooler Supabase Free | Round 109: pool 5→3, workers 2→1 |
| 2026-05-19 | Browser viejo abría 10 SSE/seg | Cliente con bundle pre-Round 105 cacheado | Round 110: cap de 5 SSE por user, FIFO evict |
| 2026-05-18 | cehta-capital.vercel.app daba 403/404 | Vercel Attack Challenge Mode activado | Desactivar desde dashboard Vercel |
| 2026-05-16 | Vercel build congelado 2 días | ESLint errors (`prefer-const`, unescaped quotes) | Round 88+88b fix |

*Cuando arregles un incident nuevo, agregá una fila acá.*
