"""Registro de egresos CORFO — reglas de los schemas, gate y helpers puros.

Sin base de datos: las reglas de plata viven en `app.schemas.claudia_egresos`
como funciones puras, y el gate `_check_claudia_access` se prueba con un
`db` falso cuyo `execute` es async y devuelve algo con `.scalar()`.
"""
from __future__ import annotations

import io
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

import app.api.v1.claudia_egresos as claudia_egresos_mod
import app.schemas.claudia_egresos as schemas_mod
from app.api.v1.claudia_egresos import (
    SQL_TODOS,
    _check_claudia_access,
    _fila_propia_o_404,
    _leer_upload_acotado,
    _mensaje_validacion,
    armar_historial,
    diff_snapshots,
    importar_excel,
)
from app.core.security import AuthenticatedUser
from app.domain.value_objects.reparto_corfo import FUENTES
from app.schemas.claudia_egresos import (
    ClaudiaCatalogosResponse,
    EgresoBatchFila,
    EgresoCreate,
    EgresoDeleteRequest,
    EgresoUpdate,
    clp,
    egreso_read_desde_fila,
    fusionar_update,
)
from app.services.corfo_egresos_import_service import (
    FilaSaltada,
    ResultadoParseo,
    ResumenCarga,
)

D = Decimal


def _base(**over: Any) -> dict[str, Any]:
    d: dict[str, Any] = {
        "empresa_codigo": "revtech",
        "fecha": "2026-08-27",
        "descripcion": "  MCG AUDITORES CONSULTORES SPA ",
        "rut_emisor": "76.642.280-2",
        "tipo_documento": "FACTURA",
        "folio": 10540,
        "total": "94352.00",
    }
    d.update(over)
    return d


def _msgs(exc: pytest.ExceptionInfo[ValidationError]) -> str:
    return " | ".join(str(e["msg"]) for e in exc.value.errors())


# ── EgresoCreate ────────────────────────────────────────────────────


def test_create_minimo_deriva_neto_impuesto_y_normaliza():
    e = EgresoCreate.model_validate(_base())
    assert e.empresa_codigo == "REVTECH"
    assert e.descripcion == "MCG AUDITORES CONSULTORES SPA"
    assert e.folio == "10540"  # el Excel trae folios numéricos
    assert e.rut_emisor == "76642280-2"  # sin puntos, con guion
    assert e.monto_neto == D("94352.00")
    assert e.impuesto == D("0.00")
    assert e.origen == "UI"
    assert e.estado_pago == "PENDIENTE"
    assert all(v is None for v in e.montos_reparto().values())  # sin clasificar


def test_reparto_pct_se_convierte_con_el_motor():
    e = EgresoCreate.model_validate(
        _base(total="1000001", reparto_pct={"subsidio": 50, "cehta_ptec": 20, "cehta": 30})
    )
    m = e.montos_reparto()
    assert m["subsidio"] == D("500001.00")  # residuo a la mayor
    assert sum(m.values(), D(0)) == D("1000001.00")


def test_reparto_en_montos_que_cuadra():
    e = EgresoCreate.model_validate(
        _base(total="590777", reparto={"subsidio": "496451", "cehta": "94326"})
    )
    m = e.montos_reparto()
    assert m == {
        "subsidio": D("496451.00"),
        "cehta_ptec": D("0.00"),
        "cehta": D("94326.00"),
        "trewaox": D("0.00"),
    }


def test_reparto_y_reparto_pct_a_la_vez_rechaza():
    with pytest.raises(ValidationError) as exc:
        EgresoCreate.model_validate(
            _base(reparto={"subsidio": "94352"}, reparto_pct={"subsidio": 100})
        )
    assert "no los dos a la vez" in _msgs(exc)


def test_reparto_que_no_suma_dice_cuanto_suma_y_cual_es_el_total():
    with pytest.raises(ValidationError) as exc:
        EgresoCreate.model_validate(_base(total="1000", reparto={"subsidio": 500, "cehta": 400}))
    assert "El reparto suma $900 y el total es $1.000" in _msgs(exc)


def test_pct_que_no_suman_100_usa_el_mensaje_del_motor():
    with pytest.raises(ValidationError) as exc:
        EgresoCreate.model_validate(_base(reparto_pct={"subsidio": 50}))
    assert "suman 50%" in _msgs(exc)


def test_neto_mas_impuesto_distinto_del_total_rechaza():
    with pytest.raises(ValidationError) as exc:
        EgresoCreate.model_validate(_base(monto_neto="100", impuesto="10", total="120"))
    assert "pero el total es $120" in _msgs(exc)


def test_solo_neto_deriva_el_impuesto():
    e = EgresoCreate.model_validate(_base(monto_neto="79287", total="94352"))
    assert e.impuesto == D("15065.00")


