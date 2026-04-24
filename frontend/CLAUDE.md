# Cehta Capital — Frontend

Next.js 15 + TypeScript frontend para la Plataforma Cehta Capital.

## Contexto maestro — LEER AL INICIO DE CADA SESIÓN

- `docs/claude-context/PROMPT_MAESTRO_CEHTA_v3.2.md` (arquitectura completa)
- `docs/claude-context/DISCIPLINAS_FE_BE.md` (las 5 disciplinas — **CRÍTICO**)
- `docs/claude-context/PLAN_PLATAFORMA_CEHTA.md` (roadmap)

**IMPORTANT:** Las 5 disciplinas son ley inquebrantable en este repo.

## Las 5 disciplinas (resumen)

Antes de escribir cualquier componente, verifica:

1. **No constantes de dominio en frontend**: ❌ `const IVA = 0.19`, ❌ array de empresas, ❌ umbrales
2. **Backend retorna datos listos**: si necesitas sumar/filtrar/reducir datos de negocio → es bug, va al backend
3. **Backend dicta permisos**: usa `allowed_actions` del response, NUNCA `if (user.role === 'admin')`
4. **Validación de dominio en backend**: el frontend solo valida formato (required, email shape). RUT mod-11 va al endpoint `/api/validate/rut`
5. **Tipos TS auto-generados**: `npm run gen:types` los genera desde `../cehta-backend/openapi.json`. Nunca los escribas a mano.

## Stack

- Next.js 15 (App Router, Server Components por defecto)
- TypeScript 5 strict
- Tailwind CSS 4 + shadcn/ui (componentes copiados, no librería)
- TanStack Query v5 (cache + invalidación)
- React Hook Form + Zod (**solo validación de formato UX, NUNCA reglas de negocio**)
- Lucide React (iconos), Recharts (gráficos)
- Playwright (E2E)

## Comandos de verificación

- `npm run lint` → eslint (debe pasar)
- `npm run typecheck` → tsc sin emit (debe pasar)
- `npm run gen:types` → regenera `types/api.ts`
- `npm run test` → vitest (snapshots + unit)
- `npm run e2e` → Playwright
- `npm run build` → build producción (debe pasar sin warnings)

## Estructura

```
app/               rutas (pantallas son thin: fetch + render)
components/
  ui/              shadcn primitivos
  dashboard/       específicos de dashboard
  oc/              específicos de OC
  shared/          DataTable, ErrorBoundary, etc.
lib/
  api/             cliente tipado + hooks TanStack Query
  format.ts        SOLO i18n (toCLP, toUF, toDate)
types/
  api.ts           AUTO-GENERADO desde OpenAPI — no editar
```

## Patrón por pantalla

```tsx
// app/(app)/dashboard/page.tsx
export default async function DashboardPage() {
  const data = await api.getDashboard()  // server-side fetch
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        {data.kpis.map(kpi => <KpiCard key={kpi.id} {...kpi} />)}
      </div>
      <FlowChart {...data.flow_chart} />
    </div>
  )
}
```

## Prohibido (viola las 5 disciplinas)

- `const IVA = 0.19` o cualquier constante numérica de negocio
- Arrays hardcoded de empresas, conceptos, bancos
- `if (user.role === 'admin')` o similar (usa `allowed_actions`)
- `validateRutMod11()`, `calcularIVA()`, `computeTotal()` en frontend
- Tipos TS escritos a mano de shapes que el backend retorna
- `.reduce()` / `.filter()` sobre datos del backend para cálculos (solo para UI display)
- `dangerouslySetInnerHTML` sin sanitización

## Workflow git

- Rama `main` protegida, merges vía PR con CI verde
- Ramas feature: `feat/fase-3-{pantalla}`
- Commits: conventional commits
- **Antes de PR**: `npm run gen:types && git add types/api.ts && git commit`
- **Custom command**: `/check-disciplinas` antes de cada PR

## Accesibilidad

- WCAG 2.1 AA mínimo
- Lighthouse ≥ 90 en todas las categorías
- Navegación completa por teclado
- Labels en todos los inputs con `aria-describedby` para errores
