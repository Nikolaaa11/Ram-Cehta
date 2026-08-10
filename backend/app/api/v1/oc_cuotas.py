"""R152yyy · Forma de pago de una OC (hitos por PORCENTAJE) + vouchers DRAFT.

MEJORAS IA.docx #6: cada hito de pago de una OC debería generar un voucher.

MEGAPROMPT OC-PORCENTAJES — el modelo pasó de "cuotas con monto fijo" a
"hitos de pago por PORCENTAJE con fecha". Las OC reales se pactan así:
"30% anticipo al inicio de fabricación y 70% contra entrega", "50% de
anticipo y saldo contra entrega". Guardar el porcentaje (y no solo el monto)
permite recalcular si cambia el total de la OC y es lo que el proveedor firma.

Reglas del modelo nuevo:
  · `porcentaje` (NUMERIC(6,3)) es la FUENTE DE VERDAD de cada hito.
  · `monto` se DERIVA (porcentaje/100 x `total_a_pagar` de la OC) y se sigue
    guardando porque lo consumen generar-vouchers y el flujo de caja.
    OJO: la base es `total_a_pagar`, no `total`. En una boleta de
    honorarios `total` es el BRUTO y repartir sobre él le giraría al
    profesional la retención que la empresa le debe al SII. Ver
    `_base_de_reparto`.
  · Los porcentajes de una misma OC deben sumar 100 (tolerancia ±0.01 por
    redondeo del navegador).
  · El ÚLTIMO hito absorbe la diferencia de redondeo de los montos, para que
    Σ(montos) sea EXACTAMENTE `total_a_pagar` (si no, la OC no cuadra
    contra los vouchers que se generan de ella).

Flujo típico:
  1. Operador crea OC (total $3.000.000)
  2. PUT /ordenes-compra/{id}/cuotas  → hitos [{porcentaje, descripcion,
       fecha_vencimiento}]; o POST .../cuotas/split-equitativo (reparte el
       100% en N partes iguales)
  3. POST /ordenes-compra/{id}/cuotas/generar-vouchers
       (crea 1 voucher DRAFT por hito PENDIENTE, los linkea)
  4. Cada voucher sigue el flujo normal (DRAFT → APPROVED → EXECUTED)
  5. Cuando el voucher pasa a EXECUTED, el hito queda PAGADO.

Nota de nomenclatura: hacia el negocio esto se llama "Forma de pago" /
"hitos de pago"; la tabla y las rutas siguen diciendo `cuotas` para no
romper integraciones ni links existentes.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.core.security import AuthenticatedUser
from app.services.audit_service import audit_log
from app.services.empresa_scope_service import (
    EmpresaScopeDep,
    assert_empresa_access,
)

router = APIRouter()

# Tolerancia al validar Σ(porcentajes) == 100. Sin ella, un reparto legítimo
# como 33,334 + 33,333 + 33,333 se rechazaría por un decimal de redondeo.
TOLERANCIA_PCT = Decimal("0.01")
CIEN = Decimal("100")


# ─────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────


class CuotaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    cuota_id: int
    oc_id: int
    numero_cuota: int
    # `porcentaje` es la fuente de verdad del hito; `monto` es el derivado.
    # Default None: filas viejas (pre-migración) pueden no tenerlo cargado.
    porcentaje: Decimal | None = None
    monto: Decimal
    fecha_vencimiento: date
    descripcion: str | None
    estado: str
    voucher_id: int | None
    voucher_codigo: str | None = None
    voucher_status: str | None = None
    dias_a_vencer: int | None = None


class HitoPagoCreate(BaseModel):
    """Hito de pago tal como se pacta con el proveedor: % + fecha.

    El `monto` NO se recibe: se deriva del porcentaje x total de la OC.
    `numero_cuota` es opcional — si no viene, se numera por posición (el
    frontend lo manda para los hitos que ya existen, así no se pisan los
    que tienen voucher generado).
    """

    porcentaje: Decimal = Field(..., gt=0, le=100)
    fecha_vencimiento: date
    descripcion: str | None = Field(default=None, max_length=200)
    numero_cuota: int | None = Field(default=None, ge=1, le=999)


class SplitEquitativoBody(BaseModel):
    cantidad: int = Field(
        ..., ge=1, le=24, description="Cantidad de hitos de pago iguales"
    )
    primer_vencimiento: date
    dias_entre_cuotas: int = Field(default=30, ge=1, le=180)


class HitosPagoReplaceBody(BaseModel):
    """Body del PUT de forma de pago.

    Acepta la clave `hitos` (nombre nuevo, orientado al negocio) y también
    `cuotas` (nombre viejo) para no romper clientes ya desplegados.
    """

    hitos: list[HitoPagoCreate] = Field(
        ...,
        min_length=1,
        max_length=24,
        validation_alias=AliasChoices("hitos", "cuotas"),
    )


class GenerarVouchersResult(BaseModel):
    cuotas_procesadas: int
    vouchers_creados: int
    vouchers_codigos: list[str]


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────


async def _get_oc_or_404(db, oc_id: int, user=None) -> dict[str, Any]:
    # R152UUUUUU — se agrega `estado` al SELECT (el guard anti-OC-anulada
    # leía oc.get("estado") que siempre era None = código muerto) y
    # scoping multi-tenant: este router no validaba empresa, a diferencia
    # de ordenes_compra.py, permitiendo operar cuotas de cualquier empresa.
    row = (
        await db.execute(
            text(
                """SELECT oc_id, numero_oc, empresa_codigo, proveedor_id,
                          total, total_a_pagar, retencion_monto,
                          tipo_documento, moneda, observaciones, estado
                   FROM core.ordenes_compra WHERE oc_id = :id"""
            ),
            {"id": oc_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OC #{oc_id} no encontrada",
        )
    if user is not None:
        await assert_empresa_access(user, db, row["empresa_codigo"])
    return dict(row)


def _base_de_reparto(oc: dict[str, Any]) -> Decimal:
    """Sobre qué monto se reparten los hitos de pago.

    Es `total_a_pagar`, NO `total`. La distinción sólo importa en las boletas
    de honorarios, y ahí importa mucho: `total` es el honorario BRUTO y
    `total_a_pagar` es el líquido, después de descontar la retención que el
    mandante le entera al SII por cuenta del prestador.

    Repartir sobre el bruto significaría transferirle al profesional también
    la plata de la retención — en una OC de 3.645.000 al 15,25% son 555.863
    de más, y encima la empresa después tiene que enterar esa retención igual,
    o sea la paga dos veces. Los hitos son PLATA QUE SALE (regla §3.1 del
    contrato en docs/MEGAPROMPT_OC_HONORARIOS_EXENTA.md), así que van contra
    el líquido.

    Para los otros tres tipos de documento `total_a_pagar == total`, así que
    esto no cambia absolutamente nada de lo que ya existía.

    El fallback a `total` cubre la ventana entre el SQL y el deploy: si la
    columna todavía no tiene valor, el reparto sigue funcionando como antes
    en vez de tirar 500. No usa `or` porque un `total_a_pagar` de 0 es un
    valor legítimo que hay que respetar, y `or` lo confundiría con ausencia.
    """
    valor = oc.get("total_a_pagar")
    if valor is None:
        valor = oc.get("total")
    return Decimal(str(valor or 0))


def _fmt_pct(v: Decimal) -> str:
    """Formatea un porcentaje para mensajes al operador: 30 · 33,334."""
    s = f"{v.quantize(Decimal('0.001'), rounding=ROUND_HALF_UP)}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return (s or "0").replace(".", ",")


def _pct_normalizado(v: Decimal) -> Decimal:
    """Recorta el % a 3 decimales (la columna es NUMERIC(6,3)).

    Se normaliza ANTES de validar la suma para que la validación opere sobre
    exactamente los mismos valores que van a quedar guardados en la BD.
    """
    return Decimal(v).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def _paso_redondeo(moneda: str | None) -> Decimal:
    """Unidad mínima de la moneda: CLP no tiene decimales, el resto sí."""
    return Decimal("1") if (moneda or "CLP").upper() == "CLP" else Decimal("0.01")


def _validar_suma_100(suma: Decimal, extra_detalle: str = "") -> None:
    """400 si los porcentajes no suman 100 (±0.01 de tolerancia).

    La tolerancia existe porque el navegador puede mandar 33,333 tres veces
    (=99,999) y eso es un reparto perfectamente válido: la diferencia se
    absorbe después al derivar los montos.
    """
    if abs(suma - CIEN) <= TOLERANCIA_PCT:
        return
    diferencia = CIEN - suma
    if diferencia > 0:
        cierre = f"Faltan {_fmt_pct(diferencia)}% por repartir."
    else:
        cierre = f"Te pasaste en {_fmt_pct(-diferencia)}%."
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            f"Los porcentajes de los hitos de pago suman {_fmt_pct(suma)}% "
            f"y tienen que sumar 100%. {cierre}{extra_detalle}"
        ),
    )


def _derivar_montos(
    total_oc: Decimal,
    porcentajes: list[Decimal],
    paso: Decimal,
    ya_asignado: Decimal = Decimal("0"),
) -> list[Decimal]:
    """monto = porcentaje/100 x total de la OC, con el residuo en el último.

    REGLA CONTABLE: el ÚLTIMO hito absorbe la diferencia de redondeo para
    que Σ(montos) == total de la OC EXACTAMENTE. Si no se hiciera, una OC de
    $1.000.000 repartida en 3 hitos de 33,333% daría $999.990 en vouchers y
    la OC nunca cuadraría contra su ejecución (quedan $10 sin voucher,
    invisibles para el operador).

    `ya_asignado` es la suma de los hitos que NO se pueden tocar (los que ya
    tienen voucher generado): el residuo se calcula contra el resto.
    """
    montos = [
        (total_oc * p / CIEN).quantize(paso, rounding=ROUND_HALF_UP)
        for p in porcentajes
    ]
    residuo = total_oc - ya_asignado - sum(montos, start=Decimal("0"))
    montos[-1] = montos[-1] + residuo
    return montos


async def _guardar_hitos(
    db,
    oc_id: int,
    filas: list[dict[str, Any]],
) -> None:
    """UPSERT en bloque de los hitos de pago (1 round-trip, sin N+1).

    Los montos y porcentajes viajan como TEXT[] y se castean a NUMERIC en
    Postgres: así no perdemos precisión decimal en el camino (nunca float).
    """
    if not filas:
        return
    await db.execute(
        text(
            """INSERT INTO core.oc_cuotas
                   (oc_id, numero_cuota, monto, porcentaje,
                    fecha_vencimiento, descripcion)
               SELECT CAST(:oc_id AS BIGINT), u.numero,
                      u.monto::numeric, u.pct::numeric,
                      u.venc, u.descripcion
               FROM UNNEST(
                   CAST(:numeros AS INTEGER[]),
                   CAST(:montos AS TEXT[]),
                   CAST(:pcts AS TEXT[]),
                   CAST(:vencs AS DATE[]),
                   CAST(:descs AS TEXT[])
               ) AS u(numero, monto, pct, venc, descripcion)
               ON CONFLICT (oc_id, numero_cuota) DO UPDATE SET
                   monto = EXCLUDED.monto,
                   porcentaje = EXCLUDED.porcentaje,
                   fecha_vencimiento = EXCLUDED.fecha_vencimiento,
                   descripcion = EXCLUDED.descripcion,
                   updated_at = NOW()"""
        ),
        {
            "oc_id": oc_id,
            "numeros": [int(f["numero_cuota"]) for f in filas],
            "montos": [str(f["monto"]) for f in filas],
            "pcts": [str(f["porcentaje"]) for f in filas],
            "vencs": [f["fecha_vencimiento"] for f in filas],
            "descs": [f["descripcion"] for f in filas],
        },
    )


# ─────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────


@router.get("/ordenes-compra/{oc_id}/cuotas", response_model=list[CuotaRead])
async def list_cuotas(
    user: CurrentUser, db: DBSession, oc_id: int
) -> list[CuotaRead]:
    """Lista los hitos de pago de una OC con estado del voucher asociado."""
    await _get_oc_or_404(db, oc_id, user)
    # El JOIN con core.oc_cuotas es a propósito: la vista v_oc_cuotas_estado
    # se creó antes de que existiera la columna `porcentaje` y no la expone.
    # Leemos el % de la tabla base y el resto de la vista, así no hay que
    # recrear la vista (migración ya aplicada en producción).
    rows = await db.execute(
        text(
            """SELECT vw.cuota_id, vw.oc_id, vw.numero_cuota,
                      c.porcentaje,
                      vw.monto, vw.fecha_vencimiento,
                      vw.descripcion, vw.estado_cuota AS estado,
                      vw.voucher_id, vw.voucher_codigo, vw.voucher_status,
                      vw.dias_a_vencer
               FROM core.v_oc_cuotas_estado vw
               JOIN core.oc_cuotas c ON c.cuota_id = vw.cuota_id
               WHERE vw.oc_id = :id
               ORDER BY vw.numero_cuota"""
        ),
        {"id": oc_id},
    )
    return [CuotaRead.model_validate(dict(r._mapping)) for r in rows]


@router.post(
    "/ordenes-compra/{oc_id}/cuotas/split-equitativo",
    response_model=list[CuotaRead],
)
async def split_equitativo(
    user: CurrentUser,
    db: DBSession,
    oc_id: int,
    body: SplitEquitativoBody,
) -> list[CuotaRead]:
    """Reparte el 100% en N hitos iguales, cada `dias_entre_cuotas`.

    Ej: 3 hitos → 33,334% / 33,333% / 33,333% (el PRIMERO absorbe el residuo
    del porcentaje, porque en la práctica el anticipo es el hito que se
    negocia "y el resto se divide"). El ÚLTIMO absorbe el residuo del MONTO
    para que la suma dé exactamente el total de la OC.

    Reemplaza CUALQUIER hito previo que estuviera en estado PENDIENTE.
    """
    oc = await _get_oc_or_404(db, oc_id, user)
    total = _base_de_reparto(oc)
    if total <= 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "La OC no tiene total > 0 — no se puede repartir la forma "
                "de pago en porcentajes."
            ),
        )

    # R152DDDDDD — Advisory lock por oc_id antes de DELETE+INSERT.
    # Sin esto, 2 admins editando cuotas concurrentemente perdían cambios.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
        {"k": f"oc_cuotas_edit_{oc_id}"},
    )

    # El reparto parejo asume que el 100% está disponible. Si ya hay hitos
    # con voucher generado, repartir 100% de nuevo dejaría la OC con más
    # pagos que su total (los hitos con voucher no se borran). En ese caso
    # el operador tiene que editar la forma de pago a mano.
    con_voucher = await db.scalar(
        text(
            """SELECT COUNT(*) FROM core.oc_cuotas
               WHERE oc_id = :id AND voucher_id IS NOT NULL"""
        ),
        {"id": oc_id},
    )
    if int(con_voucher or 0) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Esta OC ya tiene {int(con_voucher)} hito(s) de pago con "
                "voucher generado. El reparto automático los dejaría fuera "
                "de cuadratura: editá los porcentajes a mano."
            ),
        )

    # Reparto del 100% en N partes iguales (3 decimales, que es lo que
    # aguanta la columna). ROUND_DOWN en la base + el residuo al primer hito
    # garantiza Σ% == 100 exacto: 3 → 33,334 + 33,333 + 33,333.
    n = body.cantidad
    base_pct = (CIEN / n).quantize(Decimal("0.001"), rounding=ROUND_DOWN)
    porcentajes = [base_pct] * n
    porcentajes[0] = CIEN - base_pct * (n - 1)

    paso = _paso_redondeo(oc.get("moneda"))
    montos = _derivar_montos(total, porcentajes, paso)

    # R152JJJJJJ — guard: con totales chicos y muchos hitos, alguno puede
    # quedar en 0 o negativo (ej: total=10, cantidad=12). La suma siempre da
    # exacto, pero la BD exige monto > 0.
    if any(m <= 0 for m in montos):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Demasiados hitos ({n}) para el total de la OC ({total}): "
                "alguno quedaría en $0 o negativo. Reducí la cantidad."
            ),
        )

    # El DELETE va DESPUÉS de validar: si el reparto no es viable salimos con
    # 400 sin haber borrado la forma de pago que el operador ya tenía.
    await db.execute(
        text(
            """DELETE FROM core.oc_cuotas
               WHERE oc_id = :id AND estado = 'PENDIENTE'"""
        ),
        {"id": oc_id},
    )

    filas = [
        {
            "numero_cuota": i,
            "porcentaje": _pct_normalizado(porcentajes[i - 1]),
            "monto": montos[i - 1],
            "fecha_vencimiento": body.primer_vencimiento
            + timedelta(days=(i - 1) * body.dias_entre_cuotas),
            "descripcion": f"Hito {i} de {n}",
        }
        for i in range(1, n + 1)
    ]
    await _guardar_hitos(db, oc_id, filas)
    await db.commit()

    await audit_log(
        db,
        None,
        user,
        action="oc.forma_pago_split",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc.get("numero_oc"),
        summary=(
            f"OC {oc.get('numero_oc')}: forma de pago repartida en {n} hitos "
            f"iguales ({_fmt_pct(porcentajes[0])}% el primero)"
        ),
    )
    return await list_cuotas(user, db, oc_id)


@router.put(
    "/ordenes-compra/{oc_id}/cuotas",
    response_model=list[CuotaRead],
)
async def replace_cuotas(
    user: CurrentUser,
    db: DBSession,
    oc_id: int,
    body: HitosPagoReplaceBody,
) -> list[CuotaRead]:
    """Define la FORMA DE PAGO de la OC: hitos por porcentaje + fecha.

    El operador manda `{porcentaje, descripcion, fecha_vencimiento}` por hito
    y el backend deriva el `monto` (= porcentaje/100 x total de la OC). Los
    hitos que ya tienen voucher generado quedan intactos.

    Reglas:
      · Σ(porcentajes) debe dar 100 (±0.01) → si no, 400 con el faltante.
      · El último hito editable absorbe el residuo de redondeo del monto.
    """
    oc = await _get_oc_or_404(db, oc_id, user)
    total_oc = _base_de_reparto(oc)
    if total_oc <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "La OC no tiene total > 0 — cargá los ítems antes de definir "
                "la forma de pago (los montos se calculan sobre el total)."
            ),
        )

    # Advisory lock ANTES de leer los hitos bloqueados: sin esto, dos
    # operadores editando la misma OC podían pisarse (mismo patrón que
    # split-equitativo, R152DDDDDD).
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
        {"k": f"oc_cuotas_edit_{oc_id}"},
    )

    # Hitos que ya tienen voucher — NO se tocan (romperían vouchers en curso)
    locked_rows = (
        await db.execute(
            text(
                """SELECT numero_cuota, monto, porcentaje
                   FROM core.oc_cuotas
                   WHERE oc_id = :id AND voucher_id IS NOT NULL"""
            ),
            {"id": oc_id},
        )
    ).mappings().all()
    locked = {int(r["numero_cuota"]) for r in locked_rows}
    suma_locked_monto = sum(
        (Decimal(str(r["monto"])) for r in locked_rows), start=Decimal("0")
    )
    # % de los hitos bloqueados: el guardado, o el derivado del monto para
    # filas viejas cargadas antes de que existiera la columna `porcentaje`.
    suma_locked_pct = sum(
        (
            _pct_normalizado(Decimal(str(r["porcentaje"])))
            if r["porcentaje"] is not None
            else _pct_normalizado(Decimal(str(r["monto"])) * CIEN / total_oc)
            for r in locked_rows
        ),
        start=Decimal("0"),
    )

    # ── Numeración de los hitos ──────────────────────────────────────
    # El frontend manda `numero_cuota` para los hitos que ya existen (así no
    # se pisa uno con voucher); los nuevos vienen sin número y se numeran
    # con el primer hueco libre.
    usados = [h.numero_cuota for h in body.hitos if h.numero_cuota is not None]
    if len(usados) != len(set(usados)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hay hitos de pago repetidos con el mismo número.",
        )
    ocupados = set(usados)
    siguiente = 1
    numerados: list[tuple[int, HitoPagoCreate]] = []
    for h in body.hitos:
        if h.numero_cuota is not None:
            numerados.append((h.numero_cuota, h))
            continue
        while siguiente in ocupados:
            siguiente += 1
        ocupados.add(siguiente)
        numerados.append((siguiente, h))

    # ── Validación de porcentajes ────────────────────────────────────
    # Para los hitos bloqueados manda SIEMPRE lo que hay en la BD (aunque el
    # payload traiga otro %): no se pueden modificar, así que la suma real
    # de la OC se calcula con su valor persistido.
    editables = [(n, h) for n, h in numerados if n not in locked]
    pcts_editables = [_pct_normalizado(h.porcentaje) for _, h in editables]
    suma_total_pct = suma_locked_pct + sum(pcts_editables, start=Decimal("0"))
    detalle_locked = (
        f" Ojo: {len(locked)} hito(s) ya tienen voucher generado y aportan "
        f"{_fmt_pct(suma_locked_pct)}% que no se puede modificar."
        if locked
        else ""
    )
    _validar_suma_100(suma_total_pct, detalle_locked)

    # ── Derivación de montos ─────────────────────────────────────────
    paso = _paso_redondeo(oc.get("moneda"))
    filas: list[dict[str, Any]] = []
    if editables:
        montos = _derivar_montos(
            total_oc, pcts_editables, paso, ya_asignado=suma_locked_monto
        )
        if any(m <= 0 for m in montos):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Con esos porcentajes algún hito queda en $0 o negativo "
                    f"sobre un total de {total_oc}. Revisá el reparto."
                ),
            )
        filas = [
            {
                "numero_cuota": numero,
                "porcentaje": pcts_editables[i],
                "monto": montos[i],
                "fecha_vencimiento": hito.fecha_vencimiento,
                "descripcion": hito.descripcion,
            }
            for i, (numero, hito) in enumerate(editables)
        ]

    # Borrar pendientes (replace-all de lo editable)
    await db.execute(
        text(
            """DELETE FROM core.oc_cuotas
               WHERE oc_id = :id AND estado = 'PENDIENTE'"""
        ),
        {"id": oc_id},
    )
    await _guardar_hitos(db, oc_id, filas)
    await db.commit()

    await audit_log(
        db,
        None,
        user,
        action="oc.forma_pago_actualizada",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc.get("numero_oc"),
        summary=(
            f"OC {oc.get('numero_oc')}: forma de pago con {len(numerados)} "
            f"hito(s) — "
            + (
                " + ".join(f"{_fmt_pct(p)}%" for p in pcts_editables)
                if pcts_editables
                else "sin hitos editables (todos con voucher generado)"
            )
        ),
    )
    return await list_cuotas(user, db, oc_id)


@router.delete(
    "/ordenes-compra/{oc_id}/cuotas/{cuota_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_cuota(
    user: CurrentUser, db: DBSession, oc_id: int, cuota_id: int
) -> Response:
    """Borra un hito de pago suelto (sin voucher generado).

    Ojo: al borrar un hito los porcentajes dejan de sumar 100. El camino
    normal es editar la forma de pago completa con el PUT; esto queda para
    limpiezas puntuales.
    """
    # Multi-tenant: faltaba el scoping por empresa en este endpoint (el resto
    # del router ya lo hace vía _get_oc_or_404).
    await _get_oc_or_404(db, oc_id, user)
    row = (
        await db.execute(
            text(
                """SELECT voucher_id, estado FROM core.oc_cuotas
                   WHERE cuota_id = :cid AND oc_id = :oid"""
            ),
            {"cid": cuota_id, "oid": oc_id},
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Cuota no encontrada")
    if row[0] is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                "No se puede eliminar una cuota con voucher ya generado. "
                "Marcala como ANULADA o anulá el voucher primero."
            ),
        )
    # R152DDDDDD — Guard atómico: DELETE condicional. Sin esto, si entre
    # el SELECT de arriba y el DELETE otro request genera el voucher,
    # estaríamos borrando una cuota con voucher generado → orphan voucher.
    result = await db.execute(
        text(
            "DELETE FROM core.oc_cuotas "
            "WHERE cuota_id = :cid AND voucher_id IS NULL"
        ),
        {"cid": cuota_id},
    )
    if result.rowcount == 0:
        # Otro request acaba de generar el voucher. Abort.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "La cuota cambió mientras se eliminaba (probablemente "
                "se generó su voucher). Refrescá y reintentá."
            ),
        )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/ordenes-compra/{oc_id}/cuotas/generar-vouchers",
    response_model=GenerarVouchersResult,
)
async def generar_vouchers(
    user: CurrentUser, db: DBSession, oc_id: int
) -> GenerarVouchersResult:
    """Genera UN voucher DRAFT por cada cuota en estado PENDIENTE.

    Cada voucher queda linkeado a la cuota vía oc_cuotas.voucher_id.
    Después de esta llamada, el operador edita cada voucher (cuentas,
    áreas, proyecto) y los manda a aprobación de forma independiente.

    Convención del voucher generado:
      - tipo: EGRESO
      - empresa_codigo: heredada de la OC
      - contraparte_rut/nombre: proveedor de la OC
      - glosa: "OC #{numero_oc} · Cuota {n}/{total} · {descripcion}"
      - fecha_contable: fecha_vencimiento de la cuota
      - status: DRAFT
      - lines: vacío — el operador imputa al editar el voucher
    """
    oc = await _get_oc_or_404(db, oc_id, user)
    emp_code = str(oc["empresa_codigo"])

    # R152AAAAA · P0 — validación de estado.
    # OCs cerradas (anuladas/pagadas/rechazadas) no deben generar vouchers
    # nuevos. Antes el endpoint pasaba por arriba y creaba vouchers DRAFT
    # sobre OCs ya cerradas, contablemente inconsistente.
    estado_oc = (oc.get("estado") or "").lower()
    if estado_oc in ("anulada", "rechazada", "pagada", "cerrada"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"La OC #{oc.get('numero_oc')} está en estado '{estado_oc}'. "
                "No se pueden generar vouchers sobre OCs cerradas."
            ),
        )

    # R152DDDDDD · Race condition fix: advisory lock por oc_id antes del check
    # de idempotency. Sin esto, 2 requests del operador (doble-click) pasaban
    # los dos por el SELECT, encontraban 0 vouchers, y generaban N vouchers
    # cada uno → duplicación silenciosa. El lock serializa la generación
    # por OC; es transaction-scoped, así que se libera en commit/rollback.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
        {"k": f"oc_voucher_gen_{oc_id}"},
    )

    # R152AAAAA · P0 → R152UUUUUU — idempotencia SIN bloquear regeneración
    # parcial. El early-return anterior ("si existe CUALQUIER voucher,
    # retornar sin generar") dejaba huérfanas a las cuotas que volvían a
    # PENDIENTE (voucher anulado → trigger R152BBBB las resetea) y a las
    # cuotas agregadas después: nunca podían regenerar su voucher.
    # El doble-click ya está cubierto por el advisory lock de arriba +
    # el cambio de estado a VOUCHER_GENERADO (la 2ª llamada no encuentra
    # cuotas PENDIENTE y devuelve 0 creados). Los códigos existentes se
    # incluyen en la respuesta solo como información.
    existing_rows = (
        await db.execute(
            text(
                """SELECT v.codigo
                   FROM core.oc_cuotas c
                   JOIN core.vouchers v ON v.voucher_id = c.voucher_id
                   WHERE c.oc_id = :id
                   ORDER BY c.numero_cuota"""
            ),
            {"id": oc_id},
        )
    ).fetchall()
    codigos_existentes = [r[0] for r in existing_rows]

    # R152DDDDD · Reemplazo del advisory_lock + COUNT(*) por la tabla
    # centralizada core.correlativos. UPSERT atomico con RETURNING garantiza
    # serialización a nivel row sin necesidad de lock externo.
    #
    # Beneficios sobre advisory_lock:
    #   - Una sola query en lugar de 2 (lock + count).
    #   - Estado persistente — el correlativo no se reinicia si la tabla
    #     vouchers se purga.
    #   - Visibilidad: SELECT * FROM core.correlativos para auditar.
    #   - Sin riesgo de fugas de locks por crash mid-transaction.
    year = datetime.now().year

    # Recargar cuotas pendientes — no necesitamos lock porque el correlativo
    # ya está aislado en la tabla correlativos.
    cuotas_rows = (
        await db.execute(
            text(
                """SELECT cuota_id, numero_cuota, monto, fecha_vencimiento,
                          descripcion
                   FROM core.oc_cuotas
                   WHERE oc_id = :id AND estado = 'PENDIENTE'
                   ORDER BY numero_cuota"""
            ),
            {"id": oc_id},
        )
    ).mappings().all()
    pendientes = [dict(r) for r in cuotas_rows]
    if not pendientes:
        # Nada que generar: se devuelven los códigos ya existentes para que
        # el frontend pueda mostrarlos (comportamiento idéntico al early-
        # return anterior cuando la OC ya estaba completamente generada).
        return GenerarVouchersResult(
            cuotas_procesadas=0,
            vouchers_creados=0,
            vouchers_codigos=codigos_existentes,
        )

    # Datos del proveedor
    proveedor_rut: str | None = None
    proveedor_nombre: str | None = None
    if oc.get("proveedor_id"):
        prov = (
            await db.execute(
                text(
                    """SELECT rut, razon_social FROM core.proveedores
                       WHERE proveedor_id = :pid"""
                ),
                {"pid": oc["proveedor_id"]},
            )
        ).first()
        if prov:
            proveedor_rut = prov[0]
            proveedor_nombre = prov[1]

    # R152AAAAA · P2 — Total real de cuotas para la glosa.
    # Antes se usaba len(pendientes), que daba "1/3" cuando realmente hay
    # 11 cuotas pero 8 ya estaban generadas. La glosa confundía al operador.
    total_cuotas_reales = await db.scalar(
        text("SELECT COUNT(*) FROM core.oc_cuotas WHERE oc_id = :id"),
        {"id": oc_id},
    )
    total_cuotas = int(total_cuotas_reales or len(pendientes))

    # R152YYYY · Defensive: si user.sub viene vacío o no existe, pasar None.
    sub_raw = getattr(user, "sub", None)
    user_uid: str | None = str(sub_raw) if sub_raw else None
    if user_uid is not None and not (32 <= len(user_uid) <= 36):
        user_uid = None

    # R152DDDDD · Reserva atomica de N correlativos en una sola query.
    # El UPSERT incrementa last_seq por la cantidad de cuotas pendientes y
    # nos devuelve el VALOR FINAL. Restando N-1 obtenemos el primer
    # correlativo a usar. Esto es atomico — dos requests simultáneos no
    # pueden reservar el mismo rango.
    n_cuotas = len(pendientes)
    seq_row = (
        await db.execute(
            text(
                """INSERT INTO core.correlativos
                       (empresa_codigo, year, tipo, last_seq)
                   VALUES (:e, :y, 'COM', :n)
                   ON CONFLICT (empresa_codigo, year, tipo)
                       DO UPDATE SET last_seq = correlativos.last_seq + :n,
                                     updated_at = NOW()
                   RETURNING last_seq"""
            ),
            {"e": emp_code, "y": year, "n": n_cuotas},
        )
    ).first()
    final_seq = int(seq_row[0])
    # next_seq es el PRIMER correlativo del rango reservado.
    next_seq = final_seq - n_cuotas + 1

    # R152FFFFF — Bulk INSERT con UNNEST para eliminar el N+1.
    # Antes: 11 INSERT + 11 UPDATE = 22 round-trips.
    # Ahora: 1 INSERT con CTE de N vouchers + 1 UPDATE bulk = 2 round-trips.
    # Speed-up típico: 10x para batches de 11 cuotas.
    rows_to_insert: list[dict] = []
    cuota_to_codigo: dict[int, str] = {}
    for c in pendientes:
        glosa = (
            f"OC #{oc['numero_oc']} · Cuota {c['numero_cuota']}/{total_cuotas} · "
            f"{c['descripcion'] or 'sin descripción'}"
        )
        codigo = f"{emp_code}-{year}-COM-{str(next_seq).zfill(5)}"
        next_seq += 1
        cuota_to_codigo[c["cuota_id"]] = codigo
        rows_to_insert.append({
            "codigo": codigo,
            "fecha": c["fecha_vencimiento"],
            "glosa": glosa[:500],
            "cuota_id": c["cuota_id"],
        })

    # 1 sola query INSERT con UNNEST de arrays.
    inserted_rows = (
        await db.execute(
            text(
                """INSERT INTO core.vouchers (
                       codigo, empresa_codigo, tipo,
                       fecha_documento, fecha_contable,
                       glosa, contraparte_rut, contraparte_nombre,
                       contraparte_tipo, moneda, status,
                       forma_pago, created_by, oc_id
                   )
                   SELECT
                       u.codigo,
                       :emp,
                       'EGRESO',
                       u.fecha::date,
                       u.fecha::date,
                       u.glosa,
                       :rut,
                       :nombre,
                       'PROVEEDOR',
                       :moneda,
                       'DRAFT',
                       :forma,
                       CAST(:uid AS UUID),
                       CAST(:oc_link AS BIGINT)
                   FROM UNNEST(
                       CAST(:codigos AS TEXT[]),
                       CAST(:fechas AS DATE[]),
                       CAST(:glosas AS TEXT[]),
                       CAST(:cuotas AS BIGINT[])
                   ) AS u(codigo, fecha, glosa, cuota_id)
                   RETURNING voucher_id, codigo"""
            ),
            {
                "emp": emp_code,
                "rut": proveedor_rut,
                "nombre": proveedor_nombre,
                "moneda": oc.get("moneda") or "CLP",
                "forma": "TRANSFERENCIA",
                "uid": user_uid,
                # MEGAPROMPT F3 — FK directa voucher↔OC (migración 0068).
                "oc_link": oc_id,
                "codigos": [r["codigo"] for r in rows_to_insert],
                "fechas": [r["fecha"] for r in rows_to_insert],
                "glosas": [r["glosa"] for r in rows_to_insert],
                "cuotas": [r["cuota_id"] for r in rows_to_insert],
            },
        )
    ).fetchall()
    creados = [str(r[1]) for r in inserted_rows]
    # Mapeo codigo → voucher_id para el UPDATE bulk de cuotas.
    codigo_to_voucher_id = {str(r[1]): int(r[0]) for r in inserted_rows}

    # 1 sola query UPDATE bulk usando UNNEST.
    await db.execute(
        text(
            """UPDATE core.oc_cuotas c
               SET voucher_id = u.voucher_id,
                   estado = 'VOUCHER_GENERADO',
                   updated_at = NOW()
               FROM UNNEST(
                   CAST(:cuota_ids AS BIGINT[]),
                   CAST(:voucher_ids AS BIGINT[])
               ) AS u(cuota_id, voucher_id)
               WHERE c.cuota_id = u.cuota_id"""
        ),
        {
            "cuota_ids": list(cuota_to_codigo.keys()),
            "voucher_ids": [
                codigo_to_voucher_id[cuota_to_codigo[cid]]
                for cid in cuota_to_codigo.keys()
            ],
        },
    )
    await db.commit()
    return GenerarVouchersResult(
        cuotas_procesadas=len(pendientes),
        vouchers_creados=len(creados),
        vouchers_codigos=codigos_existentes + creados,
    )


# ─────────────────────────────────────────────────────────────────────
# R152DDDD — Cuotas próximas a vencer (para action-center + alerts)
# ─────────────────────────────────────────────────────────────────────


class CuotaPendiente(BaseModel):
    cuota_id: int
    oc_id: int
    numero_oc: str | None
    empresa_codigo: str
    proveedor_nombre: str | None
    numero_cuota: int
    monto: Decimal
    fecha_vencimiento: date
    dias_a_vencer: int
    descripcion: str | None
    estado: str
    voucher_id: int | None
    voucher_codigo: str | None


class CuotasResumen(BaseModel):
    """Métricas agregadas para badge/sidebar."""
    total_pendientes: int
    vencidas: int
    proximas_7_dias: int
    proximas_30_dias: int
    monto_total_pendiente: Decimal


@router.get(
    "/ordenes-compra/cuotas/proximas-a-vencer",
    response_model=list[CuotaPendiente],
)
async def cuotas_proximas(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    dias: Annotated[int, Query(ge=1, le=180)] = 30,
    incluir_vencidas: bool = Query(default=True),
) -> list[CuotaPendiente]:
    """Lista cuotas con vencimiento ≤ N días, estado != PAGADA/ANULADA.

    Default: próximas 30 días + vencidas. Ordenadas por fecha asc.
    Pensado para widget "Próximos vencimientos" y badge sidebar.

    FIX fuga multi-tenant: este endpoint recibía `user` pero no lo usaba y
    devolvía los hitos de LAS 10 EMPRESAS a cualquier usuario autenticado.
    El widget de /action-center mostraba número de OC, proveedor y monto de
    empresas fuera del alcance de quien miraba. Ahora filtra por el scope.
    """
    where_clauses = [
        "c.estado IN ('PENDIENTE', 'VOUCHER_GENERADO')",
        f"c.fecha_vencimiento <= CURRENT_DATE + INTERVAL '{int(dias)} days'",
    ]
    if not incluir_vencidas:
        where_clauses.append("c.fecha_vencimiento >= CURRENT_DATE")

    params: dict[str, Any] = {}
    # None = admin global (ve todo). Lista = restringir a esas empresas.
    scoped = scope.filter_codes(None)
    if scoped is not None:
        where_clauses.append("oc.empresa_codigo = ANY(:empresas)")
        params["empresas"] = list(scoped)

    rows = await db.execute(
        text(
            f"""SELECT c.cuota_id, c.oc_id,
                       oc.numero_oc, oc.empresa_codigo,
                       p.razon_social AS proveedor_nombre,
                       c.numero_cuota, c.monto, c.fecha_vencimiento,
                       (c.fecha_vencimiento - CURRENT_DATE) AS dias_a_vencer,
                       c.descripcion, c.estado,
                       c.voucher_id, v.codigo AS voucher_codigo
                FROM core.oc_cuotas c
                JOIN core.ordenes_compra oc ON oc.oc_id = c.oc_id
                LEFT JOIN core.proveedores p ON p.proveedor_id = oc.proveedor_id
                LEFT JOIN core.vouchers v ON v.voucher_id = c.voucher_id
                WHERE {' AND '.join(where_clauses)}
                ORDER BY c.fecha_vencimiento ASC, c.cuota_id ASC
                LIMIT 100"""
        ),
        params,
    )
    return [CuotaPendiente.model_validate(dict(r._mapping)) for r in rows]


@router.get(
    "/ordenes-compra/cuotas/resumen",
    response_model=CuotasResumen,
)
async def cuotas_resumen(
    user: CurrentUser, db: DBSession, scope: EmpresaScopeDep
) -> CuotasResumen:
    """Resumen de cuotas pendientes (badge/sidebar).

    FIX fuga multi-tenant: agregaba sobre TODA la tabla, así que el badge del
    sidebar le sumaba a cada usuario la plata pendiente de las 10 empresas.
    `oc_cuotas` no tiene empresa_codigo, por eso el JOIN con ordenes_compra.
    """
    params: dict[str, Any] = {}
    filtro_empresa = ""
    scoped = scope.filter_codes(None)
    if scoped is not None:
        filtro_empresa = "WHERE oc.empresa_codigo = ANY(:empresas)"
        params["empresas"] = list(scoped)

    row = (
        await db.execute(
            text(
                f"""SELECT
                    COUNT(*) FILTER (WHERE estado IN ('PENDIENTE','VOUCHER_GENERADO')) AS total_pendientes,
                    COUNT(*) FILTER (WHERE estado IN ('PENDIENTE','VOUCHER_GENERADO')
                                     AND fecha_vencimiento < CURRENT_DATE) AS vencidas,
                    COUNT(*) FILTER (WHERE estado IN ('PENDIENTE','VOUCHER_GENERADO')
                                     AND fecha_vencimiento BETWEEN CURRENT_DATE
                                         AND CURRENT_DATE + INTERVAL '7 days') AS proximas_7,
                    COUNT(*) FILTER (WHERE estado IN ('PENDIENTE','VOUCHER_GENERADO')
                                     AND fecha_vencimiento BETWEEN CURRENT_DATE
                                         AND CURRENT_DATE + INTERVAL '30 days') AS proximas_30,
                    COALESCE(SUM(monto) FILTER (WHERE estado IN ('PENDIENTE','VOUCHER_GENERADO')), 0) AS monto_total
                   FROM core.oc_cuotas c
                   JOIN core.ordenes_compra oc ON oc.oc_id = c.oc_id
                   {filtro_empresa}"""
            ),
            params,
        )
    ).first()
    if not row:
        return CuotasResumen(
            total_pendientes=0, vencidas=0,
            proximas_7_dias=0, proximas_30_dias=0,
            monto_total_pendiente=Decimal("0"),
        )
    m = dict(row._mapping)
    return CuotasResumen(
        total_pendientes=int(m["total_pendientes"] or 0),
        vencidas=int(m["vencidas"] or 0),
        proximas_7_dias=int(m["proximas_7"] or 0),
        proximas_30_dias=int(m["proximas_30"] or 0),
        monto_total_pendiente=Decimal(str(m["monto_total"] or 0)),
    )
