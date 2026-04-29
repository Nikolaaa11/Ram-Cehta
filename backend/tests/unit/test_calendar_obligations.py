"""Unit tests para el calendario unificado de obligaciones (V3 fase 9).

Cubre:
  * Helpers puros: `_compute_days_until`, `_classify_severity`,
    `_parse_plazo_pago_days`, `_build_obligation`.
  * Severity en boundaries (-1, 0, 7, 8).
  * Schema `ObligationItem` (validación + composición de `id`).
  * Filtrado lógico: F29 pagados quedan fuera, legal con
    estado='terminado' queda fuera (validado a nivel SQL via mock que
    refleja el WHERE explícito del query).

No usamos DB real — patrón consistente con
`tests/unit/test_empresa_dashboard.py`. La cobertura SQL queda para
integration tests.
"""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.calendar import (
    _build_obligation,
    _classify_severity,
    _compute_days_until,
    _parse_plazo_pago_days,
    _query_calendar_events,
    _query_f29,
    _query_legal,
    _query_oc,
    _query_suscripciones,
)
from app.schemas.calendar import ObligationItem


# ---------------------------------------------------------------------
# _compute_days_until
# ---------------------------------------------------------------------
class TestComputeDaysUntil:
    def test_mismo_dia_es_cero(self) -> None:
        today = date(2026, 4, 29)
        assert _compute_days_until(today, today) == 0

    def test_un_dia_en_el_futuro(self) -> None:
        today = date(2026, 4, 29)
        due = date(2026, 4, 30)
        assert _compute_days_until(today, due) == 1

    def test_una_semana_en_el_futuro(self) -> None:
        today = date(2026, 4, 29)
        due = today + timedelta(days=7)
        assert _compute_days_until(today, due) == 7

    def test_un_dia_vencido_negativo(self) -> None:
        today = date(2026, 4, 29)
        due = date(2026, 4, 28)
        assert _compute_days_until(today, due) == -1

    def test_treinta_dias_vencido(self) -> None:
        today = date(2026, 4, 29)
        due = today - timedelta(days=30)
        assert _compute_days_until(today, due) == -30


# ---------------------------------------------------------------------
# _classify_severity — boundaries -1, 0, 7, 8
# ---------------------------------------------------------------------
class TestClassifySeverity:
    def test_dia_negativo_uno_es_critical(self) -> None:
        assert _classify_severity(-1) == "critical"

    def test_muy_vencido_es_critical(self) -> None:
        assert _classify_severity(-365) == "critical"

    def test_cero_es_warning(self) -> None:
        # Vence hoy → warning (todavía no es crítico)
        assert _classify_severity(0) == "warning"

    def test_uno_es_warning(self) -> None:
        assert _classify_severity(1) == "warning"

    def test_siete_es_warning(self) -> None:
        # 7 días exactos → warning (límite superior inclusivo)
        assert _classify_severity(7) == "warning"

    def test_ocho_es_info(self) -> None:
        # 8 días → info (más lejos)
        assert _classify_severity(8) == "info"

    def test_treinta_es_info(self) -> None:
        assert _classify_severity(30) == "info"

    def test_un_anio_es_info(self) -> None:
        assert _classify_severity(365) == "info"


# ---------------------------------------------------------------------
# _parse_plazo_pago_days
# ---------------------------------------------------------------------
class TestParsePlazoPago:
    def test_none_default_30(self) -> None:
        assert _parse_plazo_pago_days(None) == 30

    def test_string_vacio_default_30(self) -> None:
        assert _parse_plazo_pago_days("") == 30

    def test_30_dias_completo(self) -> None:
        assert _parse_plazo_pago_days("30 días") == 30

    def test_15_dias(self) -> None:
        assert _parse_plazo_pago_days("15 dias") == 15

    def test_solo_numero(self) -> None:
        assert _parse_plazo_pago_days("60") == 60

    def test_contado_es_cero(self) -> None:
        assert _parse_plazo_pago_days("Contado") == 0

    def test_contado_lower(self) -> None:
        assert _parse_plazo_pago_days("contado") == 0

    def test_unparseable_default_30(self) -> None:
        assert _parse_plazo_pago_days("a fin de mes") == 30

    def test_solo_letras_default_30(self) -> None:
        assert _parse_plazo_pago_days("xxx") == 30


