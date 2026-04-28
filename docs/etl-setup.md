# ETL Setup — Data Madre.xlsx → Postgres

Guía operacional para configurar y operar el ETL que sincroniza
`Data Madre.xlsx` (Dropbox) con `core.movimientos` (Postgres).

**Última actualización**: 2026-04-26 — V3 fase 5

---

## 1. Cómo funciona

```
Dropbox/Cehta Capital/00-Inteligencia de Negocios/Data Madre.xlsx
                       │
                       ▼ (1) busca archivo + descarga + SHA256
                       │
        ┌──────────────────────────────────────────┐
        │  Si hash == último etl_run success:       │
        │     ETLResult(status="skipped")           │
        │  (no abre etl_run, no toca Postgres)      │
        └──────────────────────────────────────────┘
                       │
                       ▼ (2) crea audit.etl_runs (status='running')
                       ▼ (3) parsea hoja "Resumen" (openpyxl read_only)
                       ▼ (4) volcado raw.resumen_excel
                       ▼ (5) valida → rejected_rows o transforma
                       ▼ (6) UPSERT core.movimientos por natural_key
                       ▼ (7) snapshot a Histórico/YYYY-MM-DD-Data-Madre.xlsx
                       ▼ (8) cierra etl_run → 'success' | 'partial' | 'failed'
```

### Idempotencia
- **Hash file-level**: si el archivo no cambió, salta todo el pipeline.
- **natural_key row-level**: hash determinístico de
  `(fecha, descripcion, abono, egreso, empresa, banco)`. Re-runs del mismo
  archivo no duplican filas — UPSERT por natural_key.

### Reglas de validación (filas rechazadas, no bloquean el resto)

| Regla | Razón en `audit.rejected_rows.reason` |
|---|---|
| `fecha` vacía o no parseable | `fecha vacía o inválida` |
| `empresa` vacía | `empresa vacía` |
| `empresa` no existe en `core.empresas` | `empresa 'X' no existe en core.empresas` |
| `periodo` no es `MM_YY` válido | `periodo 'XX' inválido o inconsistente con anio=YYYY` |
| `periodo` (yy) inconsistente con `anio` | mismo mensaje |
| `abono > 0` y `egreso > 0` simultáneamente | `abono (X) y egreso (Y) ambos > 0 en misma fila` |

### Catálogos auto-pobladores
Cuando el ETL ve un valor de `concepto_general`, `concepto_detallado`,
`tipo_egreso`, `fuente`, `proyecto` o `banco` que no existe aún en su
catálogo, lo inserta automáticamente con `ON CONFLICT DO NOTHING`. No falla
por FK, no necesita intervención manual.

---

## 2. Triggers — cuándo corre el ETL

| Origen | Cómo | Quién dispara |
|---|---|---|
| **Manual** | `POST /etl/run` (desde `/admin/etl` con botón) | Admin |
| **Webhook** | Dropbox notifica cambio → `POST /etl/webhook/dropbox` | Dropbox |
| **Cron** | Fly machine con schedule cada 30 min ejecuta `python -m scripts.etl_cron` | Fly.io |

### 2.1 Configurar webhook en Dropbox app

