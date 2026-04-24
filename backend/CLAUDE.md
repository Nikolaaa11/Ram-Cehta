# Cehta Capital — Backend

FastAPI + Postgres backend para la Plataforma Cehta Capital.

## Contexto maestro — LEER AL INICIO DE CADA SESIÓN

Este proyecto sigue estrictamente:
- `docs/claude-context/PROMPT_MAESTRO_CEHTA_v3.2.md` (arquitectura completa)
- `docs/claude-context/DISCIPLINAS_FE_BE.md` (las 5 disciplinas)
- `docs/claude-context/PLAN_PLATAFORMA_CEHTA.md` (roadmap por fases)

**IMPORTANT:** Si vas a escribir código sin haber leído esos 3 archivos en esta sesión, detente y léelos primero.

## Stack (no cambiar sin ADR)

- Python 3.12, FastAPI 0.115+, SQLAlchemy 2.x async + asyncpg
- Pydantic 2.x + pydantic-settings, Alembic (migraciones)
- argon2-cffi (passwords — NUNCA bcrypt), python-jose (JWT RS256)
- slowapi (rate limiting), structlog (logs JSON)
- docxtpl + LibreOffice headless (PDFs desde plantillas DOCX)
- pytest + pytest-asyncio + testcontainers-python (tests)
- ruff + mypy strict (lint + types)

## Comandos de verificación

Después de cada cambio relevante:
- `make lint` → ruff + mypy strict (ambos deben pasar)
- `make test` → pytest con cobertura mínima (domain 85%, services 80%, api 70%)
- `make migrate` → aplica migraciones Alembic
- `make openapi` → regenera openapi.json (se commitea)
- `make dev` → levanta backend en localhost:8000

## Estructura

```
app/
├── domain/          entidades + value objects (sin I/O)
├── services/        casos de uso
├── infrastructure/  repos SQLAlchemy, PDF, storage
└── api/v1/          routers FastAPI
```

## Reglas específicas del backend

- **YOU MUST** incluir `allowed_actions: list[str]` en todos los DTOs de response (disciplina 3)
- **YOU MUST** retornar datos pre-calculados, nunca crudos para que el FE compute (disciplina 2)
- **YOU MUST** validar todas las reglas de dominio aquí (disciplina 4) — el frontend NO valida negocio
- Value objects para tipos del dominio chileno: `Rut`, `MontoCLP`, `MontoUF`, `Periodo`
- IVA = 19% centralizado en `app/domain/value_objects/iva.py` (nunca hardcoded en múltiples lugares)

## Prohibido

- `bcrypt` para hashing (usar `argon2id`)
- SQL por concatenación de strings (siempre parametrizado vía SQLAlchemy)
- Loggear RUTs completos, tokens, passwords, montos individuales de usuarios específicos
- Commitear secretos o `.env` con valores reales
- Endpoints mutadores sin auth explícita
- Queries N+1 (usar `selectinload` / `joinedload`)

## Workflow git

- Rama `main` protegida, merges vía PR con CI verde
- Ramas feature: `feat/fase-X-{modulo}`
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
- Cada sesión termina con commit + push + PR