# ---------------------------------------------------------------------
# _build_obligation
# ---------------------------------------------------------------------
class TestBuildObligation:
    def test_id_compuesto_con_tipo_y_entity_id(self) -> None:
        today = date(2026, 4, 29)
        item = _build_obligation(
            tipo="f29",
            entity_id="123",
            title="F29 CEHTA",
            subtitle=None,
            empresa_codigo="CEHTA",
            due_date=today + timedelta(days=3),
            today=today,
            monto=Decimal("100000"),
            moneda="CLP",
            link="/f29",
        )
        assert item.id == "f29:123"
        assert item.days_until == 3
        assert item.severity == "warning"

    def test_oc_critical_si_vencido(self) -> None:
        today = date(2026, 4, 29)
        item = _build_obligation(
            tipo="oc",
            entity_id="55",
            title="OC 0001",
            subtitle="emitida",
            empresa_codigo="CEHTA",
            due_date=today - timedelta(days=10),
            today=today,
            monto=Decimal("500000"),
            moneda="CLP",
            link="/ordenes-compra/55",
        )
        assert item.severity == "critical"
        assert item.days_until == -10
        assert item.id == "oc:55"

    def test_legal_info_si_lejos(self) -> None:
        today = date(2026, 4, 29)
        item = _build_obligation(
            tipo="legal",
            entity_id="9",
            title="Contrato X",
            subtitle="Categoría: contrato",
            empresa_codigo="CEHTA",
            due_date=today + timedelta(days=60),
            today=today,
            monto=None,
            moneda=None,
            link="/empresa/CEHTA/legal/9",
        )
        assert item.severity == "info"
        assert item.days_until == 60


# ---------------------------------------------------------------------
# Schema ObligationItem
# ---------------------------------------------------------------------
class TestObligationItemSchema:
    def test_model_dump_keys_completos(self) -> None:
        today = date(2026, 4, 29)
        item = ObligationItem(
            id="f29:1",
            tipo="f29",
            severity="critical",
            title="F29 X",
            subtitle=None,
            empresa_codigo="X",
            due_date=today,
            days_until=0,
            monto=None,
            moneda=None,
            link="/f29",
        )
        d = item.model_dump()
        for k in (
            "id",
            "tipo",
            "severity",
            "title",
            "subtitle",
            "empresa_codigo",
            "due_date",
            "days_until",
            "monto",
            "moneda",
            "link",
        ):
            assert k in d

    def test_tipo_invalido_falla(self) -> None:
        with pytest.raises(Exception):  # noqa: B017 — pydantic ValidationError
            ObligationItem(
                id="x:1",
                tipo="no_existe",  # type: ignore[arg-type]
                severity="info",
                title="x",
                due_date=date(2026, 4, 29),
                days_until=0,
                link="/",
            )

    def test_severity_invalida_falla(self) -> None:
        with pytest.raises(Exception):  # noqa: B017
            ObligationItem(
                id="f29:1",
                tipo="f29",
                severity="urgentisimo",  # type: ignore[arg-type]
                title="x",
                due_date=date(2026, 4, 29),
                days_until=0,
                link="/",
            )


# ---------------------------------------------------------------------
# Mocks de DB para validar contratos de los queries
# ---------------------------------------------------------------------


def _make_db_with_rows(rows: list[dict[str, Any]]) -> AsyncMock:
    """Construye un AsyncSession-mock que `db.execute(...)` devuelve un
    Result cuyo `.mappings().all()` retorna las filas dadas.
    """
    db = AsyncMock()
    result = MagicMock()
    mappings = MagicMock()
    mappings.all = MagicMock(return_value=rows)
    result.mappings = MagicMock(return_value=mappings)
    db.execute = AsyncMock(return_value=result)
    return db


