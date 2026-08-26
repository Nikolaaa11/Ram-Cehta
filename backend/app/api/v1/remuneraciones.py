"""API de la sección Remuneraciones.

Calcula liquidaciones chilenas con el motor puro de
`domain/value_objects/remuneracion.py`, versiona los parámetros por período y
CONCILIA contra los libros del contador que ya viven en
`core.libro_remuneraciones_lineas`.

Acceso: el MISMO gate que el módulo RRHH (`_check_rrhh_access`) — una
liquidación es el dato más sensible de la plataforma después de las claves.
Se importa el privado de `rrhh.py` a propósito: duplicar la regla acá es como
nacen los dos gates que divergen.
"""
from __future__ import annotations

import json
from dataclasses import asdict
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.api.v1.rrhh import _check_rrhh_access
from app.domain.value_objects.remuneracion import (
    EntradaLiquidacion,
    LiquidacionResultado,
    ParametroFaltanteError,
    ParametrosMes,
    calcular_liquidacion,
)

router = APIRouter()

_PERIODO_RE = r"^\d{4}-(0[1-9]|1[0-2])$"


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────


def _d(v: Any, default: str = "0") -> Decimal:
    """A Decimal, tolerante con strings del formulario. Nunca None."""
    if v is None or v == "":
        return Decimal(default)
    try:
        return Decimal(str(v))
    except InvalidOperation as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Número inválido: {v!r}",
        ) from exc


def _res_a_dict(r: LiquidacionResultado) -> dict[str, Any]:
    """El desglose como JSON: Decimals a string (es plata, no float)."""
    out: dict[str, Any] = {}
    for k, v in asdict(r).items():
        if isinstance(v, Decimal):
            out[k] = str(v)
        elif isinstance(v, tuple):
            out[k] = list(v)
        else:
            out[k] = v
    return out


async def _cargar_parametros(db: DBSession, periodo: str) -> ParametrosMes:
    """Los parámetros del período desde la BD, en el dataclass del motor.

    Si el período no existe se CREA copiando el más reciente anterior, con
    UF/UTM en NULL: así abrir un mes nuevo nunca hereda indicadores viejos
    disfrazados de vigentes, pero tampoco obliga a retipear las siete tasas.
    """
    fila = (
        await db.execute(
            text("SELECT * FROM core.remun_parametros WHERE periodo = :p"),
            {"p": periodo},
        )
    ).mappings().first()

    if fila is None:
        base = (
            await db.execute(
                text(
                    "SELECT periodo FROM core.remun_parametros "
                    "WHERE periodo < :p ORDER BY periodo DESC LIMIT 1"
                ),
                {"p": periodo},
            )
        ).scalar()
        if base is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=(
                    f"No hay parámetros para {periodo} ni un período anterior "
                    "del que copiarlos. Corré el seed de remuneraciones."
                ),
            )
        await db.execute(
            text(
                """
                INSERT INTO core.remun_parametros
                SELECT :p, NULL, NULL, ingreso_minimo, tope_imponible_uf,
                       tope_afc_uf, jornada_horas, cotizacion_afp_pct,
                       salud_legal_pct, afc_trab_indefinido_pct,
                       afc_emp_indefinido_pct, afc_emp_plazo_fijo_pct,
                       sis_pct, mutual_pct, reforma_cuenta_individual_pct,
                       reforma_seguro_social_pct, apv_tope_uf,
                       'Copiado de ' || periodo || ' — CARGAR UF y UTM.',
                       now(), NULL
                  FROM core.remun_parametros WHERE periodo = :base
                ON CONFLICT (periodo) DO NOTHING
                """
            ),
            {"p": periodo, "base": base},
        )
        for tabla, cols in (
            ("remun_afp_comisiones", "afp, comision_pct"),
            ("remun_asignacion_familiar", "orden, hasta, monto"),
        ):
            await db.execute(
                text(
                    f"INSERT INTO core.{tabla} (periodo, {cols}) "  # noqa: S608 — tupla literal de arriba
                    f"SELECT :p, {cols} FROM core.{tabla} WHERE periodo = :base "
                    "ON CONFLICT DO NOTHING"
                ),
                {"p": periodo, "base": base},
            )
        await db.commit()
        return await _cargar_parametros(db, periodo)

    afp = (
        await db.execute(
            text(
                "SELECT afp, comision_pct FROM core.remun_afp_comisiones "
                "WHERE periodo = :p"
            ),
            {"p": periodo},
        )
    ).mappings().all()
    tramos = (
        await db.execute(
            text(
                "SELECT hasta, monto FROM core.remun_asignacion_familiar "
                "WHERE periodo = :p ORDER BY orden"
            ),
            {"p": periodo},
        )
    ).mappings().all()

    return ParametrosMes(
        periodo=periodo,
        uf=fila["uf"],
        utm=fila["utm"],
        ingreso_minimo=fila["ingreso_minimo"],
        tope_imponible_uf=fila["tope_imponible_uf"],
        tope_afc_uf=fila["tope_afc_uf"],
        jornada_horas=fila["jornada_horas"],
        cotizacion_afp_pct=fila["cotizacion_afp_pct"],
        salud_legal_pct=fila["salud_legal_pct"],
        afc_trab_indefinido_pct=fila["afc_trab_indefinido_pct"],
        afc_emp_indefinido_pct=fila["afc_emp_indefinido_pct"],
        afc_emp_plazo_fijo_pct=fila["afc_emp_plazo_fijo_pct"],
        sis_pct=fila["sis_pct"],
        mutual_pct=fila["mutual_pct"],
        reforma_cuenta_individual_pct=fila["reforma_cuenta_individual_pct"],
        reforma_seguro_social_pct=fila["reforma_seguro_social_pct"],
        apv_tope_uf=fila["apv_tope_uf"],
        comisiones_afp={f["afp"]: f["comision_pct"] for f in afp},
        asignacion_familiar=tuple((t["hasta"], t["monto"]) for t in tramos),
    )


