# Ram-Cehta — Contexto raíz para Claude Code

Monorepo de la **Plataforma Cehta Capital** (FIP CEHTA ESG + portfolio). Dos sub-proyectos:

- [`backend/`](backend/CLAUDE.md) — FastAPI, Python 3.12, SQLAlchemy async
- [`frontend/`](frontend/CLAUDE.md) — Next.js 15, TypeScript strict

## LEER ANTES DE ESCRIBIR CÓDIGO

1. [`docs/claude-context/PROMPT_MAESTRO_CEHTA_v3.2.md`](docs/claude-context/PROMPT_MAESTRO_CEHTA_v3.2.md) — arquitectura y reglas
2. [`docs/claude-context/DISCIPLINAS_FE_BE.md`](docs/claude-context/DISCIPLINAS_FE_BE.md) — 5 disciplinas inquebrantables
3. [`docs/claude-context/PLAN_PLATAFORMA_CEHTA.md`](docs/claude-context/PLAN_PLATAFORMA_CEHTA.md) — roadmap por fases

Al entrar al sub-proyecto correspondiente, leer también su `CLAUDE.md`.

## Las 5 disciplinas (resumen)

1. **No constantes de dominio en frontend** — IVA, empresas, umbrales viven en backend.
2. **Backend retorna datos listos** — nada de `.reduce()`/`.filter()` sobre datos de negocio en FE.
3. **Backend dicta permisos** — cada response incluye `allowed_actions: list[str]`.
4. **Validaciones de negocio SIEMPRE en backend** — FE valida solo formato UX.
5. **Tipos TS generados desde OpenAPI** — `npm run gen:types`, nunca escribir a mano.

## Estructura del monorepo

```
Ram-Cehta/
├── backend/              ← FastAPI
├── frontend/             ← Next.js 15
├── db/                   ← schema.sql, views.sql, rls.sql para Supabase
├── docs/
│   ├── claude-context/   ← contexto maestro (no editar salvo mejoras intencionales)
│   └── adr/              ← Architecture Decision Records
├── .github/workflows/    ← CI
├── Makefile              ← delega a backend/ y frontend/
└── docker-compose.yml    ← Postgres local (opcional, default es Supabase)
```

## Workflow estándar de sesión

1. Leer los 3 archivos de `docs/claude-context/` si es sesión nueva.
2. Leer el `CLAUDE.md` del sub-proyecto (backend o frontend).
3. Crear rama `feat/fase-X-{modulo}` desde `main`.
4. Implementar + tests.
5. `make lint && make test` verde.
6. `make openapi && make gen-types` si tocaste endpoints.
7. Commit con conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
8. Push y abrir PR.

## Fase actual

Ver el último commit y `docs/claude-context/PLAN_PLATAFORMA_CEHTA.md`.

## Reglas inquebrantables

Las 12 reglas de [PROMPT_MAESTRO_CEHTA_v3.2.md](docs/claude-context/PROMPT_MAESTRO_CEHTA_v3.2.md) aplican. Especial énfasis:

- Nunca commitear secretos (`.env` en `.gitignore`).
- RUT, IVA, UF, F29 con constantes chilenas no negociables.
- argon2id para passwords (nunca bcrypt).
- Queries parametrizadas (nunca concatenación).
- RLS activo en todas las tablas `core.*`.
