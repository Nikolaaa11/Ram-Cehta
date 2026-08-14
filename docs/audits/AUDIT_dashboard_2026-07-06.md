# Audit: `/dashboard` · 2026-07-06

> Auditor: `ram-cehta-weekly-ux-audit` (run automático semanal).
> Archivo revisado: `frontend/app/(app)/dashboard/page.tsx` (187 líneas, server component) + `dashboard/loading.tsx`.
> Backend cruzado: `backend/app/api/v1/dashboard.py`.
> **Solo diagnóstico** — no se modificó código. Nicolás decide qué implementar.

## Resumen

El dashboard es un server component **sólido**: server-fetch con manejo de error,
empty-state de bienvenida cuando el ETL nunca corrió, `loading.tsx` con skeleton,
lazy-load de `ChartsGrid` (recharts ~80kB below-the-fold), y `ErrorBoundary` +
`Suspense` alrededor de cada widget client. La arquitectura de carga es ejemplar.

El hallazgo grave no es de estructura sino **funcional**: el control de período del
header (`PeriodoFilter`) no afecta nada en toda la página. Es un control prominente
que miente.

---

## Findings

### F1 · El filtro de período (`PeriodoFilter`) está completamente muerto · P1
**Tipo**: bug
**Esfuerzo**: M (4h) si se implementa · S (1h) si se quita
**Severidad**: P1 (bloqueante de confianza — control visible que no hace nada)

> ✅ **RESUELTO 2026-08-14 (R152kk)** — se tomó la **Opción A (implementar)**, no la B.
> `from`/`to` (YYYY-MM) los aceptan ahora `/kpis`, `/cashflow`, `/iva-trend`,
> `/egresos-por-concepto` y `/proyectos-ranking`. En `/kpis` la ventana elegida se
> compara contra la anterior **del mismo largo** (12 meses vs los 12 previos), y las
> etiquetas del front dejan de decir "del mes" cuando el rango no es un mes
> (`lib/dashboard/periodo-range.ts`). Saldos, OCs y F29 quedaron fuera del rango a
> propósito: son fotos del presente, no series. El resto del finding queda como
> registro de por qué se hizo.

`PeriodoFilter` (en `DashboardHeader`) escribe `?from=YYYY-MM&to=YYYY-MM` en la URL
vía `router.replace` (ver `use-dashboard-filters.ts`). `page.tsx:55-61` lee esos
params y los reenvía a `/dashboard/kpis?from=…&to=…`. **Pero ningún endpoint del
dashboard acepta `from`/`to`**:

- `get_kpis` (`dashboard.py:351`) solo firma `empresa_codigo`; usa `current_periodo()`
  hardcodeado (mes actual vs mes anterior). Ignora `from`/`to` en silencio (FastAPI
  descarta query params no declarados).
- `get_cashflow` (`:501`), `get_iva_trend` (`:739`) usan `meses: int` — no `from`/`to`.
- `get_egresos_por_concepto` (`:599`), `get_proyectos_ranking` (`:802`) — sin ventana de fecha.

Resultado: elegir "Este mes", "YTD", "Últimos 3 meses" o un rango custom **cambia la
URL pero no cambia ni una cifra** en KPIs ni en los 4 gráficos. Para un dashboard
institucional que ven directores y LPs, un filtro de fecha que no filtra es un
problema de credibilidad.

