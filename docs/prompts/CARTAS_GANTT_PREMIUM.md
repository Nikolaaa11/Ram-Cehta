# Master Prompt — Cartas Gantt Premium + Secretaria AI

> **Cuándo usarlo:** copiar este prompt como brief inicial para una nueva sesión de Claude / agente / dev humano que vaya a reconstruir `/cartas-gantt` y agregar la "Secretaria AI" de tareas.
>
> **Resultado esperado:** transformar la actual lista colapsada (que con 2.900 hitos es ruido) en una experiencia premium tipo Linear + Asana + Notion, con AI que prioriza qué hacer hoy.

---

## 🎯 Contexto del sistema (no negociable)

Sos un senior fullstack engineer trabajando en la plataforma interna de **Cehta Capital** — un fondo de inversión chileno (FIP CEHTA ESG) que administra 9 empresas en portafolio: AFIS, CENERGY, CSL, DTE, EVOQUE, FIP_CEHTA, REVTECH, RHO, TRONGKAI.

**Stack:**
- Frontend: Next.js 15.5 App Router + TypeScript strict + Tailwind CSS + TanStack Query v5 + lucide-react. `typedRoutes: true` (cuidado con redirect/Link). Convención: componentes en `frontend/components/`, hooks en `frontend/hooks/`, schemas API en `frontend/lib/api/schema.ts`.
- Backend: FastAPI 0.115 + SQLAlchemy 2.x async + asyncpg + Pydantic v2. Convención: routers en `backend/app/api/v1/{recurso}.py`, schemas en `backend/app/schemas/{recurso}.py`, models en `backend/app/models/`, services en `backend/app/services/`.
- AI: Anthropic SDK con tool calling y streaming SSE. Soft-fail si la API key no está (devolvés 503, frontend oculta el componente).
- DB: Postgres con schema `core.proyectos_empresa` (proyectos), `core.hitos` (hitos/tareas), `core.riesgos`. FK cascade en hitos→proyecto.
- Auth: Supabase + RBAC scopes (`avance:read`, `avance:create`, `avance:update`, `avance:delete`).
- UI: tema Cehta — colors `cehta-green`, `ink-{50..900}`, `positive`, `negative`, `warning`, `info`. Componentes base: `<Surface>`, `<Badge>`, `<Combobox>`, `<Dialog>`, `<Skeleton>`. Tipografía `font-display` (Inter semibold), `tabular-nums` para números/fechas.

**Datos disponibles** (después de correr `/avance/sync-all-from-dropbox`):
- 46 proyectos en 5 empresas (RHO, TRONGKAI, EVOQUE, DTE, REVTECH).
- ~2.900 hitos con: `nombre`, `estado` (`pendiente|en_progreso|completado|cancelado`), `fecha_planificada`, `fecha_completado`, `progreso_pct`, `descripcion`, `proyecto_id`. El `encargado` quedó en metadata del parser pero NO está en columna — agregarlo si lo necesitás (migración trivial).
- 4 empresas sin Gantt aún (AFIS, CENERGY, CSL, FIP_CEHTA).

**Endpoint de proyectos hoy:** `GET /avance/{empresa_codigo}/proyectos` devuelve `ProyectoListItem[]` con hitos embebidos.

---

## 👤 Persona usuario

**Nicolás Rietta** — operativo en Cehta Capital, no-ingeniero. Lee el dashboard 5–10 veces/día. Lo que necesita:

1. **"Qué hago HOY"** — los 3-5 hitos más urgentes priorizados por AI.
2. **"Qué se vence esta semana"** — vista rápida de las tareas con fecha cercana.
3. **"Quién está atrasado"** — top 3 encargados con más vencidas.
4. **"Cómo voy en cada empresa"** — % avance, riesgos, tendencia.
5. **Edición ultra-rápida** — un click para marcar completado / mover fecha. Cero modales innecesarios.

**Anti-patrones que odia:** scroll infinito, listas planas con 100 ítems, esperar 3s para que cargue, modales que tapan el contexto.

---

## 🎨 Inspiración visual

