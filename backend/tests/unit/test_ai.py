"""Unit tests del módulo AI Asistente (V3 fase 3).

No tocan red ni DB — sólo lógica pura: chunking, vector literal serialization,
build_context, y RBAC scopes.
"""
from __future__ import annotations

import pytest

from app.core.rbac import scopes_for
from app.services.ai_chat_service import build_context
from app.services.ai_embedding_service import vector_literal
from app.services.ai_indexing_service import chunk_text


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def test_chunk_text_short_returns_single_chunk() -> None:
    text_in = "Hola mundo."
    out = chunk_text(text_in, chunk_size=1000, overlap=200)
    assert out == ["Hola mundo."]


def test_chunk_text_empty_returns_empty_list() -> None:
    assert chunk_text("") == []
    assert chunk_text("   \n  ") == []


def test_chunk_text_splits_long_input() -> None:
    long = ("Lorem ipsum dolor sit amet.\n\n" * 200).strip()
    chunks = chunk_text(long, chunk_size=500, overlap=100)
    assert len(chunks) > 1
    # Cada chunk respeta el max + tolerancia (corte por separador puede dejar < size)
    for c in chunks:
        assert len(c) <= 500


def test_chunk_text_prefers_paragraph_break() -> None:
    text_in = "Primer parrafo importante.\n\nSegundo parrafo del documento.\n\nTercero."
    chunks = chunk_text(text_in, chunk_size=40, overlap=5)
    # Debería al menos producir múltiples chunks y que el primero termine al
    # final de un párrafo en lugar de partir una palabra al medio.
    assert len(chunks) >= 2
    assert chunks[0].endswith(".")


# ---------------------------------------------------------------------------
# Vector literal serialization (pgvector input format)
# ---------------------------------------------------------------------------


def test_vector_literal_format() -> None:
    out = vector_literal([0.1, 0.2, -0.3])
    assert out.startswith("[")
    assert out.endswith("]")
    parts = out.strip("[]").split(",")
    assert len(parts) == 3
    assert parts[0].startswith("0.1")


def test_vector_literal_empty() -> None:
    assert vector_literal([]) == "[]"


# ---------------------------------------------------------------------------
# Context building
# ---------------------------------------------------------------------------


def test_build_context_no_chunks_returns_friendly_message() -> None:
    out = build_context([])
    assert "No hay" in out


def test_build_context_includes_source_and_content() -> None:
    chunks = [
        {"source_id": "contrato.pdf", "source_path": "/x/contrato.pdf", "content": "Cláusula 1: X"},
        {"source_id": "f29.xlsx", "source_path": "/x/f29.xlsx", "content": "IVA débito 100"},
    ]
    out = build_context(chunks)
    assert "contrato.pdf" in out
    assert "f29.xlsx" in out
    assert "Cláusula 1: X" in out


# ---------------------------------------------------------------------------
# RBAC — V3 fase 3 scopes
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("role", ["admin", "finance", "viewer"])
def test_all_roles_can_chat(role: str) -> None:
    assert "ai:chat" in scopes_for(role)
    assert "ai:read" in scopes_for(role)


def test_only_admin_can_index() -> None:
    assert "ai:index" in scopes_for("admin")
    assert "ai:index" not in scopes_for("finance")
    assert "ai:index" not in scopes_for("viewer")
