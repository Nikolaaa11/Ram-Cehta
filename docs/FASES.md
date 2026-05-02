# Roadmap de Fases — Plataforma FIP CEHTA ESG

> Documento vivo. Última actualización: V4 fase 7 (mayo 2026).

Este documento describe el plan completo de la plataforma. Cada fase es
self-contained: se puede usar al cierre de cada una. La numeración refleja
la lógica del producto, no el calendario calendario calendario calendario.

---

## ✅ V1 — Fundamentos OC + pagos

**Objetivo:** trazabilidad básica de OCs y solicitudes de pago.

- Modelo de Empresas (RUTs, bancos, cuentas)
- OCs (orden de compra) con flujo de aprobación
- Solicitudes de pago referenciadas a OCs
- Auth con Supabase + roles básicos
- Lista de proveedores

---

## ✅ V2 — Portafolio + suscripciones

**Objetivo:** dar visibilidad del fondo y sus participaciones.

- Portafolio cross-empresa (CENERGY, RHO, CSL, TRONGKAI, REVTECH, DTE, EVOQUE, AFIS)
- Suscripciones de partícipes
- Movimientos bancarios manuales con conciliación
- Dashboards básicos

---

## ✅ V3 fase 1-7 — Operación expandida

- F29 mensual con cálculos PPM/IVA
- Contratos con vencimientos y alertas
- Dashboard CEO con KPIs cross-empresa
- Reportes (fondo, portafolio, suscripciones, tributario)
- Búsqueda global (Cmd+K command palette)

---

## ✅ V3 fase 8 — Notificaciones inbox

- Sistema de notificaciones con bell badge
- Bandeja con `read_at` por usuario
- Tipos: `f29_due`, `contrato_due`, `oc_pending`, `legal_due`, `system`, `mention`
- Idempotencia 24h por (user, entity, tipo)
- SSE realtime para refresco automático

---

## ✅ V4 fase 1-2 — Seguridad

- 2FA TOTP
- Audit log completo (quién, qué, cuándo, IP, before/after)
- Banner amarillo si admin sin 2FA

---

## ✅ V4 fase 3 — Mobile responsive

- `MobileLayoutShell` con drawer hamburger
- Sidebar oculto en `<md`, fixed header con menú
- Mismo comportamiento en desktop (md+) sin cambios

---

## ✅ V4 fase 4 — IA + onboarding

- Asistente AI (chat tipo Claude embebido)
- Tour de onboarding self-managed (auto-disparo en first login)
- Análisis automático con AI sobre archivos subidos

---

## ✅ V4 fase 5 — Cartas Gantt + movimientos avanzados

- Vista Cartas Gantt cross-empresa
- 5 KPIs: proyectos totales, en progreso, hitos cumplidos/total, riesgos abiertos, avance promedio
- Movimientos bancarios con conciliación masiva
- ⏳ Pendiente: adaptar al formato real de Gantt cuando Nicolás suba el suyo.

---

## ✅ V4 fase 6 — Entregables regulatorios

**Objetivo:** que ningún entregable al CMF/CORFO/UAF/SII se atrase nunca más.

- Tabla `app.entregables_regulatorios` con 34+ templates × 2 años = ~280 instancias
- Categorías: CMF, CORFO, UAF, SII, INTERNO, AUDITORIA, ASAMBLEA, OPERACIONAL
- Estados: pendiente / en_proceso / entregado / no_entregado
- Niveles de alerta calculados server-side: vencido / hoy / crítico (≤5d) / urgente (≤10d) / próximo (≤15d) / en_rango (≤30d) / normal
- Frecuencias: mensual, trimestral, semestral, anual, bienal, único, segun_evento
- 4 vistas: Agenda, Próximos, Mensual, Timeline
- Calendario con tabs Mes/Obligaciones + drawer con eventos + entregables del día
- Agente Secretaria — checklist de información requerida por cada template
- Reporte regulatorio imprimible para acta del Comité de Vigilancia
- Auto-generación próximo período al marcar recurrente entregado
- GitHub Action cron diario para `/inbox/generate-alerts`
- Badge sidebar con conteo de críticos en tiempo real