- **Linear** — timeline + cycle view, atajos `g+letra`, comando `cmd+k`.
- **Asana** — swimlane Kanban "Today / This week / Later".
- **Notion** — calendar mensual con chips de colores.
- **Things 3** — secretaria de tareas con "Today" priorizada.
- **Apple HIG** — rounded `2xl`, glass surfaces, hairline borders, generous whitespace.

---

## 📦 Entregables

### A) Backend — 3 endpoints + 1 schema migration

#### A.1 Migration: agregar `encargado` a `core.hitos`

Archivo: `backend/migrations/versions/V4_xxxxxx_hito_encargado.sql`

```sql
ALTER TABLE core.hitos ADD COLUMN encargado TEXT;
CREATE INDEX idx_hitos_encargado ON core.hitos(encargado) WHERE encargado IS NOT NULL;
CREATE INDEX idx_hitos_fecha_planificada ON core.hitos(fecha_planificada) WHERE estado IN ('pendiente', 'en_progreso');
```

Actualizá `models/proyecto.py` + `schemas/avance.py` + el parser `gantt_parser_service.py` para persistir `encargado` en columna (hoy queda solo en `ParsedHito` interno).

#### A.2 `GET /avance/portfolio/upcoming-tasks`

Buckets temporales cross-empresa.

**Query params:**
- `empresa` (opcional, filtro por código)
- `encargado` (opcional, filtro por email/nombre)
- `dias_proximos` (default 14)

**Response shape (Pydantic):**

```python
class UpcomingTasksResponse(BaseModel):
    vencidas: list[HitoConContexto]
    hoy: list[HitoConContexto]
    esta_semana: list[HitoConContexto]
    proximas_2_semanas: list[HitoConContexto]
    sin_fecha: list[HitoConContexto]
    stats: UpcomingStats

class HitoConContexto(BaseModel):
    hito_id: int
    nombre: str
    estado: str
    fecha_planificada: date | None
    progreso_pct: int
    encargado: str | None
    dias_hasta_vencimiento: int  # negativo si vencida
    proyecto_id: int
    proyecto_nombre: str
    empresa_codigo: str
    empresa_razon_social: str

class UpcomingStats(BaseModel):
    total_pendientes: int
    vencidas_count: int
    completadas_ultima_semana: int
    owners_top: list[OwnerCount]  # top 5 con más pendientes
    empresas_top: list[EmpresaCount]  # top 5 con más activos
```

**Implementación:** una sola query SQL con `CASE WHEN fecha_planificada < CURRENT_DATE THEN 'vencidas'...` y agrupación. Cap 200 ítems por bucket (paginar si hace falta).

**Cache:** 5 min (`Cache-Control: max-age=300`).

#### A.3 `GET /avance/portfolio/timeline?from=YYYY-MM-DD&to=YYYY-MM-DD`

Para el componente TimelineGantt.

**Query params:**
- `from`, `to` (default: hoy → +6 meses)
- `empresas` (opcional, lista de códigos comma-separated)
- `incluir_completados` (default false)

**Response:** `TimelinePortfolioResponse` con jerarquía `empresas[].proyectos[].hitos[]` cuyos hitos caen total o parcialmente dentro del rango. Incluí `min_fecha` y `max_fecha` por proyecto.

#### A.4 `POST /ai/secretaria-tareas` (streaming SSE)

**Service nuevo:** `backend/app/services/secretaria_ai_service.py`

System prompt:
```
Sos "Claudia", la secretaria de proyectos de Cehta Capital. Tu rol es darle a
Nicolás un brief de prioridades del día en MENOS de 80 palabras. Tono: cálido,
directo, accionable. Lenguaje: castellano chileno-rioplatense formal.

Datos que recibís:
- Tareas vencidas (con dueño, días de atraso)
- Tareas de hoy
- Tareas de esta semana
- Riesgos abiertos críticos
- Tendencia: completados última semana vs anterior

Output: 5 bullets máximo. Cada bullet:
- Empieza con un verbo de acción ("Revisar", "Llamar a", "Validar")
- Si nombrás persona: nombre + apellido + empresa
- Si nombrás fecha: relativa ("mañana", "viernes")
- Si es URGENTE, prefijo "🚨"

Nunca: explicar tu razonamiento, listar todos los hitos, repetir lo que ya hizo.
```