# ─────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────


class EntradaIn(BaseModel):
    """La entrada del cálculo, como la manda el formulario."""

    sueldo_base: Decimal = Field(..., ge=0)
    dias_trabajados: Decimal = Decimal("30")
    horas_extra: Decimal = Decimal("0")
    recargo_horas_extra_pct: Decimal = Decimal("50")
    comisiones: Decimal = Decimal("0")
    bonos_imponibles: Decimal = Decimal("0")
    gratificacion_tipo: str = "ART50_TOPE"
    gratificacion_monto_fijo: Decimal = Decimal("0")
    colacion: Decimal = Decimal("0")
    movilizacion: Decimal = Decimal("0")
    viaticos: Decimal = Decimal("0")
    otros_no_imponibles: Decimal = Decimal("0")
    cargas_familiares: int = 0
    afp: str | None = None
    salud_sistema: str = "FONASA"
    isapre_plan_uf: Decimal = Decimal("0")
    tipo_contrato: str = "INDEFINIDO"
    apv_mensual: Decimal = Decimal("0")
    anticipos: Decimal = Decimal("0")
    otros_descuentos: Decimal = Decimal("0")
    mutual_pct_override: Decimal | None = None

    def al_motor(self) -> EntradaLiquidacion:
        return EntradaLiquidacion(**self.model_dump())


class CalcularRequest(BaseModel):
    periodo: str = Field(..., pattern=_PERIODO_RE)
    entrada: EntradaIn


class GuardarRequest(CalcularRequest):
    empresa_codigo: str
    empleado_rut: str
    empleado_nombre: str


class GenerarMesRequest(BaseModel):
    empresa_codigo: str
    periodo: str = Field(..., pattern=_PERIODO_RE)


# ─────────────────────────────────────────────────────────────────────
# Parámetros del período
# ─────────────────────────────────────────────────────────────────────


