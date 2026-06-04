"""R152yyy · Endpoints para split de OC en cuotas + generar vouchers DRAFT.

MEJORAS IA.docx #6: cada cuota de una OC debería generar un voucher.

Flujo típico:
  1. Operador crea OC (total $3.000.000, forma_pago "30/60/90 días")
  2. POST /ordenes-compra/{id}/cuotas/split (genera 3 cuotas equitativas)
       o POST /ordenes-compra/{id}/cuotas (define cuotas custom)
  3. POST /ordenes-compra/{id}/cuotas/generar-vouchers
       (crea 1 voucher DRAFT por cuota PENDIENTE, los linkea)
  4. Cada voucher sigue el flujo normal (DRAFT → APPROVED → EXECUTED)
  5. Cuando el voucher pasa a EXECUTED, la cuota queda PAGADA.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.core.security import AuthenticatedUser

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────


class CuotaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    cuota_id: int
    oc_id: int
    numero_cuota: int
    monto: Decimal
    fecha_vencimiento: date
    descripcion: str | None
    estado: str
    voucher_id: int | None
    voucher_codigo: str | None = None
    voucher_status: str | None = None
    dias_a_vencer: int | None = None


class CuotaCreate(BaseModel):
    numero_cuota: int = Field(..., ge=1)
    monto: Decimal = Field(..., gt=0)
    fecha_vencimiento: date
    descripcion: str | None = Field(default=None, max_length=200)


class SplitEquitativoBody(BaseModel):
    cantidad: int = Field(..., ge=1, le=24, description="Cantidad de cuotas")
    primer_vencimiento: date
    dias_entre_cuotas: int = Field(default=30, ge=1, le=180)


class CuotasReplaceBody(BaseModel):
    cuotas: list[CuotaCreate] = Field(..., min_length=1, max_length=24)


class GenerarVouchersResult(BaseModel):
    cuotas_procesadas: int
    vouchers_creados: int
    vouchers_codigos: list[str]


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────


async def _get_oc_or_404(db, oc_id: int) -> dict[str, Any]:
    row = (
        await db.execute(
            text(
                """SELECT oc_id, numero_oc, empresa_codigo, proveedor_id,
                          total, moneda, observaciones
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
    return dict(row)


# ─────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────