Context que mandás a Claude: salida del endpoint A.2 (resumida), riesgos abiertos, completados última semana.

**Cache:** 30 min en backend (key = hash de los datos input).

#### A.5 `PATCH /avance/hitos/{hito_id}/quick` — endpoint optimizado para edits inline

Acepta `{estado?: string, progreso_pct?: int, fecha_planificada?: date, encargado?: str}` y devuelve el hito actualizado. Single endpoint para todas las quick actions del frontend (no tener que hacer 4 PATCH distintos).

---

### B) Frontend — 6 componentes + 1 hook

#### B.1 `<SecretariaPanel>` — banner sticky en top de `/cartas-gantt`

```tsx
// frontend/components/cartas-gantt/SecretariaPanel.tsx
"use client";

interface Props {
  className?: string;
}

// - Avatar generado (puede ser un círculo con la "C" en cehta-green)
// - Nombre "Claudia · Tu secretaria de proyectos"
// - Subtítulo con timestamp del último update
// - 5 bullets con jerarquía visual (URGENTE en negative, normal en ink-700)
// - Botón "Refrescar" + "Ver todas las tareas" (link a Kanban)
// - Loading state: shimmer skeleton de 5 líneas
// - Error state: oculta el banner (soft-fail si Anthropic key falta = 503)
// - Auto-refresh cada 1 hora (staleTime: 60 * 60 * 1000)
// - Variant "compact" para sidebars
```

Streaming visual: a medida que llegan tokens del SSE, el bullet se va escribiendo letra por letra (typewriter effect, optional pero choca).

#### B.2 `<UpcomingTasksKanban>` — vista swimlane

4 columnas con drag-and-drop:

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│  VENCIDAS 12 │   HOY 3      │ ESTA SEM 18  │ PRÓXIMAS 24  │
│  (rojo pulse)│  (cehta-grn) │  (info azul) │  (ink-400)   │
├──────────────┼──────────────┼──────────────┼──────────────┤
│ [TaskCard]   │ [TaskCard]   │ [TaskCard]   │ [TaskCard]   │
│ [TaskCard]   │ [TaskCard]   │ ...          │ ...          │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

**TaskCard** (en cada columna):
- Header: `EmpresaLogo` (24px) + código empresa (badge mono) + estado dot
- Título del hito (truncate 2 lines)
- Footer: encargado (avatar+nombre) + fecha relativa (`hace 3 días` / `en 2 días`) + progress bar fina
- Hover: aparecen quick actions (✓ completar, 📅 reasignar, 👤 cambiar enc.)
- Click: drawer lateral con detalle completo + comentarios (opcional fase 2)
- Drag a otra columna: cambia `fecha_planificada` automáticamente (a fin de bucket destino)

**Filtro top-right:**
- Combobox: Todas / Mías / Críticas / Por empresa (multi-select)
- Search inline para filtrar por texto (Cmd+K)

**Mobile:** una sola columna a la vez con tabs arriba (no swimlane lateral).

**Optimistic updates:** cuando marcás completado, la card se mueve a "completadas" inmediatamente y se devuelve si falla la API. TanStack Query `onMutate` + `onError` rollback.

#### B.3 `<TimelineGantt>` — Gantt horizontal

Implementación recomendada: `frappe-gantt` (vanilla JS, ~30KB) wrappeado en componente React, o impl propia si querés control fino. **No usar** `react-gantt` (deprecated).

Layout:
```
┌─────────────────────────────────────────────────────┐
│ Empresa │ Proyecto         │ May  │ Jun  │ Jul  │   │
├─────────┼──────────────────┼──────┼──────┼──────┼───┤
│ RHO     │ PANIMÁVIDA       │ ████████░░░░░░░░     │ │ ← bar
│         │   ↳ SAC          │     ◆               │ │ ← hito (diamond)
│         │   ↳ Acceso       │       ◆             │ │
│ DTE     │ La Serena ZU-18  │  ████████████░░░    │ │
└─────────────────────────────────────────────────────┘
                       ↑ hoy (línea vertical roja)
```

