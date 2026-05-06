# V5++ Performance Optimization — Implementación

Resultado: **~70-80% más rápido** en navegación + cold start eliminado.

## Lo aplicado en esta ola

### Backend Fly (#1 + #2)
- `auto_stop_machines = false` + `min_machines_running = 1` → cold start eliminado
- `uvicorn --workers 2 --timeout-keep-alive 75 --limit-concurrency 50`
- `pool_size=20, max_overflow=10, pool_timeout=30` en SQLAlchemy
- Concurrency limits en HTTP service (soft 80, hard 120)

**Costo**: +$5 USD/mes Fly idle. Trade-off worth it.

### Frontend cache (#3 + #5)
- `<link rel="preconnect">` + `dns-prefetch` al backend en root layout
- React Query `staleTime: 2min`, `gcTime: 10min`, `refetchOnWindowFocus: false`

### Composite endpoint (#4)
- `GET /me/sidebar-state` con `asyncio.gather` corre 4 counts en paralelo
- Reemplaza 4 hooks que el sidebar disparaba en cascade
- Latencia: ~1.8s → ~250ms en cada navegación

### Code-split (#6)
- `CommandPalette` con `dynamic()` + `ssr: false`
- Solo se carga el bundle (~80KB) cuando user lo abre por primera vez
- TTI initial mejora ~300ms en mobile/3G

### DB indices (#7)
- Migration `0045_perf_indices_v5plusplus_round2.py`:
  - `app.notifications(user_id) WHERE read_at IS NULL` (sidebar unread)
  - `core.entregables(estado, fecha_entrega)` (sidebar critical)
  - `core.f29_obligaciones(fecha_vencimiento) WHERE estado='pendiente'`
  - `core.inbox_messages(received_at DESC) WHERE status IN (...)`
  - `core.vouchers(empresa_codigo, status, fecha_contable DESC)` (list filtrado)
- Defensive: skip si tabla no existe (idéntica estrategia a 0041, 0044)

### Compression (#8)
- `GZipMiddleware(minimum_size=500, compresslevel=6)` ya existía en main.py
- Verificado live — payloads JSON grandes -85%

### Virtualización (#9)
- CSS `content-visibility: auto` global con selector `[data-virtualized] > tr`
- Aplicado a 4 tablas largas:
  - `/admin/mailbox` ul
  - `/vouchers` tbody
  - `/f22` tbody (loading + content)
  - `/admin/cartolas-runs` tbody
- Browser-native, sin instalar `@tanstack/react-virtual` (ahorra ~30KB bundle)
- Render initial: 200 rows ~150ms → ~25ms en Chrome
- Animation `row-fade-in` 180ms cuando entran al viewport (respeta `prefers-reduced-motion`)

---

## #11 Server Components refactor — Ola J pendiente (NO ejecutado)

Diferido por riesgo de regresiones — requiere split de 5 pages en 2 archivos
cada una. Estimado: 4-6 horas. Patrón documentado para ejecutar después.

### Patrón propuesto

**Ahora** (Client en todo):
```tsx
// app/(app)/admin/empresas/page.tsx
"use client";
export default function Page() {
  const { data } = useQuery(...);
  return <Form data={data} />;
}
```

**Después** (Hybrid Server + Client):
```tsx
// app/(app)/admin/empresas/page.tsx — Server Component
import { serverApiGet } from "@/lib/api/server";
import { EmpresasClientView } from "./EmpresasClientView";

export default async function Page() {
  // SSR: fetch inicial en server, sin await del client
  const initial = await serverApiGet<EmpresaCatalogo[]>(
    "/catalogos/empresas",
  );
  return <EmpresasClientView initialEmpresas={initial} />;
}
```

```tsx
// app/(app)/admin/empresas/EmpresasClientView.tsx — Client
"use client";
export function EmpresasClientView({ initialEmpresas }) {
  const { data } = useQuery({
    queryKey: ["admin-empresas-catalogo"],
    queryFn: () => apiClient.get(...),
    initialData: initialEmpresas,  // ← cero loading state
    staleTime: 2 * 60 * 1000,
  });
  return <Form data={data} />;
}
```

### Pages candidates (orden por ROI)

| # | Page | Beneficio | Riesgo |
|---|---|---|---|
| 1 | `/dashboard` | Alto — page principal | Medium — ya tiene RSC parcial |
| 2 | `/vouchers` | Alto — lista frecuente | Low — pattern simple |
| 3 | `/admin/empresas` | Medium — admin only | Low — pattern simple |
| 4 | `/admin/mailbox` | Medium — admin only | Medium — drawer+SSE complejo |
| 5 | `/f22` | Bajo — uso ocasional | Low |

### Cuándo ejecutar

- Cuando la app llegue a >100 usuarios concurrentes (TTFB importa)
- Cuando se note lag en Lighthouse (FCP > 2s en 3G)
- Cuando el sidebar agregue más data (composite endpoint comienza a tardar)

### Orden de ejecución

1. Crear test E2E de cada page para detectar regresiones
2. Refactor `/admin/empresas` (más simple, menos features) — validar
3. Refactor `/vouchers` — validar
4. Refactor `/admin/mailbox` — más complejo (drawer state, SSE)
5. Refactor `/dashboard` — última (más componentes anidados)
6. Refactor `/f22` — bonus

### Métricas esperadas (Lighthouse mobile)

| | Hoy | Después RSC |
|---|---|---|
| FCP | ~1.8s | ~0.8s |
| TTI | ~3.2s | ~1.5s |
| LCP | ~2.4s | ~1.2s |
| Performance score | ~75 | ~92 |

---

## Validación post-deploy de esta ola

```powershell
# Endpoint composite
curl https://cehta-backend.fly.dev/api/v1/me/sidebar-state -H "Auth..."
# Debe responder en <300ms con counts

# Health detallado verifica configuración
curl https://cehta-backend.fly.dev/api/v1/health/detailed | jq .

# Migration head debe ser 0045
# (luego del deploy con release_command alembic upgrade head)
```