> Nota: es el ítem `[L]` del BACKLOG ("Filtro de período del dashboard (from/to) no lo
> consume ningún endpoint"), pero la severidad real es mayor — sube a P1 porque es
> visible en el primer render y engaña sobre datos financieros.

**Decisión implementar-o-quitar** (regla §5.4 del MAESTRO: no dejar controles rotos):
- **Opción A (implementar)**: mapear `from`/`to` (YYYY-MM) a una ventana en cada
  endpoint. Los charts ya tienen `meses` — convertir `from/to` → `meses` es directo:
  `meses = diff_en_meses(from, to)`. Para `get_kpis`, comparar el período `to` vs el
  anterior en vez de `current_periodo()` fijo.
- **Opción B (quitar)**: reemplazar `PeriodoFilter` (rangos libres) por un simple
  selector de presets que solo emita `meses=3|12|24` — que los endpoints **sí** aceptan.
  Menos esfuerzo, honesto con lo que el backend soporta hoy.

Recomendación: **Opción B** ahora (1h, honesto) y A como item de BACKLOG si algún
director pide rango libre.

---

### F2 · El filtro por empresa aplica solo a una parte de la página · P3
**Tipo**: nice-to-have
**Esfuerzo**: M (4h)
**Severidad**: P3 (mejora — inconsistencia visual, no rompe datos)

`empresa_codigo` **sí** lo respeta `get_kpis` (fix R152UUUUUU) y lo consumen vía
`useDashboardFilters`: KPI hero, KPI secundario, Cashflow, Egresos, IVA trend,
Proyectos ranking, Saldos. **No** lo consumen: `MiDiaWidget`, `PipelineRegulatorio`,
`VouchersKpiStrip`, `AiDataQAWidget`, `MiSemanaWidget`, `ComplianceLeaderboard`.

Al filtrar por, ej., TRONGKAI, media página se filtra y la otra media sigue mostrando
el fondo completo, sin señal visual de qué está en scope. Algunos widgets son
legítimamente personales/globales (Mi día, Pipeline regulatorio) — pero el usuario no
lo sabe.

Sugerencia: cuando hay `empresa` activa, mostrar un banner sutil "Mostrando: TRONGKAI"
y atenuar (o rotular "vista global") los widgets que ignoran el filtro.

---

### F3 · Error state sin botón de reintento y sin header · P2
**Tipo**: bug / nice-to-have
**Esfuerzo**: S (1h)
**Severidad**: P2 (importante — un 500 transitorio deja al usuario sin salida)

`page.tsx:75-88`: si `/dashboard/kpis` falla, se renderiza un `Surface` rojo con el
mensaje de error, pero:
- **No hay botón "Reintentar"** — el usuario tiene que recargar el browser a mano.
- **No renderiza `DashboardHeader`** (el empty-state en `:91-98` sí lo hace) →
  inconsistente, y pierde el acceso a navegación/estado ETL.
- El `Surface` no tiene `role="alert"` → screen readers no lo anuncian.

Sugerencia: extraer un pequeño client component `DashboardErrorState` con botón que
haga `router.refresh()`, `role="alert"`, y mantener el `DashboardHeader` arriba como
en el empty-state.

```tsx
// esbozo
<div className="…">
  <DashboardHeader lastEtlRun={null} etlStatus={kpis?.etl_status ?? null} />
  <Surface role="alert" className="border-negative/20 …">
    <Surface.Title className="text-negative">No se pudo cargar el dashboard</Surface.Title>
    <Surface.Subtitle>{fetchError}</Surface.Subtitle>
    <RetryButton /> {/* client: onClick={() => router.refresh()} */}
  </Surface>
</div>
```

---

### F4 · Skeletons sin semántica de accesibilidad · P3
**Tipo**: accessibility
**Esfuerzo**: S (1h)
**Severidad**: P3

`loading.tsx` y los fallbacks inline (`page.tsx:22-30, 136, 143, 155, 162`) son divs
`animate-pulse` sin `aria-busy` ni texto para lector de pantalla. Un usuario con SR
escucha silencio durante la carga.

Sugerencia: envolver el skeleton raíz con `aria-busy="true"` + un
`<span className="sr-only">Cargando dashboard…</span>`.

---

### F5 · 401 en idle no redirige a login (cross-ref BACKLOG) · P2
**Tipo**: bug
**Esfuerzo**: M (2h)
**Severidad**: P2

Ya está en BACKLOG (`[M] 401 no centralizado en GETs de solo-lectura`). Se confirma
para el dashboard: si la sesión expira estando quieto en la pantalla, los GET de los
widgets client caen en `ErrorState` sin `handleSessionExpired`. Mitigado por redirect
server-side en cada navegación. Fix correcto: `onError` global en el QueryClient
(`providers.tsx`). No es hallazgo nuevo — se referencia para completitud.

---

### F6 · Verificar tooltips / animaciones / empty-state de los charts · P3
**Tipo**: nice-to-have
**Esfuerzo**: S (1h) para verificar
**Severidad**: P3

Los 4 gráficos viven en `ChartsGrid` (fuera de `page.tsx`). Pendiente de auditar en
una ronda futura: confirmar que cada recharts tiene `<Tooltip>`, animación de entrada,
y empty-state propio cuando el endpoint devuelve `[]` (ej. empresa sin movimientos).
Se deja anotado, no auditado en profundidad esta semana.

---

## Veredicto

Arquitectura de carga y estados: **excelente**. El bloqueante es **F1** — decidir
implementar-o-quitar el `PeriodoFilter` esta semana. **F3** (retry en error) es la
segunda prioridad. El resto son mejoras incrementales.
