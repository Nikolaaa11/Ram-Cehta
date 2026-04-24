## Resumen
Qué cambia y por qué.

## Checklist antes de pedir review
- [ ] `make lint` verde (ruff + mypy + eslint + tsc)
- [ ] `make test` verde (pytest + vitest)
- [ ] Si toqué endpoints: `make openapi && make gen-types` corrido y `frontend/types/api.ts` commiteado
- [ ] Las 5 disciplinas respetadas (ver `docs/claude-context/DISCIPLINAS_FE_BE.md`)
- [ ] No hay secretos en el diff

## Disciplinas FE/BE
- [ ] **D1** — Ninguna constante de dominio nueva en frontend
- [ ] **D2** — Frontend no hace `.reduce()/.filter()` sobre datos de negocio
- [ ] **D3** — Endpoints mutadores devuelven `allowed_actions`
- [ ] **D4** — Validaciones de dominio viven en backend
- [ ] **D5** — `frontend/types/api.ts` sincronizado con `backend/openapi.json`

## Contexto
Issue / ADR relacionado:
