# Audit defaults de React Query — 2026-05-31

## TL;DR

✅ Los defaults globales **ya están correctos** en `components/providers.tsx`.
Las 119 `useQuery` simples + 17 `useApiQuery` heredan automáticamente.

## Defaults globales (QueryClient en `providers.tsx`)

```typescript
defaultOptions: {
  queries: {
    staleTime: 2 * 60 * 1000,   // 2 minutos
    gcTime: 10 * 60 * 1000,     // 10 minutos en cache antes de garbage-collect
    refetchOnWindowFocus: false, // no refetch al cambiar tab
    retry: 1,                    // 1 reintento ante error
  },
},
```

## Comportamiento por defecto

- Cambiar tab del browser y volver: NO refetch ✅
- Volver a la misma página dentro de 2min: NO refetch ✅
- Volver a la misma página dentro de 10min: cache HIT (data instant) ✅
- Error de red: 1 reintento automático ✅

## Páginas con override explícito (y por qué)

| Página | staleTime | Razón |
|---|---|---|
| `/aprobaciones` | 30s | Queue operativa, debe estar fresca |
| `/vouchers` | 30s | Listado principal, refresh post-aprobación |
| `/sii` dashboard | 2min | Sync SII es manual, no necesita tiempo real |
| `/admin/adopcion` | 5min | Datos institucionales, cambian lentamente |
| `/admin/feedback` | 5min | Idem |
| `/dashboard/directorio/*` (8 lugares) | 5min | KPIs del fondo, datos lentos |
| `/dashboard/inversionistas` | 5min | Idem |
| `/reportes/contables/aging` | 5min | Reporte, datos lentos |
| Catálogos (empresas, plan-cuentas) | 30min | Datos ~estáticos (cambia ~1/año) |

## Cambio en `useApiQuery`

Antes (R152ww) tenía `staleTime: 30s` hardcoded — **forzaba override al global de 2min**.
Ahora (R152ccc) elimino el hardcoded — hereda el default del QueryClient.

Resultado: `useApiQuery` ahora respeta el global de 2min por defecto, pero
puede ser sobrescrito vía el 4to parámetro `opts`.

## Próximas optimizaciones de queries (out of scope este round)

- Prefetch en hover de cards/links que llevan a páginas con queries pesadas
- Mutaciones con `optimistic update` para vouchers/firma (UI responde antes que el backend)
- SSE para invalidar queries específicas en tiempo real (algunas ya están vía mailbox.received)
