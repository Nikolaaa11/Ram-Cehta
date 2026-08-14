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

## 🔎 Ronda frontend/UX (R152ZZZZZZ, 2026-07-02) — pendientes

> Frontend verificado SÓLIDO (loading/error/empty states, double-submit,
> tablas con overflow, MobileBottomNav touch≥48px, error boundaries).
> Arreglados: NotificationsBell falso "todo al día" ante error de carga;
> use-webhooks fetch sin sesión.

- [M] (2h) **[TECH] 401 no centralizado en GETs de solo-lectura**: si la sesión expira estando quieto en una pantalla (dashboard, ai-insights, entregables, feed notif), los GET fallan con 401 y muestran ErrorState sin redirigir a login. Mitigado por redirect server-side en cada navegación. Fix correcto: `onError` global en QueryClient (providers.tsx) que detecte 401 y llame handleSessionExpired. Requiere cuidado para no romper flujos.
- [L] (30m) **[TECH] nubox extract/adjuntos usan fetch() directo** (vouchers/nubox/page.tsx:583,1002): un 401 cae en catch genérico ("Error 401") sin flujo de sesión expirada. Migrar a apiClient o manejar 401 explícito.


## 🔎 Ronda 2 barrido (R152YYYYYY, 2026-07-02) — pendientes verificados

> Ronda 2 (Gantt/tributario/IA/admin) ya ARREGLÓ y deployó: scope multi-tenant
> en avance quick+upcoming, F29/F22 writes+bulk, rendicion-corfo, módulo IA
> completo (data-qa, conversation, ask/write_mode, deny viewer), reset F29/F22
> a admin-only, protección último admin, checklist marcha-blanca G1/H1 (tabla
> app.user_2fa creada), validación fechas proyecto, invalidación cache Gantt,
> fecha_pago en bulk F29.

- [M] (1h) **[TECH] ETL cartolas — natural_key sin índice de fila**: 2 movimientos legítimamente idénticos el mismo día (2 comisiones iguales) → el 2º se pierde por ON CONFLICT DO NOTHING. Agregar índice de línea a la key (cartolas_parser_service.py:358).
- [M] (30m) **[TECH] Cartolas — skip lee runs failed**: el pre-load de hashes no filtra por status, un PDF que falló OCR queda skipeado para siempre tras arreglar la causa (cartolas_sync_service.py:96).
- [M] (1h) **[TECH] Informes LP expirados siguen sirviendo data**: is_expired es cosmético, el informe vencido devuelve live_data fresca; ?preview=1 muestra borradores. Cortar acceso server-side al expirar (informes_lp.py:941).
- [M] (1h) **[TECH] Alertas F29 solo miran ventana 0-7 días**: una F29 vencida impaga sale de la alerta al día 1 y del KPI dashboard al día 31 → invisible con multas SII acumulando (notification_generator_service.py:130 + views.sql v_f29_alertas).
- [L] (30m) **[TECH] Calendario OC filtra estado inexistente 'aprobada' y excluye 'parcial'**: OC parcialmente pagada desaparece del timeline (calendar.py:307).
- [L] (30m) **[TECH] CalendarHitos dice "6 meses" pero upcoming-tasks descarta bucket futuro >14d**: el calendario de Gantt sale vacío al avanzar meses (avance.py:1256).
- [L] (30m) **[TECH] import_entregables_csv sin cap de tamaño** (entregables.py:2076): riesgo OOM. El import Gantt sí capea 5MB.
- [L] (15m) **[TECH] Links F29/F22 del calendario pasan ?empresa_codigo= pero las páginas no leen searchParams** — aterrizan sin filtrar.


## 🔎 Hallazgos barrido R152UUUUUU (2026-07-02) — verificados, pendientes de fix
> Tanda 2 (R152VVVVVV) ya resolvió: deadlock inbox_cron, dedupe de
> clasificación (rowcount guard), outbox cableado al monitor horario,
> adjuntos regenerados en retry + oc_sent_at, y PDF v2/panimavida en
> el email al GG. Tanda 3 (R152WWWWWW): base del DTE Nubox corregida
> (+test con montos) y endpoint+botón Reabrir REJECTED→DRAFT.

- [M] (2h) **[TECH] Vía correo/PDF crea vouchers DRAFT sin líneas** que no pueden avanzar (submit exige líneas y no hay endpoint para agregarlas después). Decidir: ¿crear con líneas sugeridas, o botón "completar en formulario Nubox" que precargue?
- [done 2026-08-14 · R152kk] **[TECH] Filtro de período del dashboard (from/to) no lo consume ningún endpoint** — resuelto por **Opción A (implementar)**, no por quitar el control: `/kpis`, `/cashflow`, `/iva-trend`, `/egresos-por-concepto` y `/proyectos-ranking` ahora aceptan `?from=YYYY-MM&to=YYYY-MM`. KPIs agregan sobre la ventana elegida y comparan contra la ventana anterior del **mismo largo**; las etiquetas de la UI dejan de decir "del mes" cuando el rango es otro. Saldos/OC/F29 son fotos del presente y no se tocaron. De yapa: `/proyectos-ranking` ahora sí respeta `?empresa_codigo=` (lo recibía y lo descartaba). Ver también el finding F1 del audit del dashboard.
- [L] (30m) **[TECH] Scope per-empresa en mapeo CORFO** (`corfo_rendiciones.py`): gate solo por rol admin/finance, sin validar scope de REVTECH/TRONGKAI.
- [L] (15m) **[TECH] Regenerar tipos OpenAPI del frontend** (`npm run gen:types`) — datan del 13-may, sin impuesto_especifico ni campos R152 nuevos.
- [L] (5m) **[TECH] Comentario engañoso en app-sidebar.tsx:574** sobre redirect de /admin/oc-branding que no existe.


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

