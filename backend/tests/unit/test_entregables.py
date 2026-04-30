"""Tests para los helpers puros de Entregables Regulatorios (V4 fase 6).

Foco: lógica de cálculo de niveles de alerta, generación de fechas para
series recurrentes, validaciones de schema. La capa SQL se testea en
integración con DB real.
"""
from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.api.v1.entregables import _calcular_alerta, _fechas_del_anio
from app.schemas.entregable import (
    EntregableCreate,
    EntregableUpdate,
    GenerarSerieRequest,
)


# ---------------------------------------------------------------------------
# _calcular_alerta — replica del Bloque 3.1 del PROMPT_MAESTRO
# ---------------------------------------------------------------------------
class TestCalcularAlerta:
    def _hoy(self) -> date:
        return date.today()

    def test_entregado_es_normal_aunque_atrasado(self) -> None:
        # Si está entregado, no es alerta — aunque esté en el pasado
        ayer = self._hoy() - timedelta(days=10)
        nivel, dias = _calcular_alerta(ayer, "entregado")
        assert nivel == "normal"

    def test_vencido_un_dia(self) -> None:
        ayer = self._hoy() - timedelta(days=1)
        nivel, dias = _calcular_alerta(ayer, "pendiente")
        assert nivel == "vencido"
        assert dias == -1

    def test_hoy(self) -> None:
        nivel, dias = _calcular_alerta(self._hoy(), "pendiente")
        assert nivel == "hoy"
        assert dias == 0

    def test_critico_3_dias(self) -> None:
        en_3 = self._hoy() + timedelta(days=3)
        nivel, dias = _calcular_alerta(en_3, "pendiente")
        assert nivel == "critico"
        assert dias == 3

    def test_critico_borde_5_dias(self) -> None:
        en_5 = self._hoy() + timedelta(days=5)
        nivel, _ = _calcular_alerta(en_5, "pendiente")
        assert nivel == "critico"

    def test_urgente_borde_10_dias(self) -> None:
        en_10 = self._hoy() + timedelta(days=10)
        nivel, _ = _calcular_alerta(en_10, "pendiente")
        assert nivel == "urgente"

    def test_proximo_borde_15_dias(self) -> None:
        en_15 = self._hoy() + timedelta(days=15)
        nivel, _ = _calcular_alerta(en_15, "pendiente")
        assert nivel == "proximo"

    def test_en_rango_borde_30_dias(self) -> None:
        en_30 = self._hoy() + timedelta(days=30)
        nivel, _ = _calcular_alerta(en_30, "pendiente")
        assert nivel == "en_rango"

    def test_normal_45_dias(self) -> None:
        en_45 = self._hoy() + timedelta(days=45)
        nivel, dias = _calcular_alerta(en_45, "pendiente")
        assert nivel == "normal"
        assert dias == 45

    def test_estado_no_entregado_sigue_calculando_alerta(self) -> None:
        # no_entregado NO es entregado — sigue siendo accionable, así que
        # mostramos su nivel real (probablemente 'vencido' por contexto)
        ayer = self._hoy() - timedelta(days=2)
        nivel, _ = _calcular_alerta(ayer, "no_entregado")
        assert nivel == "vencido"

    def test_en_proceso_aplica_calculo_normal(self) -> None:
        en_3 = self._hoy() + timedelta(days=3)
        nivel, _ = _calcular_alerta(en_3, "en_proceso")
        assert nivel == "critico"