@router.get("/parametros")
async def get_parametros(
    user: CurrentUser,
    db: DBSession,
    periodo: str = Query(..., pattern=_PERIODO_RE),
) -> dict[str, Any]:
    """Los parámetros del período. Crea el período copiando el anterior
    (con UF/UTM vacías) si no existe — abrir el mes es automático."""
    await _check_rrhh_access(user, db)
    p = await _cargar_parametros(db, periodo)
    fila = (
        await db.execute(
            text(
                "SELECT notas, updated_at, updated_by "
                "FROM core.remun_parametros WHERE periodo = :p"
            ),
            {"p": periodo},
        )
    ).mappings().first()
    return {
        "periodo": p.periodo,
        "uf": str(p.uf) if p.uf is not None else None,
        "utm": str(p.utm) if p.utm is not None else None,
        "listo_para_calcular": p.uf is not None and p.utm is not None,
        "ingreso_minimo": str(p.ingreso_minimo),
        "tope_imponible_uf": str(p.tope_imponible_uf),
        "tope_afc_uf": str(p.tope_afc_uf),
        "jornada_horas": str(p.jornada_horas),
        "cotizacion_afp_pct": str(p.cotizacion_afp_pct),
        "salud_legal_pct": str(p.salud_legal_pct),
        "afc_trab_indefinido_pct": str(p.afc_trab_indefinido_pct),
        "afc_emp_indefinido_pct": str(p.afc_emp_indefinido_pct),
        "afc_emp_plazo_fijo_pct": str(p.afc_emp_plazo_fijo_pct),
        "sis_pct": str(p.sis_pct),
        "mutual_pct": str(p.mutual_pct),
        "reforma_cuenta_individual_pct": str(p.reforma_cuenta_individual_pct),
        "reforma_seguro_social_pct": str(p.reforma_seguro_social_pct),
        "apv_tope_uf": str(p.apv_tope_uf),
        "comisiones_afp": {k: str(v) for k, v in p.comisiones_afp.items()},
        "asignacion_familiar": [
            {"hasta": str(h) if h is not None else None, "monto": str(m)}
            for h, m in p.asignacion_familiar
        ],
        "notas": fila["notas"] if fila else None,
        "updated_at": str(fila["updated_at"]) if fila else None,
        "updated_by": fila["updated_by"] if fila else None,
    }


class ParametrosUpdate(BaseModel):
    """PATCH de parámetros. None = no tocar. Sólo lo editable mes a mes."""

    uf: Decimal | None = None
    utm: Decimal | None = None
    ingreso_minimo: Decimal | None = None
    tope_imponible_uf: Decimal | None = None
    tope_afc_uf: Decimal | None = None
    jornada_horas: Decimal | None = None
    sis_pct: Decimal | None = None
    mutual_pct: Decimal | None = None
    reforma_cuenta_individual_pct: Decimal | None = None
    reforma_seguro_social_pct: Decimal | None = None
    comisiones_afp: dict[str, Decimal] | None = None


@router.put("/parametros/{periodo}")
async def put_parametros(
    user: CurrentUser,
    db: DBSession,
    periodo: str,
    body: ParametrosUpdate,
) -> dict[str, Any]:
    await _check_rrhh_access(user, db)
    await _cargar_parametros(db, periodo)  # crea el período si falta

    campos = body.model_dump(exclude_unset=True, exclude={"comisiones_afp"})
    sets = ", ".join(f"{k} = :{k}" for k in campos)
    if campos:
        await db.execute(
            # `sets` se arma SOLO con nombres de campo del modelo pydantic
            # (allowlist); los VALORES van todos por bind parameters.
            text(
                f"UPDATE core.remun_parametros SET {sets}, "  # noqa: S608
                "updated_at = now(), updated_by = :quien WHERE periodo = :p"
            ),
            {**campos, "quien": user.email, "p": periodo},
        )
    if body.comisiones_afp:
        for afp, pct in body.comisiones_afp.items():
            await db.execute(
                text(
                    "INSERT INTO core.remun_afp_comisiones (periodo, afp, comision_pct) "
                    "VALUES (:p, :a, :c) "
                    "ON CONFLICT (periodo, afp) DO UPDATE SET comision_pct = :c"
                ),
                {"p": periodo, "a": afp.strip().upper(), "c": pct},
            )
    await db.commit()
    return await get_parametros(user, db, periodo)  # type: ignore[arg-type]


# ─────────────────────────────────────────────────────────────────────
# Calcular (vista previa pura) y ejemplos vivos
# ─────────────────────────────────────────────────────────────────────


