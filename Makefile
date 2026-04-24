.PHONY: help dev lint test openapi gen-types backend-dev frontend-dev \
        backend-lint frontend-lint backend-test frontend-test \
        backend-install frontend-install install clean

help:
	@echo "Ram-Cehta — comandos disponibles:"
	@echo ""
	@echo "  make install       Instala dependencias de backend y frontend"
	@echo "  make dev           Levanta backend (:8000) y frontend (:3000) en paralelo"
	@echo "  make lint          ruff + mypy + eslint + tsc"
	@echo "  make test          pytest + vitest"
	@echo "  make openapi       Regenera backend/openapi.json"
	@echo "  make gen-types     Regenera frontend/types/api.ts desde openapi.json"
	@echo "  make clean         Limpia caches, node_modules, .venv"

install: backend-install frontend-install

backend-install:
	cd backend && python -m venv .venv && . .venv/Scripts/activate && pip install -e ".[dev]"

frontend-install:
	cd frontend && npm install

dev:
	@echo "Iniciando backend y frontend en paralelo. Ctrl+C para detener."
	@(cd backend && . .venv/Scripts/activate && uvicorn app.main:app --reload --port 8000) & \
	 (cd frontend && npm run dev) & \
	 wait

backend-dev:
	cd backend && . .venv/Scripts/activate && uvicorn app.main:app --reload --port 8000

frontend-dev:
	cd frontend && npm run dev

lint: backend-lint frontend-lint

backend-lint:
	cd backend && . .venv/Scripts/activate && ruff check . && ruff format --check . && mypy app

frontend-lint:
	cd frontend && npm run lint && npm run typecheck

test: backend-test frontend-test

backend-test:
	cd backend && . .venv/Scripts/activate && pytest --cov=app --cov-report=term-missing

frontend-test:
	cd frontend && npm run test -- --run

openapi:
	cd backend && . .venv/Scripts/activate && python -c "import json; from app.main import app; print(json.dumps(app.openapi(), indent=2))" > openapi.json
	@echo "Generated: backend/openapi.json"

gen-types: openapi
	cd frontend && npm run gen:types
	@echo "Generated: frontend/types/api.ts"

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".mypy_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
	rm -rf backend/.venv frontend/node_modules frontend/.next