def test_neto_mayor_al_total_rechaza():
    with pytest.raises(ValidationError) as exc:
        EgresoCreate.model_validate(_base(monto_neto="100000", total="94352"))
    assert "no puede superar el total" in _msgs(exc)


def test_rut_invalido_rechaza():
    with pytest.raises(ValidationError) as exc:
        EgresoCreate.model_validate(_base(rut_emisor="76642280-3"))
    assert "RUT inválido" in _msgs(exc)


def test_rut_vacio_es_none():
    assert EgresoCreate.model_validate(_base(rut_emisor="  ")).rut_emisor is None


def test_total_negativo_rechaza():
    with pytest.raises(ValidationError) as exc:
        EgresoCreate.model_validate(_base(total="-1"))
    assert "no puede ser negativo" in _msgs(exc)


def test_descripcion_vacia_rechaza():
    with pytest.raises(ValidationError) as exc:
        EgresoCreate.model_validate(_base(descripcion="   "))
    assert "descripción no puede quedar vacía" in _msgs(exc)


def test_total_con_cuatro_decimales_queda_en_dos():
    # Fila real: conversión desde UF
    e = EgresoCreate.model_validate(_base(total="5645105.9504"))
    assert e.total == D("5645105.95")


def test_batch_fila_es_create_sin_empresa():
    d = _base()
    d.pop("empresa_codigo")
    f = EgresoBatchFila.model_validate(d)
    assert f.total == D("94352.00")
    assert "empresa_codigo" not in EgresoBatchFila.model_fields


# ── S1: topes de texto libre ────────────────────────────────────────


@pytest.mark.parametrize(
    ("campo", "valor", "esperado"),
    [
        ("observaciones", "x" * 2001, "observaciones: máximo 2000 caracteres"),
        ("adjunto_dropbox_path", "/" * 501, "adjunto_dropbox_path: máximo 500 caracteres"),
        ("descripcion", "d" * 501, "descripcion: máximo 500 caracteres"),
        ("corfo", {"glosa": "g" * 201}, "corfo.glosa: máximo 200 caracteres"),
        ("corfo", {"receptor_nombre": "n" * 201}, "corfo.receptor_nombre: máximo 200 caracteres"),
    ],
)
def test_create_rechaza_textos_por_encima_del_tope_en_espanol(campo, valor, esperado):
    with pytest.raises(ValidationError) as exc:
        EgresoCreate.model_validate(_base(**{campo: valor}))
    assert _mensaje_validacion(exc.value) == esperado


def test_create_acepta_textos_justo_en_el_tope():
    e = EgresoCreate.model_validate(
        _base(
            observaciones="o" * 2000,
            adjunto_dropbox_path="/" * 500,
            corfo={"glosa": "g" * 200},
        )
    )
    assert len(e.observaciones or "") == 2000
    assert len(e.adjunto_dropbox_path or "") == 500
    assert e.corfo is not None and len(e.corfo.glosa or "") == 200


def test_update_tiene_los_mismos_topes():
    with pytest.raises(ValidationError) as exc:
        EgresoUpdate.model_validate({"observaciones": "x" * 2001})
    assert _mensaje_validacion(exc.value) == "observaciones: máximo 2000 caracteres"
    with pytest.raises(ValidationError) as exc:
        EgresoUpdate.model_validate({"corfo": {"cuenta": "c" * 201}})
    assert _mensaje_validacion(exc.value) == "corfo.cuenta: máximo 200 caracteres"


# ── EgresoUpdate ────────────────────────────────────────────────────


def test_update_empresa_codigo_no_es_editable():
    with pytest.raises(ValidationError) as exc:
        EgresoUpdate.model_validate({"empresa_codigo": "TRONGKAI"})
    assert "no se puede cambiar" in _msgs(exc)


def test_update_reparto_y_pct_a_la_vez_rechaza():
    with pytest.raises(ValidationError) as exc:
        EgresoUpdate.model_validate({"reparto": {"subsidio": 1}, "reparto_pct": {"subsidio": 100}})
    assert "no los dos a la vez" in _msgs(exc)


def test_update_campo_obligatorio_en_null_rechaza():
    with pytest.raises(ValidationError) as exc:
        EgresoUpdate.model_validate({"total": None})
    assert "total no puede quedar vacío" in _msgs(exc)


def test_update_ignora_campos_de_lectura():
    # La grilla puede mandar la fila entera de vuelta; lo de sólo lectura no molesta.
    u = EgresoUpdate.model_validate({"estado_pago": "PAGADO", "version": 3, "periodo": "2026-08"})
    assert u.model_fields_set == {"estado_pago"}