@router.post("/calcular")
async def calcular(
    user: CurrentUser, db: DBSession, body: CalcularRequest
) -> dict[str, Any]:
    """Vista previa: calcula sin guardar. Los errores de parámetros salen
    como 422 con el mensaje accionable del motor."""
    await _check_rrhh_access(user, db)
    p = await _cargar_parametros(db, body.periodo)
    try:
        r = calcular_liquidacion(body.entrada.al_motor(), p)
    except (ParametroFaltanteError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return {"periodo": body.periodo, "resultado": _res_a_dict(r)}


#: Los casos de la pestaña "Guía y ejemplos". Cada uno enseña UNA regla.
_EJEMPLOS: list[dict[str, Any]] = [
    {
        "titulo": "1 · Sueldo simple con Fonasa",
        "explica": (
            "El caso base: AFP 10 % + comisión, salud 7 %, cesantía 0,6 %, "
            "gratificación Art. 50 al 25 % (no llega al tope) y sin impuesto "
            "por quedar bajo 13,5 UTM."
        ),
        "entrada": {"sueldo_base": "700000", "afp": "MODELO"},
    },
    {
        "titulo": "2 · Gratificación al tope legal (línea real del libro)",
        "explica": (
            "Idéntico a una línea real del libro de abril 2026: el 25 % "
            "supera 4,75xIMM/12 y la gratificación se topa en $213.354. "
            "Entra al tramo del 4 % de impuesto único."
        ),
        "entrada": {
            "sueldo_base": "1986646",
            "afp": "CAPITAL",
            "mutual_pct_override": "2.63",
        },
    },
    {
        "titulo": "3 · Isapre con plan en UF",
        "explica": (
            "El plan pactado en UF reemplaza al 7 %: se descuenta el plan "
            "completo (así lo hace el contador) y el exceso sobre el 7 % se "
            "muestra aparte."
        ),
        "entrada": {
            "sueldo_base": "2500000",
            "afp": "HABITAT",
            "salud_sistema": "ISAPRE",
            "isapre_plan_uf": "4.5",
        },
    },
    {
        "titulo": "4 · Plazo fijo con cargas familiares",
        "explica": (
            "A plazo fijo el trabajador NO cotiza cesantía: el empleador paga "
            "el 3,0 % completo. Las cargas pagan por tramo según la renta."
        ),
        "entrada": {
            "sueldo_base": "600000",
            "afp": "UNO",
            "tipo_contrato": "PLAZO_FIJO",
            "cargas_familiares": 2,
        },
    },
    {
        "titulo": "5 · Renta sobre el tope imponible",
        "explica": (
            "Las cotizaciones se calculan sobre 87,8 UF aunque el sueldo sea "
            "mayor (la cesantía topa aparte, en 131,9 UF). El impuesto único "
            "sí corre sobre toda la base tributable."
        ),
        "entrada": {
            "sueldo_base": "4786646",
            "afp": "CAPITAL",
            "horas_extra": "8",
        },
    },
]


@router.get("/ejemplos")
async def ejemplos(
    user: CurrentUser,
    db: DBSession,
    periodo: str = Query(..., pattern=_PERIODO_RE),
) -> dict[str, Any]:
    """Los 5 ejemplos de la guía, calculados EN VIVO por el mismo motor.

    Si el período pedido no tiene UF/UTM, se calculan con parámetros
    ilustrativos redondos (UF 40.000 / UTM 70.000) y se dice — un ejemplo no
    puede quedarse en blanco, pero tampoco fingir indicadores reales.
    """
    await _check_rrhh_access(user, db)
    p = await _cargar_parametros(db, periodo)
    ilustrativo = p.uf is None or p.utm is None
    if ilustrativo:
        p = ParametrosMes(
            periodo=periodo,
            uf=Decimal("40000"),
            utm=Decimal("70000"),
            ingreso_minimo=p.ingreso_minimo,
            comisiones_afp=p.comisiones_afp,
            asignacion_familiar=p.asignacion_familiar,
            sis_pct=p.sis_pct,
            mutual_pct=p.mutual_pct,
            jornada_horas=p.jornada_horas,
        )
    salida = []
    for ej in _EJEMPLOS:
        entrada = EntradaIn(**ej["entrada"])
        r = calcular_liquidacion(entrada.al_motor(), p)
        salida.append(
            {
                "titulo": ej["titulo"],
                "explica": ej["explica"],
                "entrada": {
                    k: str(v) for k, v in entrada.model_dump().items()
                    if v not in (None, "")
                },
                "resultado": _res_a_dict(r),
            }
        )
    return {
        "periodo": periodo,
        "parametros_ilustrativos": ilustrativo,
        "ejemplos": salida,
    }


# ─────────────────────────────────────────────────────────────────────
# Sugerencias de configuración
# ─────────────────────────────────────────────────────────────────────


async def _sugerencias_empresa(
    db: DBSession, empresa: str, periodo: str
) -> list[dict[str, Any]]:
    """Config sugerida por empleado activo. NADA se inventa: cada campo dice
    de dónde salió (ficha RRHH, última liquidación, o el libro del contador),
    y lo que no se puede saber queda como pendiente."""
    empleados = (
        await db.execute(
            text(
                "SELECT rut, nombre, afp, salud, sueldo_base_actual "
                "FROM core.empleados "
                "WHERE empresa_codigo = :e AND activo ORDER BY nombre"
            ),
            {"e": empresa},
        )
    ).mappings().all()

    # El mutual implícito del último libro de la empresa: mutual/imponible.
    mutual_libro = (
        await db.execute(
            text(
                """
                SELECT CASE WHEN sum(l.total_haberes) > 0
                       THEN round(sum(l.mutual) / sum(l.total_haberes) * 100, 2)
                       END AS pct
                  FROM core.libro_remuneraciones_lineas l
                  JOIN core.libros_remuneraciones b ON b.id = l.libro_id
                 WHERE b.empresa_codigo = :e
                   AND b.periodo = (
                       SELECT max(periodo) FROM core.libros_remuneraciones
                        WHERE empresa_codigo = :e)
                """
            ),
            {"e": empresa},
        )
    ).scalar()

    salida = []
    for emp in empleados:
        previa = (
            await db.execute(
                text(
                    "SELECT entrada FROM core.remun_liquidaciones "
                    "WHERE empresa_codigo = :e AND empleado_rut = :r "
                    "  AND periodo < :p ORDER BY periodo DESC LIMIT 1"
                ),
                {"e": empresa, "r": emp["rut"], "p": periodo},
            )
        ).scalar()
        entrada_previa = previa if isinstance(previa, dict) else {}

        pendientes: list[str] = []
        afp = emp["afp"] or entrada_previa.get("afp")
        if not afp:
            pendientes.append(
                "Sin AFP: cargarla en la ficha RRHH o elegirla al calcular."
            )
        salud = (emp["salud"] or entrada_previa.get("salud_sistema") or "FONASA")
        salud = "ISAPRE" if "ISAPRE" in str(salud).upper() else "FONASA"

        sugerida = {
            "sueldo_base": str(
                emp["sueldo_base_actual"]
                or entrada_previa.get("sueldo_base") or "0"
            ),
            "afp": afp,
            "salud_sistema": salud,
            "isapre_plan_uf": entrada_previa.get("isapre_plan_uf", "0"),
            "tipo_contrato": entrada_previa.get("tipo_contrato", "INDEFINIDO"),
            "cargas_familiares": entrada_previa.get("cargas_familiares", 0),
            "colacion": entrada_previa.get("colacion", "0"),
            "movilizacion": entrada_previa.get("movilizacion", "0"),
            "mutual_pct_override": (
                entrada_previa.get("mutual_pct_override")
                or (str(mutual_libro) if mutual_libro is not None else None)
            ),
        }
        if str(sugerida["sueldo_base"]) in ("0", "None"):
            pendientes.append("Sin sueldo base en la ficha RRHH.")

        salida.append(
            {
                "empleado_rut": emp["rut"],
                "empleado_nombre": emp["nombre"],
                "sugerida": sugerida,
                "pendientes": pendientes,
                "fuentes": {
                    "sueldo": "ficha RRHH" if emp["sueldo_base_actual"] else "última liquidación",
                    "afp": (
                        "ficha RRHH" if emp["afp"]
                        else "última liquidación" if entrada_previa.get("afp")
                        else "—"
                    ),
                    "mutual": (
                        "libro del contador" if mutual_libro is not None
                        else "parámetro del mes"
                    ),
                },
            }
        )
    return salida


@router.get("/sugerencias")
async def sugerencias(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str = Query(...),
    periodo: str = Query(..., pattern=_PERIODO_RE),
) -> dict[str, Any]:
    await _check_rrhh_access(user, db)
    return {
        "empresa_codigo": empresa_codigo,
        "periodo": periodo,
        "empleados": await _sugerencias_empresa(db, empresa_codigo, periodo),
    }


# ─────────────────────────────────────────────────────────────────────
# Liquidaciones persistidas
# ─────────────────────────────────────────────────────────────────────


async def _guardar_liquidacion(
    db: DBSession,
    user: Any,
    *,
    empresa: str,
    rut: str,
    nombre: str,
    periodo: str,
    entrada: EntradaIn,
) -> dict[str, Any]:
    p = await _cargar_parametros(db, periodo)
    r = calcular_liquidacion(entrada.al_motor(), p)
    res = _res_a_dict(r)
    fila = (
        await db.execute(
            text(
                """
                INSERT INTO core.remun_liquidaciones
                    (empresa_codigo, empleado_rut, empleado_nombre, periodo,
                     entrada, resultado, total_haberes, total_descuentos,
                     liquido, costo_empresa, calculada_por)
                VALUES (:e, :r, :n, :p, CAST(:ent AS JSONB),
                        CAST(:res AS JSONB), :th, :td, :liq, :ce, :quien)
                ON CONFLICT (empresa_codigo, empleado_rut, periodo)
                DO UPDATE SET
                    entrada = EXCLUDED.entrada,
                    resultado = EXCLUDED.resultado,
                    total_haberes = EXCLUDED.total_haberes,
                    total_descuentos = EXCLUDED.total_descuentos,
                    liquido = EXCLUDED.liquido,
                    costo_empresa = EXCLUDED.costo_empresa,
                    calculada_por = EXCLUDED.calculada_por,
                    updated_at = now()
                WHERE core.remun_liquidaciones.estado = 'BORRADOR'
                RETURNING liquidacion_id, estado
                """
            ),
            {
                "e": empresa,
                "r": rut,
                "n": nombre,
                "p": periodo,
                "ent": json.dumps(
                    {k: str(v) if isinstance(v, Decimal) else v
                     for k, v in entrada.model_dump().items()},
                ),
                "res": json.dumps(res),
                "th": r.total_haberes,
                "td": r.total_descuentos,
                "liq": r.liquido,
                "ce": r.costo_empresa,
                "quien": user.email,
            },
        )
    ).mappings().first()
    if fila is None:
        # El ON CONFLICT no actualizó: la liquidación existe y está CONFIRMADA.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"La liquidación de {nombre} para {periodo} ya está "
                "CONFIRMADA: reabrila antes de recalcular."
            ),
        )
    return {"liquidacion_id": fila["liquidacion_id"], "resultado": res}


