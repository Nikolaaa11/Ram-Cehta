.PHONY: install dev lint format test migrate openapi clean

install:
	python -m venv .venv
	. .venv/Scripts/activate && pip install --upgrade pip && pip install -e ".[dev]"

dev:
	. .venv/Scripts/activate && uvicorn app.main:app --reload --port 8000

lint:
	. .venv/Scripts/activate && ruff check . && ruff format --check . && mypy app

format:
	. .venv/Scripts/activate && ruff format . && ruff check --fix .

test:
	. .venv/Scripts/activate && pytest --cov=app --cov-report=term-missing

migrate:
	. .venv/Scripts/activate && alembic upgrade head

makemigration:
	. .venv/Scripts/activate && alembic revision --autogenerate -m "$(m)"

openapi:
	. .venv/Scripts/activate && python -c "import json; from app.main import app; print(json.dumps(app.openapi(), indent=2))" > openapi.json

clean:
	rm -rf .venv .pytest_cache .mypy_cache .ruff_cache .coverage htmlcov dist build
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