def _fila_actual(**over: Any) -> dict[str, Any]:
    f: dict[str, Any] = {
        "egreso_id": 7,
        "empresa_codigo": "TRONGKAI",
        "periodo": "2026-08",
        "fecha": date(2026, 8, 27),
        "descripcion": "PROYECTA SPA",
        "rut_emisor": "76642280-2",
        "tipo_documento": "FACTURA",
        "folio": "10540",
        "monto_neto": D("79287.00"),
        "impuesto": D("15065.00"),
        "total": D("94352.00"),
        "tipo_egreso": None,
        "fuente": "Corfo",
        "proyecto": None,
        "estado_pago": "PENDIENTE",
        "fecha_pago": None,
        "monto_subsidio": D("94352.00"),
        "monto_cehta_ptec": D("0.00"),
        "monto_cehta": D("0.00"),
        "monto_trewaox": D("0.00"),
        "corfo_cuenta": "GASTOS DE OPERACIÓN",
        "corfo_item": None,
        "corfo_fuente_financiamiento": None,
        "corfo_etapa": None,
        "corfo_fecha_recepcion": None,
        "corfo_monto_rendir": None,
        "corfo_monto_cancelado": None,
        "corfo_forma_pago": None,
        "corfo_glosa": None,
        "corfo_receptor_rut": None,
        "corfo_receptor_nombre": None,
        "observaciones": None,
        "adjunto_dropbox_path": None,
        "origen": "IMPORT_EXCEL",
        "created_at": datetime(2026, 8, 27, 10, 0),
        "created_by": "claudia@trongkai.com",
        "updated_at": datetime(2026, 8, 27, 10, 0),
        "updated_by": None,
        "version": 1,
    }
    f.update(over)
    return f


def test_fusionar_solo_estado_no_toca_un_reparto_descuadrado():
    # Fila importada descuadrada: se tiene que poder marcar pagada sin arreglar antes el reparto.
    actual = _fila_actual(monto_subsidio=D("90000.00"))
    out = fusionar_update(actual, EgresoUpdate.model_validate({"estado_pago": "PAGADO"}))
    assert out["estado_pago"] == "PAGADO"
    assert out["monto_subsidio"] == D("90000.00")
    assert out["total"] == D("94352.00")
    assert out["monto_neto"] == D("79287.00")


# ── D6: cambiar el total sin tocar el reparto ───────────────────────


def test_fusionar_cambiar_total_reescala_un_reparto_ok_en_proporcion_exacta():
    # PROYECTA SPA (fila real): 590.777 = 496.451 subsidio + 94.326 cehta. Bajar
    # el total a 496.451 reescala cada fuente (HALF_UP a peso, residuo a la
    # mayor) SIN pasar por %, que movía $21 de una fuente a otra.
    actual = _fila_actual(
        total=D("590777.00"), monto_subsidio=D("496451.00"), monto_cehta=D("94326.00")
    )
    out = fusionar_update(actual, EgresoUpdate.model_validate({"total": "496451"}))
    assert out["total"] == D("496451.00")
    assert out["monto_subsidio"] == D("417185.00")
    assert out["monto_cehta"] == D("79266.00")
    assert out["monto_cehta_ptec"] == D("0.00") and out["monto_trewaox"] == D("0.00")
    assert sum((out[f"monto_{f}"] for f in FUENTES), D(0)) == D("496451.00")


def test_fusionar_cambiar_total_con_reparto_descuadrado_no_rechaza_ni_lo_toca():
    # Importada descuadrada (90.000 ≠ 94.352): cambiar el total no da 422 y el
    # reparto queda tal cual, en ámbar, para que Claudia lo resuelva.
    actual = _fila_actual(monto_subsidio=D("90000.00"))
    out = fusionar_update(actual, EgresoUpdate.model_validate({"total": "100000"}))
    assert out["total"] == D("100000.00")
    assert out["monto_subsidio"] == D("90000.00")
    assert out["monto_cehta"] == D("0.00")


def test_fusionar_cambiar_total_sin_clasificar_sigue_sin_clasificar():
    sin = _fila_actual(
        monto_subsidio=None, monto_cehta_ptec=None, monto_cehta=None, monto_trewaox=None
    )
    out = fusionar_update(sin, EgresoUpdate.model_validate({"total": "100000"}))
    assert all(out[f"monto_{f}"] is None for f in FUENTES)


def test_fusionar_mismo_total_no_mueve_ni_un_peso():
    out = fusionar_update(_fila_actual(), EgresoUpdate.model_validate({"total": "94352.00"}))
    assert out["monto_subsidio"] == D("94352.00") and out["monto_cehta"] == D("0.00")