@router.post("/liquidaciones", status_code=status.HTTP_201_CREATED)
async def crear_liquidacion(
    user: CurrentUser, db: DBSession, body: GuardarRequest
) -> dict[str, Any]:
    await _check_rrhh_access(user, db)
    try:
        out = await _guardar_liquidacion(
            db, user,
            empresa=body.empresa_codigo, rut=body.empleado_rut,
            nombre=body.empleado_nombre, periodo=body.periodo,
            entrada=body.entrada,
        )
    except (ParametroFaltanteError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await db.commit()
    return out


@router.post("/generar-mes")
async def generar_mes(
    user: CurrentUser, db: DBSession, body: GenerarMesRequest
) -> dict[str, Any]:
    """El batch: BORRADORES para todos los empleados activos sin liquidación,
    con la config sugerida. Los que no se puedan calcular (sin AFP, sin
    sueldo) quedan reportados como pendientes, no tumban el resto."""
    await _check_rrhh_access(user, db)
    sugeridas = await _sugerencias_empresa(db, body.empresa_codigo, body.periodo)
    creadas, saltadas, pendientes = [], [], []
    for s in sugeridas:
        existe = (
            await db.execute(
                text(
                    "SELECT estado FROM core.remun_liquidaciones "
                    "WHERE empresa_codigo=:e AND empleado_rut=:r AND periodo=:p"
                ),
                {"e": body.empresa_codigo, "r": s["empleado_rut"], "p": body.periodo},
            )
        ).scalar()
        if existe:
            saltadas.append({"empleado_rut": s["empleado_rut"], "estado": existe})
            continue
        if s["pendientes"]:
            pendientes.append(
                {"empleado_rut": s["empleado_rut"],
                 "empleado_nombre": s["empleado_nombre"],
                 "motivos": s["pendientes"]}
            )
            continue
        cfg = s["sugerida"]
        entrada = EntradaIn(
            sueldo_base=_d(cfg["sueldo_base"]),
            afp=cfg["afp"],
            salud_sistema=cfg["salud_sistema"],
            isapre_plan_uf=_d(cfg.get("isapre_plan_uf")),
            tipo_contrato=cfg.get("tipo_contrato") or "INDEFINIDO",
            cargas_familiares=int(cfg.get("cargas_familiares") or 0),
            colacion=_d(cfg.get("colacion")),
            movilizacion=_d(cfg.get("movilizacion")),
            mutual_pct_override=(
                _d(cfg["mutual_pct_override"])
                if cfg.get("mutual_pct_override") else None
            ),
        )
        try:
            out = await _guardar_liquidacion(
                db, user,
                empresa=body.empresa_codigo, rut=s["empleado_rut"],
                nombre=s["empleado_nombre"], periodo=body.periodo,
                entrada=entrada,
            )
            creadas.append(
                {"empleado_rut": s["empleado_rut"],
                 "empleado_nombre": s["empleado_nombre"],
                 "liquidacion_id": out["liquidacion_id"],
                 "liquido": out["resultado"]["liquido"]}
            )
        except (ParametroFaltanteError, ValueError, HTTPException) as exc:
            detalle = getattr(exc, "detail", None) or str(exc)
            pendientes.append(
                {"empleado_rut": s["empleado_rut"],
                 "empleado_nombre": s["empleado_nombre"],
                 "motivos": [str(detalle)]}
            )
    await db.commit()
    return {"creadas": creadas, "saltadas": saltadas, "pendientes": pendientes}


@router.get("/liquidaciones")
async def listar_liquidaciones(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str = Query(...),
    periodo: str = Query(..., pattern=_PERIODO_RE),
) -> dict[str, Any]:
    await _check_rrhh_access(user, db)
    filas = (
        await db.execute(
            text(
                """
                SELECT liquidacion_id, empleado_rut, empleado_nombre, estado,
                       total_haberes, total_descuentos, liquido, costo_empresa,
                       updated_at
                  FROM core.remun_liquidaciones
                 WHERE empresa_codigo = :e AND periodo = :p
                 ORDER BY empleado_nombre
                """
            ),
            {"e": empresa_codigo, "p": periodo},
        )
    ).mappings().all()
    return {
        "items": [dict(f, total_haberes=str(f["total_haberes"]),
                       total_descuentos=str(f["total_descuentos"]),
                       liquido=str(f["liquido"]),
                       costo_empresa=str(f["costo_empresa"]),
                       updated_at=str(f["updated_at"])) for f in filas],
        "totales": {
            "haberes": str(sum((f["total_haberes"] for f in filas), Decimal("0"))),
            "liquido": str(sum((f["liquido"] for f in filas), Decimal("0"))),
            "costo_empresa": str(sum((f["costo_empresa"] for f in filas), Decimal("0"))),
        },
    }


@router.get("/liquidaciones/{liquidacion_id:int}")
async def get_liquidacion(
    user: CurrentUser, db: DBSession, liquidacion_id: int
) -> dict[str, Any]:
    await _check_rrhh_access(user, db)
    fila = (
        await db.execute(
            text("SELECT * FROM core.remun_liquidaciones WHERE liquidacion_id = :i"),
            {"i": liquidacion_id},
        )
    ).mappings().first()
    if not fila:
        raise HTTPException(status_code=404, detail="Liquidación no encontrada")
    out = dict(fila)
    for k in ("total_haberes", "total_descuentos", "liquido", "costo_empresa",
              "created_at", "updated_at"):
        out[k] = str(out[k])
    return out


class EstadoRequest(BaseModel):
    estado: str = Field(..., pattern="^(BORRADOR|CONFIRMADA)$")


@router.patch("/liquidaciones/{liquidacion_id:int}/estado")
async def cambiar_estado(
    user: CurrentUser, db: DBSession, liquidacion_id: int, body: EstadoRequest
) -> dict[str, Any]:
    await _check_rrhh_access(user, db)
    n = (
        await db.execute(
            text(
                "UPDATE core.remun_liquidaciones SET estado = :s, "
                "updated_at = now() WHERE liquidacion_id = :i "
                "RETURNING liquidacion_id"
            ),
            {"s": body.estado, "i": liquidacion_id},
        )
    ).scalar()
    if n is None:
        raise HTTPException(status_code=404, detail="Liquidación no encontrada")
    await db.commit()
    return {"liquidacion_id": liquidacion_id, "estado": body.estado}


@router.delete(
    "/liquidaciones/{liquidacion_id:int}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def borrar_liquidacion(
    user: CurrentUser, db: DBSession, liquidacion_id: int
) -> Response:
    """Sólo BORRADOR: una confirmada primero se reabre — dos pasos a
    propósito, para que borrar una liquidación cerrada no sea un clic."""
    await _check_rrhh_access(user, db)
    fila = (
        await db.execute(
            text(
                "DELETE FROM core.remun_liquidaciones "
                "WHERE liquidacion_id = :i AND estado = 'BORRADOR' "
                "RETURNING liquidacion_id"
            ),
            {"i": liquidacion_id},
        )
    ).scalar()
    if fila is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No existe o está CONFIRMADA (reabrila primero).",
        )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ─────────────────────────────────────────────────────────────────────
