# Ram-Cehta — Plataforma Cehta Capital

Monorepo de la plataforma administrativa-financiera del FIP CEHTA ESG.

- `backend/` — FastAPI + SQLAlchemy async + Supabase Postgres
- `frontend/` — Next.js 15 + TypeScript + Supabase Auth
- `db/` — Schema, vistas y políticas RLS para Postgres/Supabase
- `docs/claude-context/` — Prompt maestro, disciplinas FE/BE y plan de plataforma
- `.github/workflows/` — CI de backend y frontend

## Stack

Python 3.12 · FastAPI · SQLAlchemy 2 async · Supabase Postgres + Auth · Next.js 15 · TypeScript strict · TanStack Query · Tailwind + shadcn/ui.

## Principio rector

Este repo aplica estrictamente las **5 disciplinas** de separación frontend/backend documentadas en [docs/claude-context/DISCIPLINAS_FE_BE.md](docs/claude-context/DISCIPLINAS_FE_BE.md). Antes de tocar código, léelas.

## Setup rápido (primera vez)

Requisitos: Python 3.12+, Node 20+, Docker Desktop (opcional para DB local).

```bash
# 1. Clonar
git clone https://github.com/Nikolaaa11/Ram-Cehta.git
cd Ram-Cehta

# 2. Configurar variables locales (NO commitear)
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
# Editar ambos .env con credenciales de Supabase

# 3. Backend
cd backend
python -m venv .venv
source .venv/Scripts/activate    # Windows Git Bash
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload

# 4. Frontend (en otra terminal)
cd frontend
npm install
npm run gen:types
npm run dev
```

Backend en http://localhost:8000 (docs en `/docs`). Frontend en http://localhost:3000.

## Comandos frecuentes

Desde la raíz, con `make`:

```bash
make dev          # Backend + Frontend en paralelo (requiere GNU Make)
make lint         # ruff + mypy + eslint + tsc
make test         # pytest backend + vitest frontend
make openapi      # Regenera backend/openapi.json
make gen-types    # Regenera frontend/types/api.ts desde openapi.json
```

## Despliegue

- Base de datos + Auth + Storage: **Supabase** (proyecto `dqwwqfhzejscgcynkbip`)
- Backend: Fly.io (pendiente Fase 4)
- Frontend: Vercel (pendiente Fase 4)

Detalles en [docs/claude-context/PLAN_PLATAFORMA_CEHTA.md](docs/claude-context/PLAN_PLATAFORMA_CEHTA.md) (Fase 4).

## Documentación

- [CLAUDE.md](CLAUDE.md) — instrucciones para trabajar con Claude Code en este repo
- [docs/claude-context/](docs/claude-context/) — contexto maestro del proyecto
- [docs/adr/](docs/adr/) — Architecture Decision Records
