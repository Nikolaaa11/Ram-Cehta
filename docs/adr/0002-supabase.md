# 0002 — Supabase como base de datos y autenticación

**Fecha:** 2026-04-24
**Estado:** Aceptado

## Contexto

El `PLAN_PLATAFORMA_CEHTA.md` contempla Supabase en Fase 1. Nikola confirmó: proyecto `dqwwqfhzejscgcynkbip` (org "Nikolaaa11's Org", nombre "RAM Consulting") en región `us-east-2` (no São Paulo — esto es lo que Supabase asignó al proyecto existente).

## Decisión

- **Base de datos**: Supabase Postgres (pooler Transaction en puerto 6543 para el backend).
- **Auth**: Supabase Auth (ahorra 3-5 días vs auth propia; trade-off aceptado en el plan).
- **Storage**: Supabase Storage para PDFs de OC.
- **RLS**: activo en todas las tablas `core.*` desde el commit inicial.

## Alternativas consideradas

- **Postgres self-hosted en VPS Hostinger** (opción anterior en memoria del proyecto): Nikola descartó vía mensaje explícito "quiero utilizar supabase".
- **Auth propia con JWT + argon2**: más control, pero 3-5 días extra en Fase 2 que no justifican el retorno en el MVP.
- **Región São Paulo**: el plan sugería menor latencia desde Chile, pero el proyecto ya estaba creado en `us-east-2`. Diferencia perceptual para el equipo de <5 personas: negligible. Se evalúa migrar si el P95 de latencia >300ms.

## Consecuencias

- El backend usa `asyncpg` contra el pooler Transaction (puerto 6543).
- El frontend usa `@supabase/ssr` para auth (sesión en cookies httpOnly via Next.js middleware).
- Se reemplaza JWT "propio" del Prompt Maestro v3.2 por el de Supabase — los roles RBAC se mapean a claims personalizadas de Supabase Auth.
- Migraciones SQL se aplican vía Alembic (no via Supabase CLI) para mantener el flujo del plan.
- Región `us-east-2`: latencia desde Chile ~150-180ms (aceptable para app administrativa).