# ---------------------------------------------------------------------------
# _fechas_del_anio — genera instancias de un template recurrente
# ---------------------------------------------------------------------------
class TestFechasDelAnio:
    def test_mensual_genera_12(self) -> None:
        fechas = _fechas_del_anio("mensual", 2026)
        assert len(fechas) == 12
        # Todos del año 2026
        for periodo, fecha in fechas:
            assert fecha.year == 2026
            assert periodo.endswith("-2026")

    def test_mensual_ultimo_dia_del_mes(self) -> None:
        fechas = _fechas_del_anio("mensual", 2026)
        # Febrero 2026 = 28 días (no bisiesto)
        feb = next(f for p, f in fechas if p == "02-2026")
        assert feb.day == 28
        # Enero = 31
        ene = next(f for p, f in fechas if p == "01-2026")
        assert ene.day == 31

    def test_trimestral_genera_4(self) -> None:
        fechas = _fechas_del_anio("trimestral", 2026)
        assert len(fechas) == 4
        periodos = [p for p, _ in fechas]
        assert periodos == ["Q1-2026", "Q2-2026", "Q3-2026", "Q4-2026"]

    def test_semestral_genera_2(self) -> None:
        fechas = _fechas_del_anio("semestral", 2026)
        assert len(fechas) == 2
        # S2 vence en enero del año siguiente
        s2 = next(f for p, f in fechas if p == "S2-2026")
        assert s2.year == 2027
        assert s2.month == 1

    def test_anual_genera_1(self) -> None:
        fechas = _fechas_del_anio("anual", 2026)
        assert len(fechas) == 1
        # Vence 30 abril del año siguiente
        _, f = fechas[0]
        assert f.year == 2027
        assert f.month == 4

    def test_bienal_genera_1(self) -> None:
        fechas = _fechas_del_anio("bienal", 2024)
        assert len(fechas) == 1
        periodo, fecha = fechas[0]
        assert periodo == "2024-2025"


# ---------------------------------------------------------------------------
# Schemas — validaciones de borde
# ---------------------------------------------------------------------------
class TestEntregableCreate:
    def test_minimo_aceptado(self) -> None:
        EntregableCreate(
            id_template="cmf_test",
            nombre="Reporte test",
            categoria="CMF",
            fecha_limite=date(2026, 5, 7),
            frecuencia="trimestral",
            prioridad="alta",
            responsable="Administradora",
            periodo="Q1-2026",
        )

    def test_categoria_invalida_falla(self) -> None:
        with pytest.raises(ValidationError):
            EntregableCreate(
                id_template="x",
                nombre="x",
                categoria="INVALID_CAT",  # type: ignore[arg-type]
                fecha_limite=date.today(),
                frecuencia="mensual",
                prioridad="alta",
                responsable="x",
                periodo="x",
            )

    def test_prioridad_invalida_falla(self) -> None:
        with pytest.raises(ValidationError):
            EntregableCreate(
                id_template="x",
                nombre="x",
                categoria="CMF",
                fecha_limite=date.today(),
                frecuencia="mensual",
                prioridad="ULTRA_CRITICA",  # type: ignore[arg-type]
                responsable="x",
                periodo="x",
            )


class TestEntregableUpdate:
    def test_no_entregado_sin_motivo_falla(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            EntregableUpdate(estado="no_entregado")
        assert "motivo_no_entrega" in str(exc_info.value)

    def test_no_entregado_con_motivo_pasa(self) -> None:
        EntregableUpdate(
            estado="no_entregado",
            motivo_no_entrega="Auditor no entregó EEFF a tiempo",
        )

    def test_actualizar_solo_notas(self) -> None:
        EntregableUpdate(notas="Llamé a CORFO, queda pendiente para mañana")

    def test_entregado_sin_fecha_pasa(self) -> None:
        # El endpoint defaults a hoy si no viene fecha
        EntregableUpdate(estado="entregado")


class TestGenerarSerieRequest:
    def _base(self) -> dict:
        return {
            "id_template": "cmf_trim",
            "nombre": "Reporte CMF",
            "categoria": "CMF",
            "frecuencia": "trimestral",
            "prioridad": "critica",
            "responsable": "Administradora",
            "anio": 2027,
        }

    def test_recurrente_acepta(self) -> None:
        GenerarSerieRequest(**self._base())

    def test_unico_falla(self) -> None:
        d = self._base()
        d["frecuencia"] = "unico"
        with pytest.raises(ValidationError) as exc_info:
            GenerarSerieRequest(**d)
        assert "recurrente" in str(exc_info.value).lower()

    def test_segun_evento_falla(self) -> None:
        d = self._base()
        d["frecuencia"] = "segun_evento"
        with pytest.raises(ValidationError):
            GenerarSerieRequest(**d)

    def test_anio_fuera_de_rango_falla(self) -> None:
        d = self._base()
        d["anio"] = 1999
        with pytest.raises(ValidationError):
            GenerarSerieRequest(**d)
        d["anio"] = 2050
        with pytest.raises(ValidationError):
            GenerarSerieRequest(**d)
