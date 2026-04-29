"""Tests para los schemas de operaciones bulk.

Foco en validaciones de borde — bounds (1..200 ids), estados vacíos,
serialización del result con failed items.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.bulk import (
    BulkDeleteRequest,
    BulkItemError,
    BulkUpdateEstadoRequest,
    BulkUpdateResult,
)


class TestBulkUpdateEstadoRequest:
    def test_minimo_un_id(self) -> None:
        req = BulkUpdateEstadoRequest(ids=[1], estado="pagada")
        assert req.ids == [1]
        assert req.estado == "pagada"

    def test_lista_vacia_falla(self) -> None:
        with pytest.raises(ValidationError):
            BulkUpdateEstadoRequest(ids=[], estado="pagada")

    def test_mas_de_200_falla(self) -> None:
        with pytest.raises(ValidationError):
            BulkUpdateEstadoRequest(ids=list(range(1, 202)), estado="pagada")

    def test_estado_vacio_falla(self) -> None:
        with pytest.raises(ValidationError):
            BulkUpdateEstadoRequest(ids=[1], estado="")

    def test_200_es_el_maximo_aceptado(self) -> None:
        req = BulkUpdateEstadoRequest(ids=list(range(1, 201)), estado="x")
        assert len(req.ids) == 200


class TestBulkDeleteRequest:
    def test_uno_aceptado(self) -> None:
        BulkDeleteRequest(ids=[42])

    def test_mismo_techo_que_update(self) -> None:
        with pytest.raises(ValidationError):
            BulkDeleteRequest(ids=list(range(1, 202)))


class TestBulkUpdateResult:
    def test_serializa_sin_fails(self) -> None:
        r = BulkUpdateResult(
            operation="update_estado",
            requested=10,
            succeeded=10,
            failed=[],
        )
        d = r.model_dump()
        assert d["requested"] == 10
        assert d["succeeded"] == 10
        assert d["failed"] == []

    def test_serializa_con_fails(self) -> None:
        r = BulkUpdateResult(
            operation="update_estado",
            requested=3,
            succeeded=1,
            failed=[
                BulkItemError(id=2, detail="not found"),
                BulkItemError(id=3, detail="sin permiso"),
            ],
        )
        d = r.model_dump()
        assert d["succeeded"] == 1
        assert len(d["failed"]) == 2
        assert d["failed"][0]["id"] == 2
        assert d["failed"][0]["detail"] == "not found"

    def test_operation_solo_acepta_literales(self) -> None:
        with pytest.raises(ValidationError):
            BulkUpdateResult(
                operation="bogus",  # type: ignore[arg-type]
                requested=1,
                succeeded=0,
                failed=[],
            )
