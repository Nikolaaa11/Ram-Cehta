# BACKLOG · Ram-Cehta

> **Cómo se usa**: el operador (Nicolás) prioriza desde acá. Cada round
> técnico futuro toma de este archivo, NO inventa cambios.
>
> **Regla del MAESTRO**: ningún cambio entra a producción sin estar
> en este archivo + aprobado explícitamente.

Formato:
- `[H/M/L]` = prioridad (High / Medium / Low)
- `(Nh)` = horas estimadas
- `→ DEP` = depende de otro item
- `[OPS]` = pendiente de acción del operador, no técnico
- `[TECH]` = pendiente código

---

## 🔴 Crítico operativo (esta semana)

- [H] (2min) **[OPS] Aplicar 5 migraciones SQL pendientes**:
  ```powershell
  Set-Location C:\Users\DELL\Documents\0.11.Nikolaya\Ram-Cehta\backend
  python -m scripts.apply_pending_migrations
  ```
  Script idempotente que aplica round115/117/123/124/126 en orden contra `DATABASE_URL`. Round 130. Si ya están aplicadas, las skipea sin error.
- [H] (5min) **[OPS] Setear `CREDENTIALS_FERNET_KEY` en Fly + .env local**. Necesario para cualquier credencial SII/Nubox/Previred.
- [H] (10min) **[OPS] Correr seed Round 116**: `python scripts/seed_empresas_excel_round116.py "Data (4).xlsx"`. Carga 9 empresas + directorio + inversionistas + claves SII/Previred cifradas.
- [H] (1d) **[OPS] Pedir credenciales Nubox API UAT a soporte@nubox.com**. Después de recibirlas, cargar via POST `/admin/nubox-api/credentials/{empresa}`.
- [H] (5min) **[OPS] Configurar Fly cron schedules para Round 126**:
  - `fly machine update <id-monitor> --schedule "*/10 * * * *"`
  - `fly machine update <id-autosync> --schedule "0 6 * * *"`

## 🟡 Operativo (próximo mes)

- [H] (2h) **[TECH] Endpoint `/admin/credentials/encrypt-helper`** para que el operador pueda cifrar passwords sin necesitar Python local. Útil para cargar credenciales Nubox manualmente sin CLI.
- [H] (3h) **[TECH] UI `/admin/incidents`** para ver `core.system_incidents` con filtros, acknowledge, resolve. Sin UI los incidentes quedan invisibles.
- [H] (4h) **[TECH] Slack/email notification** cuando se abre incident CRITICAL. Hoy se loguea en DB pero nadie se entera.
- [M] (4h) **[TECH] Migración a Supabase transaction pooler** (port 6543). Elimina riesgo EMAXCONNSESSION permanentemente, permite volver a workers=2 + pool_size=5.
- [M] (6h) **[TECH] Nubox API auto-sync cron** integrado al auto_sync_cron del Round 126. Hoy solo SII.
- [M] (8h) **[TECH] F22 anual** módulo (similar a F29 pero anual). Vence 30 abril.
- [M] (4h) **[TECH] DJ 1879 (honorarios) generación** automática. Vence 22 marzo.
- [M] (4h) **[TECH] DJ 1887 (sueldos) generación** automática. Vence 22 marzo.

## 🟢 Mejoras de calidad de vida

- [M] (6h) **[TECH] Cliente Previred httpx** para bajar nómina automática (similar a Nubox scraping pero distinto portal). Round 123 dejó la base.
- [M] (8h) **[TECH] OCR de boletas honorarios** subidas como PDF → autocompletar voucher.
- [M] (4h) **[TECH] Dashboard CFO** con KPIs cruzados de las 9 empresas: liquidez, días de cobro, ejecución presupuesto, IVA acumulado.
- [M] (3h) **[TECH] Voucher mensual sueldos automático** desde `core.nubox_remuneraciones`. Genera DRAFT con todas las líneas armadas para el operador editar y firmar.
- [L] (4h) **[TECH] Anulación de DTE vía Nubox API**. Hoy solo se emiten, no se anulan.
- [L] (8h) **[TECH] Conciliación bancaria automática** (cartolas ↔ vouchers EXECUTED por monto + fecha).
- [L] (6h) **[TECH] Reportes LP trimestrales** con gráficos auto-generados.

## 🔵 Cumplimiento regulatorio

- [M] (4h) **[TECH] DJ 1929** (operaciones exterior) - aplica si hay facturas exportación.
- [M] (4h) **[TECH] DJ 1948** (rendición CORFO) - obligatorio para REVTECH/TRONGKAI.
- [M] (8h) **[TECH] Registro CMF** módulo si el FIP supera umbrales. Necesita NCG 235 reports.
- [L] (4h) **[TECH] KYC de inversionistas LP** workflow con FATCA.

## 🟣 Aprovechamiento de activos (estratégico)

- [M] (4h) **[TECH] Alertas de remanente IVA crédito >6 meses** por empresa, con sugerencia de estrategia (devolución export, cambio de actividad).
- [M] (6h) **[TECH] Calendario de depreciación acelerada** activos fijos según Art. 31 N°5 LIR.
- [M] (8h) **[TECH] Cash sweep automation**: si saldo empresa > 6 meses gastos op, sugerir DAP o fondo mutual.
- [L] (8h) **[TECH] Modelo de scoring crediticio** interno de proveedores/clientes.

## 🟤 Deuda técnica

- [L] (2h) **[TECH] Fix alembic chain break** entre 0060 y 0061. Hoy aplicamos migraciones manualmente vía SQL Editor; arreglar permite re-habilitar `release_command` en fly.toml.
- [L] (4h) **[TECH] Migrar Round 123 scraping Nubox a Playwright** si las claves Nubox que recibamos no permiten httpx puro.
- [L] (2h) **[TECH] Cleanup logs verbosos** que estamos haciendo en SSE (muchos `sse_subscribe` con tokens completos).
- [L] (6h) **[TECH] Suite de tests E2E** con Playwright cubriendo cierre mensual completo.

## ❌ Explícitamente NO en el backlog (para evitar pedidos repetidos)

- ❌ **Agente IA modificando código sin supervisión humana**: viola MAESTRO §5.1. Esto NO se va a hacer.
- ❌ **Bypass de las 2 firmas en vouchers**: invariante §1.3.11.
- ❌ **Cuentas IVA al pozo CORFO**: invariante §1.2.6 (E8).
- ❌ **Plaintext de credenciales**: invariante §1.4.15.

---

## Cómo agregar items

Si en operación detectás algo que mejorar:

1. Agregar al final de la sección apropiada
2. Asignar prioridad realista (no todo es H)
3. Estimar horas (mejor over-estimar 50%)
4. Si requiere acción tuya (no técnica) → marcar `[OPS]`

Cuando un item se completa, **moverlo a `docs/HISTORICO_BACKLOG.md`**
(no borrar — preserva el contexto histórico de qué se hizo y por qué).