- Eje X: scroll horizontal, ticks por semana en zoom alto, por mes en zoom bajo
- Eje Y: empresas colapsables, proyectos como filas, hitos como diamantes (◆) sobre la barra del proyecto
- Color de barra: gradient según `progreso_pct` (verde de 0% a `progreso_pct`%, gris del resto)
- Tooltip on hover: nombre proyecto, fecha inicio/fin, progreso, hitos count
- Click en barra → drawer con `<HitoChecklist>` del proyecto
- Línea vertical roja = hoy (con label "Hoy")
- Vencidas: barra completa en rojo claro

Controles top:
- Zoom: día / semana / mes / trimestre
- Ir a hoy
- Filtro empresa multi-select
- Toggle "Mostrar completados"

**Performance:** virtualizar si hay >30 filas (intersection observer). Solo renderizar las barras dentro del viewport.

#### B.4 `<CalendarHitos>` — vista calendario mensual

Reusá `<Calendar>` ya existente en `/calendario` (es un FullCalendar wrapper) si lo tenés. Si no, impl simple con grid 7×N.

- Mes actual + 1 mes adelante en pestañas
- Cada día: hasta 4 chips de hitos visibles, "+N más" link
- Color del chip: por empresa (asignar 9 colores, ej: RHO=cyan, DTE=indigo, etc.)
- Hoy: ring `cehta-green`
- Click en día → modal con todos los hitos de ese día agrupados por empresa
- Click en chip → quick edit popover

#### B.5 `<TaskQuickActions>` — popover con acciones inline

Trigger: hover sobre cualquier `<TaskCard>` o ítem de hito en cualquier vista.

Acciones (todas con keyboard shortcut):
- `c` → Marcar completado (icono ✓, optimistic)
- `e` → Editar fecha planificada (date picker inline)
- `o` → Cambiar encargado (combobox de trabajadores activos)
- `n` → Agregar nota rápida (textarea inline, persiste en `descripcion`)
- `b` → Reportar bloqueo → crea automáticamente un `Riesgo` con severidad alta vinculado al proyecto

Implementación: usar `<Popover>` de Radix. Posicionar `right-0 top-0` cuando aparece on hover.

#### B.6 `<EmpresaProgressTrend>` — sparkline mini + delta

Para mostrar en el header de cada empresa en `/cartas-gantt`:

```
┌─────────────────────────────────────┐
│ 🟢 RHO       42%   ▁▂▃▅▆▆▇  +5pts  │ ← sparkline 7 puntos (últimos 7 días)
│              avg progreso           │
└─────────────────────────────────────┘
```

Datos: pull `progreso_pct` snapshot por empresa en los últimos 7 días desde `audit_log` o un nuevo endpoint `GET /avance/{cod}/progreso-historico?dias=7`.

Si no hay snapshots aún (es nuevo), mostrar placeholder "—" sin romper.

---

#### B.7 Hook `useUpcomingTasks` — composable para todas las vistas

```ts
// frontend/hooks/use-upcoming-tasks.ts
export function useUpcomingTasks(filters?: Partial<UpcomingTasksFilters>) {
  return useApiQuery<UpcomingTasksResponse>(
    ["avance", "upcoming-tasks", filters],
    `/avance/portfolio/upcoming-tasks?${qs.stringify(filters)}`,
    { staleTime: 5 * 60 * 1000 }
  );
}
```

Reusable por SecretariaPanel, Kanban, Calendar.

---

### C) Página `/cartas-gantt` — rediseño

```tsx
// frontend/app/(app)/cartas-gantt/page.tsx
export default function CartasGanttPage() {
  const [view, setView] = useUrlState<"timeline" | "kanban" | "calendar">("view", "kanban");
  return (
    <div className="space-y-4">
      {/* Header con KPIs + sync + filtros — preservar lo que ya tenés */}
      <CartasGanttHeader />

      {/* NUEVO: Secretaria AI sticky */}
      <SecretariaPanel />

      {/* NUEVO: Tabs de vistas */}
      <ViewSwitcher value={view} onChange={setView} />

      {/* Vista activa */}
      <Suspense fallback={<SkeletonView />}>
        {view === "timeline" && <TimelineGantt />}
        {view === "kanban" && <UpcomingTasksKanban />}
        {view === "calendar" && <CalendarHitos />}
      </Suspense>
    </div>
  );
}
```