### De auditoría perf+UX R152NNNNNN (2026-06-12, 3 agentes)
- [done R152OOOOOO] /vouchers/paginated → COUNT(*) OVER() (1 round-trip)
- [done R152OOOOOO] dashboard/kpis → 6 queries consolidadas en 1 (probada vs Supabase: 262ms total)
- [done R152OOOOOO] /transferencias → toast con pasos siguientes post-descarga
- [done R152OOOOOO] notifications inbox → COUNT(*) OVER() (1 round-trip)
- [descartado] cashflow "sort en SQL": ya era 1 sola query; ordenar 36 filas en Python cuesta ~0ms — sin beneficio real.
- [M] (12min) **[TECH] VouchersClientView**: 10+ useState de filtros sin memoization → agrupar en objeto + useCallback (menos re-renders en móvil). Refactor con riesgo de regresión — hacer con QA manual.
- [L] (15min) **[UX] unificar terminología** "Contraparte" (vouchers) vs "Proveedor" (OCs) + tooltip.
- [L] (12min) **[UX] /vouchers/nuevo**: tooltip de folio (obligatorio solo al enviar, no en borrador).

### De auditoría R152JJJJJJ (2026-06-10, ver docs/AUDITORIA_2026_06_10.md)
- [M] (1h) **[TECH] approval_rules.py GETs sin require_scope** (líneas 91, 119, 264): config de aprobaciones y matriz user×empresa visibles a cualquier autenticado. Decidir scope de lectura.
- [L] (30min) **[TECH] ordenes_compra_extract.py:198** — neto inverso (÷1.19) sin validar doc exento. Flujo de sugerencia IA, bajo riesgo.
- [L] (1h) **[TECH] edit-button size sm h-7 (28px)** < 44px touch target móvil. Subir a h-9 revisando layouts de tablas.
- [L] (15min) **[TECH] nubox_export_service.py:314** — UPDATE a SYNCED sin validar estado anterior (flujo solo-admin).

- [H] (2h) **[TECH] Endpoint `/admin/credentials/encrypt-helper`** para que el operador pueda cifrar passwords sin necesitar Python local. Útil para cargar credenciales Nubox manualmente sin CLI.
- [H] (3h) **[TECH] UI `/admin/incidents`** para ver `core.system_incidents` con filtros, acknowledge, resolve. Sin UI los incidentes quedan invisibles.
- [H] (4h) **[TECH] Slack/email notification** cuando se abre incident CRITICAL. Hoy se loguea en DB pero nadie se entera.
- [M] (4h) **[TECH] Migración a Supabase transaction pooler** (port 6543). Elimina riesgo EMAXCONNSESSION permanentemente, permite volver a workers=2 + pool_size=5.
- [M] (6h) **[TECH] Nubox API auto-sync cron** integrado al auto_sync_cron del Round 126. Hoy solo SII.
- [M] (8h) **[TECH] F22 anual** módulo (similar a F29 pero anual). Vence 30 abril.
- [M] (4h) **[TECH] DJ 1879 (honorarios) generación** automática. Vence 22 marzo.
- [M] (4h) **[TECH] DJ 1887 (sueldos) generación** automática. Vence 22 marzo.

## ✅ R152 — Gestión del Cambio + Presentación (DONE)

- [done 2026-05-31] R152t · NPS in-app + tabla user_feedback
- [done 2026-05-31] R152u · Mapa de Adopción (45 users clasificados)
- [done 2026-05-31] R152v · Centro de Aprendizaje + 5 módulos + quizzes
- [done 2026-05-31] R152w · Generador Rendiciones CORFO REVTECH/TRONGKAI
- [done 2026-05-31] R152x · UI bulk mapeo cuenta_local → CORFO
- [done 2026-05-31] R152y · Auto-sugerencia mapeo + Wire NPS transferencias
- [done 2026-05-31] R152z · Fix calendarios surfacing F22 (Renta)
- [done 2026-05-31] R152aa · Wire FeedbackPrompt + What's New + Badges
- [done 2026-05-31] R152bb · Charts dinámicos (AnimatedNumber, Sparkline, ChartCard, DonutKPI)
- [done 2026-05-31] R152cc · AdoptionQuadrant 4×3 grid en /admin/adopcion
- [done 2026-05-31] R152dd · Dashboard NPS para admin en /admin/feedback
- [done 2026-05-31] R152ff · 3 video scripts profesionales

## 🔁 Schedules persistentes activos (creados R152aa-gg)

- `ram-cehta-daily-health-check` — diario 7:17am · monitorea endpoints + reporta
- `ram-cehta-weekly-ux-audit` — lunes 9:23am · audit visual 1-2 pestañas
- `ram-cehta-video-tutorial-gen` — miércoles 10:19am · genera 1 video script
- `ram-cehta-platform-improvements` — viernes 9:11am · ejecuta 1 mejora del backlog

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