def test_fusionar_desde_total_cero_no_puede_escalar_y_deja_el_reparto():
    # 0 = 0 + 0 + 0 + 0 está OK pero no hay proporción: queda como está (pasa a
    # DESCUADRADO y la pantalla lo marca), sin 422.
    cero = _fila_actual(
        total=D("0.00"), monto_neto=D("0.00"), impuesto=D("0.00"),
        monto_subsidio=D("0.00"),
    )
    out = fusionar_update(cero, EgresoUpdate.model_validate({"total": "1000"}))
    assert out["total"] == D("1000.00")
    assert all(out[f"monto_{f}"] == D("0.00") for f in FUENTES)


def test_fusionar_total_con_reparto_explicito_sigue_exigiendo_cuadre():
    with pytest.raises(ValueError, match=r"El reparto suma \$1 y el total es \$100\.000"):
        fusionar_update(
            _fila_actual(),
            EgresoUpdate.model_validate({"total": "100000", "reparto": {"cehta": 1}}),
        )


# ── D5: neto / impuesto en el PUT ───────────────────────────────────


def test_fusionar_neto_e_impuesto_en_null_explicito_resuelve_como_create():
    out = fusionar_update(
        _fila_actual(),
        EgresoUpdate.model_validate({"monto_neto": None, "impuesto": None}),
    )
    assert out["monto_neto"] == D("94352.00")
    assert out["impuesto"] == D("0.00")
    assert out["total"] == D("94352.00")


def test_fusionar_solo_total_conserva_el_impuesto_y_el_neto_absorbe():
    out = fusionar_update(_fila_actual(), EgresoUpdate.model_validate({"total": "100000"}))
    assert out["impuesto"] == D("15065.00")
    assert out["monto_neto"] == D("84935.00")
    assert out["monto_subsidio"] == D("100000.00")  # D6: 100% subsidio reescalado


def test_fusionar_solo_total_con_impuesto_que_ya_no_cabe_recalcula_desde_cero():
    out = fusionar_update(_fila_actual(), EgresoUpdate.model_validate({"total": "10000"}))
    assert (out["monto_neto"], out["impuesto"]) == (D("10000.00"), D("0.00"))


def test_fusionar_solo_neto_deriva_el_impuesto_como_diferencia():
    out = fusionar_update(_fila_actual(), EgresoUpdate.model_validate({"monto_neto": "80000"}))
    assert (out["monto_neto"], out["impuesto"]) == (D("80000.00"), D("14352.00"))


def test_fusionar_total_mas_reparto_pct_rereparte():
    out = fusionar_update(
        _fila_actual(),
        EgresoUpdate.model_validate({"total": "100000", "reparto_pct": {"subsidio": 100}}),
    )
    assert out["monto_subsidio"] == D("100000.00")
    # sólo cambió el total: se conserva el impuesto y el neto absorbe
    assert out["impuesto"] == D("15065.00")
    assert out["monto_neto"] == D("84935.00")


def test_fusionar_reparto_null_deja_sin_clasificar():
    out = fusionar_update(_fila_actual(), EgresoUpdate.model_validate({"reparto": None}))
    assert all(out[f"monto_{f}"] is None for f in ("subsidio", "cehta_ptec", "cehta", "trewaox"))


def test_fusionar_reparto_que_no_cuadra_rechaza():
    with pytest.raises(ValueError, match="El reparto suma"):
        fusionar_update(_fila_actual(), EgresoUpdate.model_validate({"reparto": {"cehta": 1}}))


def test_fusionar_corfo_parcial_conserva_lo_demas():
    out = fusionar_update(
        _fila_actual(),
        EgresoUpdate.model_validate({"corfo": {"item": "Honorarios", "monto_rendir": "50000"}}),
    )
    assert out["corfo_cuenta"] == "GASTOS DE OPERACIÓN"
    assert out["corfo_item"] == "Honorarios"
    assert out["corfo_monto_rendir"] == D("50000.00")


def test_fusionar_neto_e_impuesto_nuevos_tienen_que_cuadrar():
    with pytest.raises(ValueError, match="pero el total es"):
        fusionar_update(
            _fila_actual(), EgresoUpdate.model_validate({"monto_neto": "1", "impuesto": "1"})
        )


# ── Borrado ─────────────────────────────────────────────────────────


def test_delete_motivo_corto_rechaza():
    with pytest.raises(ValidationError) as exc:
        EgresoDeleteRequest.model_validate({"motivo": "dup"})
    assert "al menos 5 caracteres" in _msgs(exc)
    assert EgresoDeleteRequest.model_validate({"motivo": "  duplicado  "}).motivo == "duplicado"