**URL state:** `?view=kanban&empresa=RHO,DTE&encargado=felipe@dte.cl` (compartible y bookmarkeable).

---

### D) Diseño visual (no negociable)

| Elemento | Spec |
|---|---|
| Border radius | `rounded-2xl` cards, `rounded-xl` botones, `rounded-md` badges |
| Padding | `p-4` cards, `p-2` chips, `px-4 py-2` botones |
| Shadow | `shadow-card` default, `shadow-card-hover` on hover |
| Border | `border border-hairline` (gris muy suave) |
| Tipografía | Inter (font-display semibold para títulos), 14px base, `tabular-nums` en counts |
| Glass | `<Surface variant="glass">` para Secretaria y header |
| Animaciones | `transition-colors duration-150 ease-apple` por defecto |
| Estados | hover `bg-ink-50`, active `bg-ink-100`, focus `ring-2 ring-cehta-green` |

**Color por estado de hito:**
- `completado` — `bg-positive/10 text-positive` + ✓
- `en_progreso` — `bg-info/10 text-info` + animación spinner sutil
- `pendiente` — `bg-ink-100 text-ink-600`
- `cancelado` — `bg-ink-100 text-ink-400 line-through`
- `vencida` (calculado por fecha) — `bg-negative/10 text-negative` + animación pulse

**Color por empresa:** asignar paleta de 9 colores distinguibles (no random, mantener consistencia entre vistas):
```ts
const EMPRESA_COLOR: Record<string, string> = {
  RHO: "#06b6d4",      // cyan
  TRONGKAI: "#8b5cf6",  // purple
  EVOQUE: "#10b981",   // emerald
  DTE: "#6366f1",      // indigo
  REVTECH: "#f59e0b",  // amber
  AFIS: "#ec4899",     // pink
  CENERGY: "#84cc16",  // lime
  CSL: "#0ea5e9",      // sky
  FIP_CEHTA: "#64748b", // slate
};
```

---

### E) Performance (presupuesto)

- LCP `/cartas-gantt` < 1.5s en cache hit, < 3s en cache miss
- Bundle size delta < 80KB gzip (lazy load timeline + calendar)
- API endpoint upcoming-tasks < 300ms p95
- AI Secretaria endpoint < 4s p95 (es Anthropic, asumimos latencia)
- Optimistic update en mark-complete: 0 latencia visible

---

### F) Accesibilidad

- Todos los buttons con `aria-label`
- Drag-and-drop con keyboard alternative (selecciona card con space, mueve con arrow + space para soltar)
- Foco visible en cada elemento interactivo
- Color no es el único indicador de estado (siempre + icono o texto)
- `prefers-reduced-motion` respetado (animaciones se desactivan)

---

### G) Edge cases que SÍ tenés que manejar

| Caso | Comportamiento esperado |
|---|---|
| Sin Gantts importados (DB vacía) | Empty state con CTA al sync (ya existe) |
| Anthropic key no configurada | SecretariaPanel se oculta, no rompe |
| Hito sin `fecha_planificada` | Bucket "Sin fecha" en Kanban, oculto en Calendar/Timeline |
| Empresa sin hitos | Oculta de Timeline, mostrar en empty state debajo "Empresas sin Gantt: AFIS, CSL..." con CTA |
| Hito vencido por años (typo) | Ya filtrado por sanidad de fechas en parser (2020-2035) |
| Mobile (<768px) | Solo Kanban (timeline horizontal no funciona, calendar reducido) |
| Usuario sin permiso `avance:update` | Quick actions deshabilitadas, solo lectura |
| Drag fallido (network error) | Rollback visual + toast con "Reintentar" |

---

### H) Atajos de teclado

| Shortcut | Acción |
|---|---|
| `g t` | Cambiar a Timeline |
| `g k` | Cambiar a Kanban |
| `g c` | Cambiar a Calendar |
| `r` | Refrescar AI Secretaria |
| `j` / `k` | Navegar entre TaskCards |
| `c` | Marcar TaskCard activo como completado |
| `e` | Editar fecha del activo |
| `?` | Mostrar overlay de shortcuts |