# Conciliación contra el libro del contador
# ─────────────────────────────────────────────────────────────────────

#: (campo del motor en `resultado`, columna del libro, tolerancia en $).
#: $2 para lo redondeado a peso — el contador puede redondear distinto en una
#: cifra intermedia; más que eso ya no es redondeo, es diferencia real.
_MAPA_CONCILIACION: tuple[tuple[str, str, str], ...] = (
    ("total_haberes", "total_haberes", "2"),
    ("gratificacion", "gratificacion_legal", "2"),
    ("base_tributable", "base_tributable", "2"),
    ("impuesto_unico", "impuesto_unico", "0.05"),
    ("liquido", "liquido_pagado", "2"),
    ("sis", "sis", "2"),
    ("afc_empleador", "seguro_cesantia_empleador", "2"),
    ("mutual", "mutual", "2"),
    ("reforma_cuenta_individual", "aporte_afp_empleador", "2"),
    ("reforma_seguro_social", "seguro_social", "2"),
)


@router.get("/conciliacion")
async def conciliacion(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str = Query(...),
    periodo: str = Query(..., pattern=_PERIODO_RE),
) -> dict[str, Any]:
    """Mi cálculo vs el libro de MCG, columna por columna.

    Es la definición operativa de "sin errores": dos fuentes independientes
    que cierran. Cada diferencia dice el campo, mi número y el del contador —
    la decisión de a quién creerle es humana, pero la diferencia no se
    esconde.
    """
    await _check_rrhh_access(user, db)
    libro = (
        await db.execute(
            text(
                "SELECT id FROM core.libros_remuneraciones "
                "WHERE empresa_codigo = :e AND periodo = :p "
                "ORDER BY uploaded_at DESC LIMIT 1"
            ),
            {"e": empresa_codigo, "p": periodo},
        )
    ).scalar()
    if libro is None:
        return {
            "hay_libro": False,
            "mensaje": (
                f"No hay libro del contador subido para {empresa_codigo} "
                f"{periodo}: no hay contra qué conciliar. Subilo en RRHH → "
                "Libros."
            ),
            "empleados": [],
        }

    lineas = {
        fila_libro["empleado_rut"]: fila_libro
        for fila_libro in (
            await db.execute(
                text(
                    "SELECT * FROM core.libro_remuneraciones_lineas "
                    "WHERE libro_id = :l"
                ),
                {"l": libro},
            )
        ).mappings().all()
    }
    liqs = (
        await db.execute(
            text(
                "SELECT empleado_rut, empleado_nombre, resultado "
                "FROM core.remun_liquidaciones "
                "WHERE empresa_codigo = :e AND periodo = :p"
            ),
            {"e": empresa_codigo, "p": periodo},
        )
    ).mappings().all()

    empleados, cuadran = [], 0
    for liq in liqs:
        linea = lineas.pop(liq["empleado_rut"], None)
        if linea is None:
            empleados.append(
                {"empleado_rut": liq["empleado_rut"],
                 "empleado_nombre": liq["empleado_nombre"],
                 "estado": "SOLO_EN_PLATAFORMA",
                 "diferencias": []}
            )
            continue
        res = liq["resultado"]
        difs = []
        for campo, col, tol in _MAPA_CONCILIACION:
            mio = Decimal(str(res.get(campo, "0")))
            suyo = Decimal(str(linea[col] if linea[col] is not None else "0"))
            if abs(mio - suyo) > Decimal(tol):
                difs.append(
                    {"campo": campo, "plataforma": str(mio),
                     "libro": str(suyo), "diferencia": str(mio - suyo)}
                )
        if not difs:
            cuadran += 1
        empleados.append(
            {"empleado_rut": liq["empleado_rut"],
             "empleado_nombre": liq["empleado_nombre"],
             "estado": "CUADRA" if not difs else "DIFIERE",
             "diferencias": difs}
        )
    for rut, linea in lineas.items():
        empleados.append(
            {"empleado_rut": rut, "empleado_nombre": linea["nombre"],
             "estado": "SOLO_EN_LIBRO", "diferencias": []}
        )

    return {
        "hay_libro": True,
        "resumen": {
            "cuadran": cuadran,
            "difieren": sum(1 for e in empleados if e["estado"] == "DIFIERE"),
            "solo_plataforma": sum(1 for e in empleados if e["estado"] == "SOLO_EN_PLATAFORMA"),
            "solo_libro": sum(1 for e in empleados if e["estado"] == "SOLO_EN_LIBRO"),
        },
        "empleados": empleados,
    }