def test_delete_motivo_largo_rechaza_en_espanol():
    with pytest.raises(ValidationError) as exc:
        EgresoDeleteRequest.model_validate({"motivo": "m" * 501})
    assert "no puede superar los 500 caracteres" in _msgs(exc)
    assert len(EgresoDeleteRequest.model_validate({"motivo": "m" * 500}).motivo) == 500


# ── D4: nombre del schema de catálogos ──────────────────────────────


def test_catalogos_response_lleva_prefijo_claudia():
    # `schemas/catalogo.py` ya tiene CatalogosResponse: dos clases homónimas
    # en el OpenAPI hacen que gen:types genere nombres con módulo y rompa tsc.
    assert ClaudiaCatalogosResponse.__name__ == "ClaudiaCatalogosResponse"
    assert not hasattr(schemas_mod, "CatalogosResponse")


# ── Lectura ─────────────────────────────────────────────────────────


def test_egreso_read_desde_fila_arma_reparto_pct_y_cuadre():
    r = egreso_read_desde_fila(_fila_actual(version=2))
    assert r.total == "94352.00"
    assert r.reparto is not None and r.reparto.subsidio == "94352.00"
    assert r.reparto_pct is not None and r.reparto_pct.subsidio == "100.00"
    assert r.reparto_estado == "OK"
    assert r.neto_mas_impuesto_cuadra is True
    assert r.version == 2
    assert r.corfo.cuenta == "GASTOS DE OPERACIÓN"
    assert r.corfo.monto_rendir is None


def test_egreso_read_sin_clasificar_devuelve_reparto_null():
    sin = _fila_actual(
        monto_subsidio=None, monto_cehta_ptec=None, monto_cehta=None, monto_trewaox=None
    )
    r = egreso_read_desde_fila(sin)
    assert r.reparto is None and r.reparto_pct is None
    assert r.reparto_estado == "SIN_CLASIFICAR"


def test_clp_formato_chileno():
    assert clp("94352") == "$94.352"
    assert clp("5645105.95") == "$5.645.105,95"
    assert clp("-1") == "-$1"


# ── Gate §3.6 ───────────────────────────────────────────────────────


class _Resultado:
    def __init__(self, filas: list[Any]) -> None:
        self._filas = filas

    def first(self) -> Any:
        return self._filas[0] if self._filas else None

    def scalar(self) -> Any:
        f = self.first()
        if f is None:
            return None
        return f[0] if isinstance(f, tuple) else f

    def mappings(self) -> _Resultado:
        return self

    def all(self) -> list[Any]:
        return list(self._filas)


class _DbFalso:
    def __init__(self, filas: list[Any] | None = None) -> None:
        self.filas = filas or []
        self.llamadas: list[tuple[str, dict[str, Any] | None]] = []

    async def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _Resultado:
        self.llamadas.append((str(stmt), params))
        return _Resultado(self.filas)

    async def commit(self) -> None:  # pragma: no cover — el gate no escribe
        pass

    async def rollback(self) -> None:  # pragma: no cover
        pass


def _user(email: str | None, role: str = "director") -> AuthenticatedUser:
    return AuthenticatedUser(
        sub="0b8c2c4e-0000-4000-8000-000000000001", email=email, app_role=role, raw_claims={}
    )


async def test_gate_admin_pasa_sin_consultar_bd():
    db = _DbFalso()
    await _check_claudia_access(_user("cualquiera@otra.cl", "admin"), db)
    assert db.llamadas == []


async def test_gate_claudia_pasa_por_whitelist():
    db = _DbFalso()
    await _check_claudia_access(_user("  Claudia@Trongkai.com "), db)
    assert db.llamadas == []


async def test_gate_dominio_revtech_pasa():
    db = _DbFalso()
    await _check_claudia_access(_user("alguien@revtech.cl"), db)
    assert db.llamadas == []


async def test_gate_rol_activo_en_trongkai_pasa():
    db = _DbFalso(filas=[(1,)])
    await _check_claudia_access(_user("contador@externo.cl"), db)
    assert len(db.llamadas) == 1
    sql, params = db.llamadas[0]
    assert "user_company_roles" in sql
    assert params is not None and sorted(params["emps"]) == ["REVTECH", "TRONGKAI"]


async def test_gate_ajeno_recibe_403_con_mensaje():
    db = _DbFalso(filas=[])
    with pytest.raises(HTTPException) as exc:
        await _check_claudia_access(_user("ajeno@cenergy.cl"), db)
    assert exc.value.status_code == 403
    assert "coordinación CORFO (Claudia) y admins" in str(exc.value.detail)


async def test_gate_sin_email_ni_rol_recibe_403():
    db = _DbFalso(filas=[])
    with pytest.raises(HTTPException) as exc:
        await _check_claudia_access(_user(None), db)
    assert exc.value.status_code == 403