@router.get("/ordenes-compra/{oc_id}/cuotas", response_model=list[CuotaRead])
async def list_cuotas(
    user: CurrentUser, db: DBSession, oc_id: int
) -> list[CuotaRead]:
    """Lista cuotas de una OC con estado del voucher asociado."""
    await _get_oc_or_404(db, oc_id)
    rows = await db.execute(
        text(
            """SELECT cuota_id, oc_id, numero_cuota, monto, fecha_vencimiento,
                      descripcion, estado_cuota AS estado,
                      voucher_id, voucher_codigo, voucher_status,
                      dias_a_vencer
               FROM core.v_oc_cuotas_estado
               WHERE oc_id = :id
               ORDER BY numero_cuota"""
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
    """Genera N cuotas iguales con vencimientos cada `dias_entre_cuotas`.

    Reemplaza CUALQUIER cuota previa que estuviera en estado PENDIENTE.
    Cuotas ya generadas como voucher (VOUCHER_GENERADO/PAGADA) NO se tocan
    para evitar romper vouchers en curso.
    """
    oc = await _get_oc_or_404(db, oc_id)
    total = Decimal(str(oc["total"] or 0))
    if total <= 0:
        raise HTTPException(
            status_code=400,
            detail="La OC no tiene total > 0 — no se puede dividir en cuotas",
        )

    # Borrar pendientes
    await db.execute(
        text(
            """DELETE FROM core.oc_cuotas
               WHERE oc_id = :id AND estado = 'PENDIENTE'"""
        ),
        {"id": oc_id},
    )

    # Calcular monto por cuota — última absorbe residuo del redondeo
    base = (total / body.cantidad).quantize(Decimal("1"))
    montos = [base] * (body.cantidad - 1)
    montos.append(total - sum(montos))

    for i, monto in enumerate(montos, start=1):
        venc = body.primer_vencimiento + timedelta(
            days=(i - 1) * body.dias_entre_cuotas
        )
        await db.execute(
            text(
                """INSERT INTO core.oc_cuotas
                       (oc_id, numero_cuota, monto, fecha_vencimiento, descripcion)
                   VALUES (:oc_id, :n, :monto, :venc, :desc)
                   ON CONFLICT (oc_id, numero_cuota) DO UPDATE SET
                       monto = EXCLUDED.monto,
                       fecha_vencimiento = EXCLUDED.fecha_vencimiento,
                       descripcion = EXCLUDED.descripcion,
                       updated_at = NOW()"""
            ),
            {
                "oc_id": oc_id,
                "n": i,
                "monto": monto,
                "venc": venc,
                "desc": f"Cuota {i} de {body.cantidad}",
            },
        )
    await db.commit()
    return await list_cuotas(user, db, oc_id)


@router.put(
    "/ordenes-compra/{oc_id}/cuotas",
    response_model=list[CuotaRead],
)
async def replace_cuotas(
    user: CurrentUser,
    db: DBSession,
    oc_id: int,
    body: CuotasReplaceBody,
) -> list[CuotaRead]:
    """Reemplaza cuotas custom. Las que ya tengan voucher quedan intactas."""
    await _get_oc_or_404(db, oc_id)

    # Numeros de cuotas que ya tienen voucher — NO tocar
    existing = await db.execute(
        text(
            """SELECT numero_cuota FROM core.oc_cuotas
               WHERE oc_id = :id AND voucher_id IS NOT NULL"""
        ),
        {"id": oc_id},
    )
    locked = {int(r[0]) for r in existing}

    # Borrar pendientes
    await db.execute(
        text(
            """DELETE FROM core.oc_cuotas
               WHERE oc_id = :id AND estado = 'PENDIENTE'"""
        ),
        {"id": oc_id},
    )

    for c in body.cuotas:
        if c.numero_cuota in locked:
            continue  # no piso una cuota con voucher
        await db.execute(
            text(
                """INSERT INTO core.oc_cuotas
                       (oc_id, numero_cuota, monto, fecha_vencimiento, descripcion)
                   VALUES (:oc_id, :n, :monto, :venc, :desc)
                   ON CONFLICT (oc_id, numero_cuota) DO UPDATE SET
                       monto = EXCLUDED.monto,
                       fecha_vencimiento = EXCLUDED.fecha_vencimiento,
                       descripcion = EXCLUDED.descripcion,
                       updated_at = NOW()"""
            ),
            {
                "oc_id": oc_id,
                "n": c.numero_cuota,
                "monto": c.monto,
                "venc": c.fecha_vencimiento,
                "desc": c.descripcion,
            },
        )
    await db.commit()
    return await list_cuotas(user, db, oc_id)


@router.delete(
    "/ordenes-compra/{oc_id}/cuotas/{cuota_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_cuota(
    user: CurrentUser, db: DBSession, oc_id: int, cuota_id: int
) -> Response:
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
    await db.execute(
        text("DELETE FROM core.oc_cuotas WHERE cuota_id = :cid"),
        {"cid": cuota_id},
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
    oc = await _get_oc_or_404(db, oc_id)
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
        return GenerarVouchersResult(
            cuotas_procesadas=0, vouchers_creados=0, vouchers_codigos=[]
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

    total_cuotas = len(pendientes)
    # R152YYYY · Defensive: si user.sub viene vacío o no existe, pasar None
    # (created_by es UUID NULL-able). Antes pasaba '' que rompía con
    # asyncpg.exceptions.DataError: invalid UUID '' length 0.
    sub_raw = getattr(user, "sub", None)
    user_uid: str | None = str(sub_raw) if sub_raw else None
    # Validación adicional — un UUID válido tiene 32–36 chars (con o sin
    # guiones). Si no, pasamos None para no romper el CAST.
    if user_uid is not None and not (32 <= len(user_uid) <= 36):
        user_uid = None

    creados: list[str] = []
    for c in pendientes:
        glosa = (
            f"OC #{oc['numero_oc']} · Cuota {c['numero_cuota']}/{total_cuotas} · "
            f"{c['descripcion'] or 'sin descripción'}"
        )
        # Crear voucher cabecera DRAFT
        v_row = (
            await db.execute(
                text(
                    """
                    INSERT INTO core.vouchers (
                        empresa_codigo, tipo, fecha_contable,
                        glosa, contraparte_rut, contraparte_nombre,
                        contraparte_tipo, moneda, status,
                        forma_pago, created_by
                    ) VALUES (
                        :emp, 'EGRESO', :fecha,
                        :glosa, :rut, :nombre,
                        'PROVEEDOR', :moneda, 'DRAFT',
                        :forma, CAST(:uid AS UUID)
                    )
                    RETURNING voucher_id, codigo
                    """
                ),
                {
                    "emp": oc["empresa_codigo"],
                    "fecha": c["fecha_vencimiento"],
                    "glosa": glosa[:500],
                    "rut": proveedor_rut,
                    "nombre": proveedor_nombre,
                    "moneda": oc.get("moneda") or "CLP",
                    "forma": "TRANSFERENCIA",
                    "uid": user_uid,
                },
            )
        ).first()
        voucher_id = int(v_row[0])
        codigo = str(v_row[1])
        creados.append(codigo)

        # Linkear la cuota al voucher + marcar generada
        await db.execute(
            text(
                """UPDATE core.oc_cuotas
                   SET voucher_id = :vid,
                       estado = 'VOUCHER_GENERADO',
                       updated_at = NOW()
                   WHERE cuota_id = :cid"""
            ),
            {"vid": voucher_id, "cid": c["cuota_id"]},
        )

    await db.commit()
    return GenerarVouchersResult(
        cuotas_procesadas=len(pendientes),
        vouchers_creados=len(creados),
        vouchers_codigos=creados,
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
    dias: Annotated[int, Query(ge=1, le=180)] = 30,
    incluir_vencidas: bool = Query(default=True),
) -> list[CuotaPendiente]:
    """Lista cuotas con vencimiento ≤ N días, estado != PAGADA/ANULADA.

    Default: próximas 30 días + vencidas. Ordenadas por fecha asc.
    Pensado para widget "Próximos vencimientos" y badge sidebar.
    """
    where_clauses = [
        "c.estado IN ('PENDIENTE', 'VOUCHER_GENERADO')",
        f"c.fecha_vencimiento <= CURRENT_DATE + INTERVAL '{int(dias)} days'",
    ]
    if not incluir_vencidas:
        where_clauses.append("c.fecha_vencimiento >= CURRENT_DATE")

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
    )
    return [CuotaPendiente.model_validate(dict(r._mapping)) for r in rows]


@router.get(
    "/ordenes-compra/cuotas/resumen",
    response_model=CuotasResumen,
)
async def cuotas_resumen(
    user: CurrentUser, db: DBSession
) -> CuotasResumen:
    """Resumen de cuotas pendientes (badge/sidebar)."""
    row = (
        await db.execute(
            text(
                """SELECT
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
                   FROM core.oc_cuotas"""
            ),
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
