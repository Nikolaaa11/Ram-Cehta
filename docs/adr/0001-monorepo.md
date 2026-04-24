# 0001 — Monorepo en lugar de dos repos

**Fecha:** 2026-04-24
**Estado:** Aceptado

## Contexto

El Playbook del kit de Cehta Capital asume dos repos separados (`cehta-backend` y `cehta-frontend`). Nikola prefirió usar un solo repo (`Ram-Cehta`) para todo.

## Decisión

Monorepo con `backend/` y `frontend/` como carpetas hermanas. Sin Turborepo/Nx — basta con un `Makefile` raíz que delegue.

## Alternativas consideradas

- **Dos repos separados** (como dice el playbook): más simple conceptualmente, pero duplica CI, dificulta cambios cross-cutting (ej. modificar un endpoint y su uso en FE en el mismo PR), y requiere coordinación extra para mantener `frontend/types/api.ts` sincronizado.
- **Turborepo/Nx**: overkill para dos proyectos de este tamaño.

## Consecuencias

- Cambios que tocan backend + frontend caben en un solo PR (bueno).
- CI tiene que filtrar por paths para no correr todo en cada push (`paths` en workflows).
- El workflow `openapi-sync` se vuelve trivial: corre en el mismo repo.
- `frontend/types/api.ts` se genera desde `../backend/openapi.json` (path relativo dentro del mismo checkout).
- Las 5 disciplinas siguen igual de vigentes — la separación es lógica, no física.