# ── S3: rutas por id — la fila ajena responde el mismo 404 ──────────


def _monkey_fila(monkeypatch: pytest.MonkeyPatch, fila: dict[str, Any] | None) -> list[int]:
    """`_leer_fila` falso que registra los ids pedidos y devuelve `fila`."""
    pedidos: list[int] = []

    async def _leer(_db: Any, egreso_id: int) -> dict[str, Any] | None:
        pedidos.append(egreso_id)
        return fila

    monkeypatch.setattr(claudia_egresos_mod, "_leer_fila", _leer)
    return pedidos


def _monkey_permitidas(monkeypatch: pytest.MonkeyPatch, empresas: set[str]) -> None:
    async def _permitidas(_user: Any, _db: Any) -> frozenset[str]:
        return frozenset(empresas)

    monkeypatch.setattr(claudia_egresos_mod, "get_allowed_empresa_codes", _permitidas)


async def test_fila_propia_admin_lee_cualquier_empresa(monkeypatch: pytest.MonkeyPatch):
    db = _DbFalso()
    pedidos = _monkey_fila(monkeypatch, _fila_actual(empresa_codigo="REVTECH"))
    fila = await _fila_propia_o_404(_user("nicolas@cehtacapital.com", "admin"), db, 7)
    assert fila["egreso_id"] == 7 and pedidos == [7]
    assert db.llamadas == []  # admin: ni rol ni scope en la BD


async def test_fila_propia_con_rol_en_la_empresa_pasa(monkeypatch: pytest.MonkeyPatch):
    _monkey_fila(monkeypatch, _fila_actual(empresa_codigo="TRONGKAI"))
    _monkey_permitidas(monkeypatch, {"TRONGKAI"})
    fila = await _fila_propia_o_404(_user("claudia@trongkai.com"), _DbFalso(), 7)
    assert fila["empresa_codigo"] == "TRONGKAI"


async def test_fila_de_otra_empresa_responde_el_mismo_404_sin_registrar_violacion(
    monkeypatch: pytest.MonkeyPatch,
):
    # Alguien del grupo ClaudIA con rol sólo en TRONGKAI pide un id de REVTECH:
    # tiene que ver EXACTAMENTE lo mismo que si el id no existiera, y sin que
    # `assert_empresa_access` deje una fila en audit.scope_violations.
    db = _DbFalso()
    _monkey_fila(monkeypatch, _fila_actual(empresa_codigo="REVTECH"))
    _monkey_permitidas(monkeypatch, {"TRONGKAI"})
    with pytest.raises(HTTPException) as ajena:
        await _fila_propia_o_404(_user("alguien@trongkai.com"), db, 7)

    _monkey_fila(monkeypatch, None)
    with pytest.raises(HTTPException) as inexistente:
        await _fila_propia_o_404(_user("alguien@trongkai.com"), db, 7)

    borrada_fila = _fila_actual(empresa_codigo="TRONGKAI", deleted_at=datetime(2026, 9, 1))
    _monkey_fila(monkeypatch, borrada_fila)
    with pytest.raises(HTTPException) as borrada:
        await _fila_propia_o_404(_user("alguien@trongkai.com"), db, 7)

    assert ajena.value.status_code == inexistente.value.status_code == 404
    assert borrada.value.status_code == 404
    assert ajena.value.detail == inexistente.value.detail == borrada.value.detail
    assert ajena.value.detail == "No existe el gasto #7 (o fue borrado)"
    assert not any("scope_violations" in sql for sql, _ in db.llamadas)


async def test_ajeno_al_grupo_recibe_403_antes_de_leer_la_fila(monkeypatch: pytest.MonkeyPatch):
    db = _DbFalso(filas=[])  # sin rol en REVTECH/TRONGKAI
    pedidos = _monkey_fila(monkeypatch, _fila_actual())
    with pytest.raises(HTTPException) as exc:
        await _fila_propia_o_404(_user("ajeno@cenergy.cl"), db, 7)
    assert exc.value.status_code == 403
    assert pedidos == []  # el 403 sale antes de tocar la fila


# ── Historial ───────────────────────────────────────────────────────


def test_diff_snapshots_ignora_auditoria_y_formatea_montos():
    antes = {
        "monto_subsidio": Decimal("0"),
        "estado_pago": "PENDIENTE",
        "updated_at": "2026-08-27T10:00:00",
        "updated_by": "a",
        "created_at": "x",
        "fecha_pago": None,
    }
    despues = {
        "monto_subsidio": Decimal("496451"),
        "estado_pago": "PENDIENTE",
        "updated_at": "2026-08-28T10:00:00",
        "updated_by": "b",
        "created_at": "x",
        "fecha_pago": "2026-08-28",
    }
    cambios = diff_snapshots(antes, despues)
    assert [c.campo for c in cambios] == ["fecha_pago", "monto_subsidio"]
    assert cambios[1].antes == "0.00" and cambios[1].despues == "496451.00"
    assert cambios[0].antes is None and cambios[0].despues == "2026-08-28"