class TestQueryF29:
    @pytest.mark.asyncio
    async def test_paid_f29_excluded_via_sql_filter(self) -> None:
        """El query incluye `estado <> 'pagado'` — verificamos que el
        SQL emitido filtre por estado.
        """
        db = _make_db_with_rows([])
        today = date(2026, 4, 29)
        await _query_f29(
            db,
            today=today,
            from_date=today,
            to_date=today + timedelta(days=30),
            empresa_codigo=None,
        )
        # El primer arg posicional de execute es el `text(...)` clause.
        call = db.execute.call_args
        sql = str(call.args[0])
        assert "estado <> 'pagado'" in sql
        assert "f29_obligaciones" in sql

    @pytest.mark.asyncio
    async def test_pending_f29_emits_obligation(self) -> None:
        today = date(2026, 4, 29)
        rows = [
            {
                "f29_id": "1",
                "empresa_codigo": "CEHTA",
                "periodo_tributario": "2026-04",
                "fecha_vencimiento": today + timedelta(days=5),
                "monto_a_pagar": Decimal("250000"),
                "estado": "pendiente",
            }
        ]
        db = _make_db_with_rows(rows)
        items = await _query_f29(
            db,
            today=today,
            from_date=today,
            to_date=today + timedelta(days=30),
            empresa_codigo=None,
        )
        assert len(items) == 1
        item = items[0]
        assert item.tipo == "f29"
        assert item.severity == "warning"
        assert item.days_until == 5
        assert item.empresa_codigo == "CEHTA"
        assert item.id == "f29:1"
        assert "F29 CEHTA" in item.title
        assert item.moneda == "CLP"


class TestQueryLegal:
    @pytest.mark.asyncio
    async def test_terminado_excluido_via_sql_filter(self) -> None:
        """El query exige `estado = 'vigente'` — los `terminado` /
        `rescindido` no aparecen.
        """
        db = _make_db_with_rows([])
        today = date(2026, 4, 29)
        await _query_legal(
            db,
            today=today,
            from_date=today,
            to_date=today + timedelta(days=90),
            empresa_codigo=None,
        )
        sql = str(db.execute.call_args.args[0])
        assert "estado = 'vigente'" in sql
        assert "legal_documents" in sql

    @pytest.mark.asyncio
    async def test_legal_vigente_emits_obligation(self) -> None:
        today = date(2026, 4, 29)
        rows = [
            {
                "documento_id": "42",
                "empresa_codigo": "CEHTA",
                "nombre": "Contrato arriendo",
                "categoria": "contrato",
                "fecha_vigencia_hasta": today + timedelta(days=20),
                "monto": None,
                "moneda": None,
            }
        ]
        db = _make_db_with_rows(rows)
        items = await _query_legal(
            db,
            today=today,
            from_date=today,
            to_date=today + timedelta(days=90),
            empresa_codigo=None,
        )
        assert len(items) == 1
        assert items[0].tipo == "legal"
        assert items[0].severity == "info"  # 20 días → info
        assert items[0].link == "/empresa/CEHTA/legal/42"
        assert items[0].id == "legal:42"


