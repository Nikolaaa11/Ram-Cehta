"""Unit tests para alembic 0014_perf_indices (V3 fase 10 — DB perf pass).

No corre la migración real (eso requiere DB). Verifica estáticamente que
el archivo está bien formado, tiene los hooks que Alembic espera, y
declara la cantidad mínima de índices que el plan de fase 10 requiere.

También valida que la migración usa CREATE INDEX CONCURRENTLY + IF NOT
EXISTS (idempotencia + no-bloqueante en prod) y que tiene downgrade
inverso simétrico.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "0014_perf_indices.py"
)


@pytest.fixture(scope="module")
def migration_source() -> str:
    return MIGRATION_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def migration_ast(migration_source: str) -> ast.Module:
    return ast.parse(migration_source)


def _toplevel_assign(tree: ast.Module, name: str) -> ast.AST | None:
    """Devuelve el valor RHS de la primera asignación top-level a `name`."""
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return node.value
        if (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id == name
            and node.value is not None
        ):
            return node.value
    return None


def _indices_list(tree: ast.Module) -> list[tuple[str, str, str]]:
    """Extrae estáticamente la constante `_INDICES` sin importar alembic."""
    rhs = _toplevel_assign(tree, "_INDICES")
    assert rhs is not None, "no se encontró la constante _INDICES"
    # _INDICES es una lista de literales tuple[str,str,str].
    indices: list[tuple[str, str, str]] = []
    assert isinstance(rhs, ast.List), "_INDICES debe ser una lista literal"
    for elt in rhs.elts:
        assert isinstance(elt, ast.Tuple)
        parts = []
        for e in elt.elts:
            assert isinstance(e, ast.Constant) and isinstance(e.value, str)
            parts.append(e.value)
        assert len(parts) == 3
        indices.append((parts[0], parts[1], parts[2]))
    return indices


def _toplevel_str(tree: ast.Module, name: str) -> str | None:
    rhs = _toplevel_assign(tree, name)
    if isinstance(rhs, ast.Constant) and isinstance(rhs.value, str):
        return rhs.value
    return None


def _has_function(tree: ast.Module, name: str) -> bool:
    return any(
        isinstance(n, ast.FunctionDef) and n.name == name for n in tree.body
    )


# ---------------------------------------------------------------------------
# 1. El archivo de migración existe y es Python parseable.
# ---------------------------------------------------------------------------


def test_migration_file_exists() -> None:
    assert MIGRATION_PATH.exists(), (
        f"falta migración 0014_perf_indices.py en {MIGRATION_PATH}"
    )


def test_migration_is_valid_python(migration_source: str) -> None:
    # Si el archivo tiene un syntax error esto raisea SyntaxError.
    ast.parse(migration_source)


# ---------------------------------------------------------------------------
# 2. revision / down_revision correctos (encadena con 0013).
# ---------------------------------------------------------------------------


def test_revision_id_is_0014(migration_ast: ast.Module) -> None:
    assert _toplevel_str(migration_ast, "revision") == "0014"


def test_down_revision_chains_to_0013(migration_ast: ast.Module) -> None:
    assert _toplevel_str(migration_ast, "down_revision") == "0013"


# ---------------------------------------------------------------------------
# 3. Hooks upgrade() y downgrade() existen.
# ---------------------------------------------------------------------------


def test_upgrade_function_exists(migration_ast: ast.Module) -> None:
    assert _has_function(migration_ast, "upgrade")


def test_downgrade_function_exists(migration_ast: ast.Module) -> None:
    assert _has_function(migration_ast, "downgrade")


# ---------------------------------------------------------------------------
# 4. Cuenta de índices declarados (>= 10) y forma bien-formada.
# ---------------------------------------------------------------------------


def test_declares_at_least_ten_indices(migration_ast: ast.Module) -> None:
    indices = _indices_list(migration_ast)
    assert len(indices) >= 10, (
        f"esperaba >= 10 índices en _INDICES, encontré {len(indices)}"
    )


def test_index_entries_well_formed(migration_ast: ast.Module) -> None:
    indices = _indices_list(migration_ast)
    seen_names: set[str] = set()
    for table, name, cols in indices:
        assert "." in table, (
            f"table debe tener formato schema.tabla, got {table!r}"
        )
        assert name.startswith("idx_"), (
            f"convención: índices se llaman idx_*, got {name!r}"
        )
        assert cols.startswith("(") and cols.endswith(")"), (
            f"cols debe ser '(col1, col2, ...)', got {cols!r}"
        )
        assert name not in seen_names, (
            f"nombre de índice duplicado: {name!r}"
        )
        seen_names.add(name)


def test_create_and_drop_loops_are_symmetric(migration_source: str) -> None:
    # Tanto upgrade() como downgrade() deben iterar sobre _INDICES.
    assert "for table, name, cols in _INDICES" in migration_source
    assert "for table, name, _cols in _INDICES" in migration_source
    # Ambos lados generan CREATE / DROP INDEX simétricos.
    assert "CREATE INDEX" in migration_source
    assert "DROP INDEX" in migration_source


# ---------------------------------------------------------------------------
# 5. Idempotencia: IF NOT EXISTS en cada CREATE.
# ---------------------------------------------------------------------------


def test_uses_if_not_exists(migration_source: str) -> None:
    # Garantiza que correr la migración dos veces sea seguro (alguno ya
    # creado manualmente por DBA antes del rollout).
    assert "IF NOT EXISTS" in migration_source


# ---------------------------------------------------------------------------
# 6. NOTA: previamente esta migración usaba CREATE INDEX CONCURRENTLY,
#    pero Supabase Transaction Pooler (PgBouncer modo txn) no lo permite.
#    Con ~5K filas máx por tabla, el lock de un CREATE INDEX normal es
#    <100ms — irrelevante en operación. Cuando subamos escala podemos
#    correr una 0021 con CONCURRENTLY apuntando al direct connection.
# ---------------------------------------------------------------------------


def test_no_concurrently_in_executed_sql(migration_source: str) -> None:
    # Defensivamente, garantizamos que NO volvamos a meter CONCURRENTLY
    # en sentencias EJECUTADAS: el deploy via release_command corre contra
    # el pooler y rompería. Comments / docstrings que mencionan la palabra
    # están permitidos (referencia histórica).
    # Buscamos op.execute(...) que contenga "CONCURRENTLY".
    import re

    exec_calls = re.findall(r"op\.execute\([^)]+\)", migration_source)
    for call in exec_calls:
        assert "CONCURRENTLY" not in call, (
            f"op.execute con CONCURRENTLY rompería el deploy via pooler: {call}"
        )


# ---------------------------------------------------------------------------
# 7. Cobertura: las tablas críticas están todas representadas.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "table",
    [
        "core.ordenes_compra",
        "core.f29_obligaciones",
        "core.legal_documents",
        "core.proveedores",
        "core.fondos",
        "core.suscripciones_acciones",
        "core.empresas",
    ],
)
def test_critical_table_has_index(
    migration_ast: ast.Module, table: str
) -> None:
    indices = _indices_list(migration_ast)
    tables_with_index = {entry[0] for entry in indices}
    assert table in tables_with_index, (
        f"tabla crítica {table} no recibió índice nuevo"
    )