def test_armar_historial_v1_sin_cambios_y_parsea_snapshot_texto():
    filas = [
        {
            "version": 1,
            "accion": "INSERT",
            "changed_by": "claudia@trongkai.com",
            "changed_at": None,
            "snapshot": '{"total": 94352.00, "estado_pago": "PENDIENTE"}',
        },
        {
            "version": 2,
            "accion": "UPDATE",
            "changed_by": "claudia@trongkai.com",
            "changed_at": None,
            "snapshot": '{"total": 94352.00, "estado_pago": "PAGADO"}',
        },
    ]
    h = armar_historial(filas)
    assert h[0].cambios == []
    assert [(c.campo, c.antes, c.despues) for c in h[1].cambios] == [
        ("estado_pago", "PENDIENTE", "PAGADO")
    ]


# ── SQL ─────────────────────────────────────────────────────────────


def test_todo_el_sql_compila_con_asyncpg_sin_binds_sueltos():
    """`:param::tipo` no lo entiende SQLAlchemy — la lección de exports.py."""
    for nombre, sql in SQL_TODOS.items():
        render = str(text(sql).compile(dialect=postgresql.asyncpg.dialect()))
        sobrantes = [s for s in re.findall(r":\w+", render) if not s.startswith("::")]
        assert not sobrantes, f"{nombre}: binds sin sustituir {sobrantes}"
        assert "::" not in sql, f"{nombre}: usar CAST(:x AS tipo), no ::"


def test_mensaje_validacion_saca_el_prefijo_de_pydantic():
    with pytest.raises(ValidationError) as exc:
        EgresoBatchFila.model_validate(
            {"fecha": "2026-08-01", "descripcion": "x", "tipo_documento": "FACTURA", "total": "-5"}
        )
    msg = _mensaje_validacion(exc.value)
    assert msg.startswith("total: ")
    assert "Value error" not in msg


def _fila_batch(**over: Any) -> dict[str, Any]:
    d: dict[str, Any] = {
        "fecha": "2026-08-01", "descripcion": "x", "tipo_documento": "FACTURA", "total": "5",
    }
    d.update(over)
    return d


@pytest.mark.parametrize(
    ("cruda", "esperado"),
    [
        (_fila_batch(descripcion="d" * 501), "descripcion: máximo 500 caracteres"),
        (_fila_batch(observaciones="o" * 2001), "observaciones: máximo 2000 caracteres"),
        ({"fecha": "2026-08-01", "descripcion": "x", "tipo_documento": "FACTURA"},
         "total: falta este campo"),
        (_fila_batch(fecha="ayer"), "fecha: fecha inválida (usá AAAA-MM-DD)"),
        (_fila_batch(corfo={"glosa": "g", "otra": 1}), "corfo.otra: campo desconocido"),
    ],
)
def test_mensaje_validacion_traduce_los_errores_genericos_de_pydantic(cruda, esperado):
    with pytest.raises(ValidationError) as exc:
        EgresoBatchFila.model_validate(cruda)
    assert _mensaje_validacion(exc.value) == esperado


def test_mensaje_validacion_literal_lista_los_valores_esperados():
    with pytest.raises(ValidationError) as exc:
        EgresoBatchFila.model_validate(_fila_batch(tipo_documento="RECIBO"))
    msg = _mensaje_validacion(exc.value)
    assert msg.startswith("tipo_documento: valor no válido (esperado: ")
    assert "'FACTURA'" in msg and "Input should be" not in msg


# ── S2 / D3: POST /importar ─────────────────────────────────────────


class _ArchivoFalso:
    """Lo mínimo de `UploadFile` que usa el endpoint: filename, size y read(n)."""

    def __init__(self, contenido: bytes, nombre: str = "CC Bancos.xlsx", size: int | None = None):
        self.filename = nombre
        self.size = size
        self._buf = io.BytesIO(contenido)
        self.leido = 0

    async def read(self, n: int = -1) -> bytes:
        chunk = self._buf.read(n)
        self.leido += len(chunk)
        return chunk


async def test_upload_con_tamano_declarado_por_encima_del_tope_corta_sin_leer():
    archivo: Any = _ArchivoFalso(b"x", size=claudia_egresos_mod._MAX_UPLOAD_BYTES + 1)
    with pytest.raises(HTTPException) as exc:
        await _leer_upload_acotado(archivo)
    assert exc.value.status_code == 413
    assert "15 MB" in str(exc.value.detail)
    assert archivo.leido == 0


