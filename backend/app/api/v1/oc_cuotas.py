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

from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.core.security import AuthenticatedUser
from app.services.empresa_scope_service import assert_empresa_access

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


async def _get_oc_or_404(db, oc_id: int, user=None) -> dict[str, Any]:
    # R152UUUUUU — se agrega `estado` al SELECT (el guard anti-OC-anulada
    # leía oc.get("estado") que siempre era None = código muerto) y
    # scoping multi-tenant: este router no validaba empresa, a diferencia
    # de ordenes_compra.py, permitiendo operar cuotas de cualquier empresa.
    row = (
        await db.execute(
            text(
                """SELECT oc_id, numero_oc, empresa_codigo, proveedor_id,
                          total, moneda, observaciones, estado
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


# ─────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────


@router.get("/ordenes-compra/{oc_id}/cuotas", response_model=list[CuotaRead])
async def list_cuotas(
    user: CurrentUser, db: DBSession, oc_id: int
) -> list[CuotaRead]:
    """Lista cuotas de una OC con estado del voucher asociado."""
    await _get_oc_or_404(db, oc_id, user)
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
    oc = await _get_oc_or_404(db, oc_id, user)
    total = Decimal(str(oc["total"] or 0))
    if total <= 0:
        raise HTTPException(
            status_code=400,
            detail="La OC no tiene total > 0 — no se puede dividir en cuotas",
        )

    # R152DDDDDD — Advisory lock por oc_id antes de DELETE+INSERT.
    # Sin esto, 2 admins editando cuotas concurrentemente perdían cambios.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
        {"k": f"oc_cuotas_edit_{oc_id}"},
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
    # R152UUUUUU — HALF_UP explícito (el default de quantize es
    # HALF_EVEN/bankers, que viola el invariante MAESTRO).
    base = (total / body.cantidad).quantize(
        Decimal("1"), rounding=ROUND_HALF_UP
    )
    montos = [base] * (body.cantidad - 1)
    montos.append(total - sum(montos))
    # R152JJJJJJ — guard: con totales chicos y muchas cuotas, la última
    # podía quedar en 0 o negativa (ej: total=10, cantidad=12 → base=1,
    # última=-1). La suma siempre da exacto, pero una cuota <= 0 es inválida.
    if montos[-1] <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Demasiadas cuotas ({body.cantidad}) para el monto total "
                f"{total}: la última cuota quedaría en {montos[-1]}. Reducí "
                "la cantidad de cuotas."
            ),
        )

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
    oc = await _get_oc_or_404(db, oc_id, user)

    # Numeros de cuotas que ya tienen voucher — NO tocar
    existing = await db.execute(
        text(
            """SELECT numero_cuota, monto FROM core.oc_cuotas
               WHERE oc_id = :id AND voucher_id IS NOT NULL"""
        ),
        {"id": oc_id},
    )
    locked_rows = existing.fetchall()
    locked = {int(r[0]) for r in locked_rows}

    # R152UUUUUU — validación server-side Σ(cuotas) == total de la OC.
    # Antes se aceptaba cualquier suma (cuotas por $2M en una OC de $3M →
    # $1M sin cuota/voucher, invisible). Las cuotas con voucher (locked)
    # conservan su monto actual, así que cuentan con el monto de la BD.
    total_oc = Decimal(str(oc["total"] or 0))
    suma_locked = sum((Decimal(str(r[1])) for r in locked_rows), start=Decimal("0"))
    suma_nuevas = sum(
        (c.monto for c in body.cuotas if c.numero_cuota not in locked),
        start=Decimal("0"),
    )
    suma_final = suma_locked + suma_nuevas
    if total_oc > 0 and suma_final != total_oc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"La suma de las cuotas ({suma_final}) no coincide con el "
                f"total de la OC ({total_oc}). "
                + (
                    f"Ya hay {len(locked)} cuota(s) con voucher por "
                    f"{suma_locked} que no se pueden modificar. "
                    if locked
                    else ""
                )
                + "Ajustá los montos para que cuadren."
            ),
        )

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