1. Ir al [Dropbox App Console](https://www.dropbox.com/developers/apps).
2. Seleccionar la app de Cehta Capital.
3. Tab **Webhooks** → URL: `https://cehta-backend.fly.dev/api/v1/etl/webhook/dropbox`.
4. Click **Add**. Dropbox hace un GET con `?challenge=<random>` y nuestro
   endpoint le devuelve el mismo string como `text/plain`. Si el challenge
   pasa, Dropbox marca el webhook como **Enabled**.
5. A partir de ahí, cualquier cambio en cualquier archivo del Dropbox
   conectado dispara un `POST` con firma HMAC. El ETL chequea hash y procesa
   solo si Data Madre cambió.

### 2.2 Configurar cron en Fly.io

Hay dos opciones:

#### Opción A — Fly machine con schedule (recomendado)

```bash
# Crear (una sola vez) una machine con el proceso etl_cron y schedule cron-style
fly machine run \
  --app cehta-backend \
  --schedule "*/30 * * * *" \
  --process-group etl_cron \
  -- python -m scripts.etl_cron
```

> El proceso `etl_cron` ya está declarado en `fly.toml`.

#### Opción B — GitHub Actions cron

`.github/workflows/etl-cron.yml`:

```yaml
on:
  schedule:
    - cron: "*/30 * * * *"
jobs:
  trigger-etl:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST https://cehta-backend.fly.dev/api/v1/etl/run \
            -H "Authorization: Bearer ${{ secrets.ETL_SERVICE_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{"triggered_by":"github-actions"}'
```

Requiere un service-role token con scope `audit:read` (admin).

---

## 3. Trigger manual desde la UI

1. Login como admin en `https://cehta-capital.vercel.app`.
2. Sidebar → **Admin** → **ETL Runs** (`/admin/etl`).
3. Click **Ejecutar ETL ahora** (esquina superior derecha).
4. Confirmación → toast con resultado (`success`/`partial`/`skipped`/`failed`).
5. La tabla refresca automáticamente.

---

## 4. Inspeccionar runs

- Lista: `/admin/etl` → muestra todos los runs paginados.
- Detalle: `/admin/etl/{run_id}` → counts + filas rechazadas.
- API:
  ```bash
  curl https://cehta-backend.fly.dev/api/v1/audit/etl-runs \
    -H "Authorization: Bearer $TOKEN"
  curl https://cehta-backend.fly.dev/api/v1/audit/etl-runs/$RUN_ID/rejected-rows \
    -H "Authorization: Bearer $TOKEN"
  ```

---

## 5. Troubleshooting

### "Dropbox no conectado" (503 en POST /etl/run)
1. Ir a `/admin/integraciones`.
2. Click **Conectar Dropbox** → autorizar la cuenta corporativa.
3. Reintentar.

### "Data Madre.xlsx no encontrado"
- Verificar que el archivo exista en `Cehta Capital/00-Inteligencia de Negocios/`.
- Acepta variante legacy `Inteligencia de Negocios/` (sin prefijo `00-`).
- Verificar permisos: la app Dropbox debe tener acceso a esa carpeta.

### Run quedó como `running` y no progresa
- Algo se cortó (Fly OOM, timeout). Forzar cierre manual:
  ```sql
  UPDATE audit.etl_runs SET status='failed',
    error_message='timeout — manualmente cerrado',
    finished_at=now()
  WHERE status='running' AND started_at < now() - interval '15 minutes';
  ```

### Filas rechazadas masivas
1. Drill-down: `/admin/etl/{run_id}/rejected-rows`.
2. Filtrar por `reason` para encontrar el patrón.
3. Casos típicos:
   - Empresa nueva no agregada al seed → `INSERT INTO core.empresas`.
   - Periodo en formato distinto (`'2026-02'` en vez de `'02_26'`) →
     limpiar el Excel madre.
   - Filas con abono y egreso simultáneos → corrección manual en el Excel.

### Webhook no dispara
- Logs: `flyctl logs --app cehta-backend | grep etl.webhook`.
- Verificar firma HMAC: si vemos `Invalid Dropbox signature` repetido, hay
  desync entre `DROPBOX_CLIENT_SECRET` y la app de Dropbox.
- Verificar status del webhook en Dropbox console (puede haber sido pausado
  por respuestas 5xx repetidas).

### Hash igual pero quiero forzar re-procesamiento
- Editar mínimamente el Excel y guardar (cambiar el hash).
- O borrar el último etl_run success:
  ```sql
  DELETE FROM audit.etl_runs
   WHERE run_id = (
     SELECT run_id FROM audit.etl_runs
      WHERE status='success' ORDER BY started_at DESC LIMIT 1
   );
  ```

---

## 6. Estructura del Excel madre — cheatsheet

Hoja `Resumen` con headers (case-insensitive, acepta variantes):

| Header (Excel) | Campo lógico | Tipo | Obligatorio |
|---|---|---|---|
| Hipervinculo | hipervinculo | string | no |
| Fecha | fecha | date | sí |
| Descripcion | descripcion | string | no |
| Abonos | abonos | decimal | no |
| Egreso | egreso | decimal | no |
| Saldo Contable | saldo_contable | decimal | no |
| Saldo Cehta | saldo_cehta | decimal | no |
| Saldo Corfo | saldo_corfo | decimal | no |
| Concepto General | concepto_general | string | no |
| Concepto Detallado | concepto_detallado | string | no |
| Tipo Egreso | tipo_egreso | string | no |
| Fuentes | fuentes | string | no |
| Proyecto | proyecto | string | no |
| Banco | banco | string | no |
| Real/Proyectado | real_proyectado | "Real"\|"Proyectado" | no |
| Año | anio | int | no (default año de fecha) |
| Periodo | periodo | "MM_YY" | sí |
| Empresa | empresa | código (TRONGKAI, etc.) | sí |
| IVA Crédito | iva_credito | decimal | no |
| IVA Débito | iva_debito | decimal | no |

---

## 7. Esquema en Postgres (referencia)

- `audit.etl_runs` — un row por corrida.
- `audit.rejected_rows` — N rows por corrida (FK CASCADE).
- `raw.resumen_excel` — volcado tal cual del Excel.
- `core.movimientos` — modelo normalizado, fuente de verdad para la app.
- `core.{concepto_general, concepto_detallado, tipo_egreso, fuente, proyecto, banco}` — catálogos.

Ver `backend/db/schema.sql` para definiciones exactas.