async def test_upload_por_chunks_corta_apenas_supera_el_tope(monkeypatch: pytest.MonkeyPatch):
    mib = 1024 * 1024
    monkeypatch.setattr(claudia_egresos_mod, "_MAX_UPLOAD_BYTES", 2 * mib)
    archivo: Any = _ArchivoFalso(b"x" * (20 * mib))  # sin `size`: sólo se sabe leyendo
    with pytest.raises(HTTPException) as exc:
        await _leer_upload_acotado(archivo)
    assert exc.value.status_code == 413
    assert "2 MB" in str(exc.value.detail)
    # se cortó en el tercer chunk de 1 MiB: nunca se materializaron los 20 MB
    assert archivo.leido <= 3 * mib


async def test_upload_chico_se_lee_entero_aunque_cruce_varios_chunks():
    contenido = bytes(range(256)) * 5000  # 1,28 MB → dos chunks
    assert await _leer_upload_acotado(_ArchivoFalso(contenido)) == contenido  # type: ignore[arg-type]


async def test_importar_leidas_viene_del_parseo_no_de_len_filas(monkeypatch: pytest.MonkeyPatch):
    """D3: `leidas` son las filas con datos del Excel (cargables + saltadas),
    no `len(filas)`; y `duplicadas_en_excel` cuenta las repetidas que entraron."""
    parseo = ResultadoParseo(
        filas=[object(), object(), object()],  # type: ignore[list-item]  # 3 cargables…
        saltadas=[FilaSaltada(29, "Fecha inválida (None) — Nc Doing Spa, total 950000")],
        repetidas_en_excel=[6],  # …una de ellas es la repetida de la fila 5
        columnas=["Fecha", "Descripción", "Total"],
    )
    resumen = ResumenCarga(
        empresa_codigo="REVTECH", dry_run=True, leidas=3, creadas=2,
        omitidas_existentes=1, descuadradas=0, sin_clasificar=1,
    )
    recibido: dict[str, Any] = {}

    def _parsear(contenido: bytes, empresa: str) -> ResultadoParseo:
        recibido["contenido"], recibido["empresa"] = contenido, empresa
        return parseo

    async def _cargar(_db: Any, empresa: str, filas: Any, usuario: str, dry_run: bool = False):
        recibido["filas"], recibido["dry_run"], recibido["usuario"] = filas, dry_run, usuario
        return resumen

    monkeypatch.setattr(claudia_egresos_mod, "parsear_registro_egresos", _parsear)
    monkeypatch.setattr(claudia_egresos_mod, "cargar_filas", _cargar)

    resp = await importar_excel(
        user=_user("nicolas@cehtacapital.com", "admin"),
        db=_DbFalso(),  # type: ignore[arg-type]
        archivo=_ArchivoFalso(b"PK\x03\x04 no importa: el parser es falso"),  # type: ignore[arg-type]
        empresa_codigo="revtech",
        dry_run=True,
    )

    assert resp.leidas == parseo.leidas == 4
    assert resp.leidas == len(parseo.filas) + len(parseo.saltadas)
    assert resp.leidas != len(parseo.filas)
    assert (resp.creadas, resp.omitidas_existentes) == (2, 1)
    assert resp.duplicadas_en_excel == 1
    assert [(s.fila_excel, s.motivo[:15]) for s in resp.saltadas] == [(29, "Fecha inválida ")]
    assert (resp.descuadradas, resp.sin_clasificar) == (0, 1)
    assert resp.empresa_codigo == "REVTECH" and resp.dry_run is True
    assert recibido["empresa"] == "REVTECH" and recibido["contenido"].startswith(b"PK")
    assert recibido["filas"] is parseo.filas and recibido["dry_run"] is True
    assert recibido["usuario"] == "nicolas@cehtacapital.com"


async def test_importar_rechaza_extension_y_archivo_vacio():
    admin = _user("nicolas@cehtacapital.com", "admin")
    with pytest.raises(HTTPException) as exc:
        await importar_excel(
            user=admin, db=_DbFalso(), archivo=_ArchivoFalso(b"x", nombre="viejo.xls"),  # type: ignore[arg-type]
            empresa_codigo="REVTECH", dry_run=True,
        )
    assert exc.value.status_code == 415 and ".xlsx" in str(exc.value.detail)
    with pytest.raises(HTTPException) as exc:
        await importar_excel(
            user=admin, db=_DbFalso(), archivo=_ArchivoFalso(b""),  # type: ignore[arg-type]
            empresa_codigo="REVTECH", dry_run=True,
        )
    assert exc.value.status_code == 422 and "vacío" in str(exc.value.detail)