---

## 🔄 V4 fase 7 — Performance, filtros, lectura de archivos (ACTUAL)

**Objetivo:** que la plataforma sea rápida y que encontrar/abrir archivos sea trivial.

- Filtros avanzados en `/entregables` y `AgenteSecretaria`:
  - Búsqueda libre (nombre, descripción, notas, id_template, ref. normativa)
  - Por categoría (CMF/CORFO/UAF/...)
  - Por responsable (dropdown alimentado por endpoint `/facets`)
  - Por empresa (subcategoria o `extra.empresa_codigo`)
  - Por mes
- Endpoint backend `/entregables/facets` para alimentar dropdowns sin adivinar
- Endpoint backend `/entregables/critical-count` ligero para el badge sidebar
- Componente reutilizable `<FileLink>` que:
  - Detecta tipo (PDF, imagen, Excel, Word, carpeta)
  - Normaliza URLs Dropbox a `?dl=0` (preview, no descarga)
  - 3 variantes: chip, inline, card
- Memoización con `React.memo` en `EntregableCard`, `AgendaRow`, `SecretariaRow`
- Auto-extensión forward de templates recurrentes (cron mensual)
- `print:hidden` en sidebar y header → cualquier página es print-friendly

---

## 🔲 V4 fase 8 — Integración Dropbox automática

**Objetivo:** que los archivos del equipo aparezcan solos en la plataforma.

- Webhook Dropbox → tabla `app.dropbox_files` con metadata
- Auto-link de archivos a entregables matchando por nombre/path/fecha
- Vista "Archivos pendientes de clasificar" con sugerencias AI
- Preview inline de PDFs/imágenes (iframe + visor)
- Sincronización bidireccional: marcar entregado → subir adjunto a Dropbox
- ⏳ Bloqueo: necesita formato real de carpetas Dropbox del equipo

---

## 🔲 V4 fase 9 — ETL Nubox automático

**Objetivo:** importar la contabilidad sin tocar Nubox manualmente.

- Conector de scraping/API contra Nubox
- ETL diario que sincroniza cuentas, asientos, documentos
- Reconciliación automática con movimientos bancarios
- Generación automática de F29 partir de la contabilidad real

---

## 🔲 V5 — IA predictiva

**Objetivo:** la plataforma anticipa problemas antes que pasen.

- Alertas predictivas (falta de fondos, retrasos en empresas beneficiarias)
- Generación automática de actas para Comité de Vigilancia
- Resúmenes ejecutivos semanales/mensuales por email
- Agente que llena solicitudes de pago basado en facturas escaneadas
- Detección automática de anomalías en gastos del fondo

---

## Resumen visual

```
V1 ──► V2 ──► V3.1-7 ──► V3.8 ──► V4.1-2 ──► V4.3 ──► V4.4 ──► V4.5 ──► V4.6 ──► V4.7 ──► V4.8 ──► V4.9 ──► V5
                                                                               ▲
                                                                               │
                                                                               estamos acá
```

**Faltan 3 fases mayores (V4.8, V4.9) + V5** — la fase IA-driven cierra el roadmap.

---

## Cómo se actualizan los entregables

1. **Diariamente (12:30 UTC / 09:30 Chile)** — GitHub Action `daily-alerts.yml` corre `/inbox/generate-alerts` y refresca el badge sidebar.
2. **Mensualmente (1ro del mes, 13:00 UTC / 10:00 Chile)** — GitHub Action `monthly-extend-forward.yml` corre `/entregables/extend-forward` y genera el año siguiente si quedan ≤90 días de pipeline.
3. **Manual** — al marcar un entregable recurrente como "entregado", el backend crea automáticamente el del próximo período (con `ON CONFLICT DO NOTHING` para no duplicar).
4. **Vista "Reporte para acta CV"** — botón desde `/entregables` o URL directa `/entregables/reporte`. Imprimir / Exportar PDF para llevar a Comité de Vigilancia.