Reutilizá el hook `usePageShortcuts` que ya existe.

---

### I) Métricas de éxito (cómo medir si esto funcionó)

Después de 1 semana en producción, debés poder responder SÍ a:

1. **Time-to-priorities < 3s.** Desde landing en `/cartas-gantt`, el usuario ve sus 5 prioridades del AI sin scroll.
2. **Mark-complete = 1 click.** Hover + click en ✓ marca el hito y la card desaparece de "Hoy" sin abrir modal.
3. **Adopción.** Logging muestra que el CEO entra a `/cartas-gantt` >= 3 veces/semana.
4. **AI quality.** En 80% de las refrescadas, los 5 bullets son accionables (no genéricos como "revisá tus tareas").
5. **Performance.** Lighthouse > 90 en performance, > 95 en a11y.

---

## 🚀 Plan de implementación sugerido (4 sprints de 1-2 días)

### Sprint 1 — Backend foundation
1. Migration `encargado` + indexes
2. Endpoint `upcoming-tasks` con tests
3. Endpoint `quick-edit` con tests
4. Service `secretaria_ai_service.py` con prompt + cache

### Sprint 2 — Vista Kanban (MVP visible)
1. `<UpcomingTasksKanban>` con 4 columnas
2. `<TaskCard>` con quick actions on hover
3. `<TaskQuickActions>` popover
4. Drag-and-drop con optimistic updates
5. Wireup en `/cartas-gantt` con tab switcher

### Sprint 3 — Secretaria AI + Calendar
1. `<SecretariaPanel>` con streaming SSE
2. Streaming visual (typewriter optional)
3. `<CalendarHitos>` mes actual + siguiente
4. Filtros URL state

### Sprint 4 — Timeline Gantt + polish
1. `<TimelineGantt>` con frappe-gantt o impl
2. Zoom + scroll horizontal
3. Drawer detalle proyecto
4. `<EmpresaProgressTrend>` sparkline
5. Atajos teclado finales

---

## ❓ Preguntas que tenés que responder ANTES de empezar

1. **¿`encargado` se setea via columna o queda en `metadata_`?** Recomendado: columna (más rápido para queries y UI).
2. **¿Streaming SSE en SecretariaPanel o respuesta completa?** Streaming da mejor UX (typewriter), pero respuesta completa es más simple. Recomendado: completa fase 1, streaming fase 2.
3. **¿Drag-and-drop con `@dnd-kit/core` o `react-dnd`?** Recomendado: `@dnd-kit` (más ligero, mejor a11y).
4. **¿Los 9 colores de empresa van en Tailwind config o como inline?** Recomendado: extender `tailwind.config.ts` con `colors.empresa.{rho,dte,...}` así son utilities (`bg-empresa-rho`).
5. **¿Persistir el view tab elegido en preferencias del user o solo URL?** Recomendado: ambos (URL para compartir, prefs para default al volver).

---

## 🛡 Lo que NO tenés que hacer

- **No reinventes** el Kanban: usá `@dnd-kit/sortable` o similar.
- **No agregues** features no listadas (foco en lo que pidió el usuario).
- **No rompas** la página actual mientras desarrollás (feature flag o branch).
- **No mandes** todos los hitos al AI (solo el resumen estructurado del endpoint A.2 para evitar tokens excesivos).
- **No cachees** el AI por más de 1 hora (los datos cambian todo el día).

---

## ✅ Definición de Done

- Usuario abre `/cartas-gantt` y en <3s ve los 5 bullets del AI Secretaria con sus prioridades del día.
- Las tres vistas (Timeline / Kanban / Calendar) son switcheables sin reload, URL state, deep-linkable.
- Quick actions inline en hover funcionan con 1 click + optimistic update.
- 5 atajos de teclado funcionan documentados en `?`.
- Lighthouse perf > 90, a11y > 95.
- Build pasa lint + tsc + tests.
- PR creado contra `main` con screenshots y video del flow completo.