class TestQueryOC:
    @pytest.mark.asyncio
    async def test_oc_due_date_es_fecha_emision_mas_plazo(self) -> None:
        today = date(2026, 4, 29)
        emision = today - timedelta(days=10)
        rows = [
            {
                "oc_id": "7",
                "numero_oc": "OC-0007",
                "empresa_codigo": "CEHTA",
                "fecha_emision": emision,
                "total": Decimal("1000000"),
                "moneda": "CLP",
                "plazo_pago": "30 días",
                "estado": "emitida",
            }
        ]
        db = _make_db_with_rows(rows)
        items = await _query_oc(
            db,
            today=today,
            from_date=today - timedelta(days=30),
            to_date=today + timedelta(days=90),
            empresa_codigo=None,
        )
        assert len(items) == 1
        assert items[0].due_date == emision + timedelta(days=30)
        assert items[0].days_until == 20  # 30 - 10
        assert items[0].severity == "info"
        assert items[0].id == "oc:7"

    @pytest.mark.asyncio
    async def test_oc_plazo_pago_null_usa_30_default(self) -> None:
        today = date(2026, 4, 29)
        emision = today
        rows = [
            {
                "oc_id": "8",
                "numero_oc": "OC-0008",
                "empresa_codigo": "CEHTA",
                "fecha_emision": emision,
                "total": Decimal("500000"),
                "moneda": "CLP",
                "plazo_pago": None,
                "estado": "aprobada",
            }
        ]
        db = _make_db_with_rows(rows)
        items = await _query_oc(
            db,
            today=today,
            from_date=today,
            to_date=today + timedelta(days=90),
            empresa_codigo=None,
        )
        assert len(items) == 1
        assert items[0].days_until == 30

    @pytest.mark.asyncio
    async def test_oc_fuera_de_rango_excluida(self) -> None:
        today = date(2026, 4, 29)
        # Fecha emisión muy vieja con plazo corto → due_date antes de from_date
        emision = today - timedelta(days=200)
        rows = [
            {
                "oc_id": "9",
                "numero_oc": "OC-0009",
                "empresa_codigo": "CEHTA",
                "fecha_emision": emision,
                "total": Decimal("100"),
                "moneda": "CLP",
                "plazo_pago": "30 días",
                "estado": "emitida",
            }
        ]
        db = _make_db_with_rows(rows)
        items = await _query_oc(
            db,
            today=today,
            from_date=today,  # due_date < from_date → excluida
            to_date=today + timedelta(days=90),
            empresa_codigo=None,
        )
        assert items == []

    @pytest.mark.asyncio
    async def test_oc_query_solo_emitida_o_aprobada(self) -> None:
        db = _make_db_with_rows([])
        today = date(2026, 4, 29)
        await _query_oc(
            db,
            today=today,
            from_date=today,
            to_date=today + timedelta(days=90),
            empresa_codigo=None,
        )
        sql = str(db.execute.call_args.args[0])
        assert "'emitida'" in sql
        assert "'aprobada'" in sql


class TestQuerySuscripciones:
    @pytest.mark.asyncio
    async def test_suscripcion_no_firmada_emite_obligation(self) -> None:
        today = date(2026, 4, 29)
        rows = [
            {
                "suscripcion_id": "3",
                "empresa_codigo": "CEHTA",
                "fecha_recibo": today + timedelta(days=2),
                "monto_clp": Decimal("750000"),
                "contrato_ref": "CT-001",
            }
        ]
        db = _make_db_with_rows(rows)
        items = await _query_suscripciones(
            db,
            today=today,
            from_date=today,
            to_date=today + timedelta(days=90),
            empresa_codigo=None,
        )
        assert len(items) == 1
        assert items[0].tipo == "suscripcion"
        assert items[0].severity == "warning"
        assert items[0].id == "suscripcion:3"

    @pytest.mark.asyncio
    async def test_suscripcion_query_filtra_firmado_false(self) -> None:
        db = _make_db_with_rows([])
        today = date(2026, 4, 29)
        await _query_suscripciones(
            db,
            today=today,
            from_date=today,
            to_date=today + timedelta(days=90),
            empresa_codigo=None,
        )
        sql = str(db.execute.call_args.args[0])
        assert "firmado = false" in sql


class TestQueryCalendarEvents:
    @pytest.mark.asyncio
    async def test_evento_no_completado_emite_obligation(self) -> None:
        today = date(2026, 4, 29)
        fi = datetime(2026, 5, 5, 9, 0, tzinfo=UTC)
        rows = [
            {
                "event_id": "11",
                "empresa_codigo": "CEHTA",
                "titulo": "Comité Inversión",
                "descripcion": "Revisión Q2",
                "tipo": "comite",
                "fecha_inicio": fi,
            }
        ]
        db = _make_db_with_rows(rows)
        items = await _query_calendar_events(
            db,
            today=today,
            from_date=today,
            to_date=today + timedelta(days=30),
            empresa_codigo=None,
        )
        assert len(items) == 1
        assert items[0].tipo == "event"
        assert items[0].id == "event:11"
        assert items[0].due_date == date(2026, 5, 5)

    @pytest.mark.asyncio
    async def test_evento_query_filtra_completado_false(self) -> None:
        db = _make_db_with_rows([])
        today = date(2026, 4, 29)
        await _query_calendar_events(
            db,
            today=today,
            from_date=today,
            to_date=today + timedelta(days=30),
            empresa_codigo=None,
        )
        sql = str(db.execute.call_args.args[0])
        assert "completado = false" in sql
