"""Endpoints de seed/cleanup de vouchers demo (V5).

Genera vouchers de ejemplo realistas para que el dashboard CEO + KPIs
muestren datos sin tener que crear vouchers manualmente. Útil para:
  - Demo a stakeholders
  - Probar el widget VouchersKpiStrip
  - Validar el flujo end-to-end en staging

Cleanup: borra TODOS los vouchers cuyo glosa empieza con "[DEMO]" —
seguro de re-correr.
"""
from __future__ import annotations

import random
from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.deps import DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.services.voucher_service import generate_voucher_code

router = APIRouter()


_DEMO_GLOSA_PREFIX = "[DEMO]"


class SeedVouchersRequest(BaseModel):
    empresa_codigo: str = Field(min_length=2, max_length=20)
    cantidad: int = Field(default=8, ge=1, le=30)


class SeedVouchersResponse(BaseModel):
    empresa_codigo: str
    vouchers_creados: int
    por_estado: dict[str, int]
    cuentas_usadas: dict[str, str]  # role → codigo
    nota: str


class CleanupResponse(BaseModel):
    vouchers_eliminados: int
    lines_eliminadas: int


@router.post(
    "/admin/vouchers-demo/seed",
    response_model=SeedVouchersResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def seed_vouchers_demo(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    body: SeedVouchersRequest,
) -> SeedVouchersResponse:
    """Crea N vouchers demo en distintos estados.

    Para que se respeten todos los invariants (partida doble, cuenta
    imputable, FKs), el flujo es:
      1. Buscar 2 cuentas imputables: una banco (1-XX), una gasto (3-XX o GASTO)
      2. Buscar 1 proyecto activo + 1 área aplicable de la empresa
      3. Crear voucher en DRAFT con 2 líneas cuadradas
      4. Cambiar status (el trigger valida partida doble)

    Distribución de estados:
      - 25% DRAFT (operador editando)
      - 25% PENDING (esperando firma)
      - 20% APPROVED (firmado, sin ejecutar)
      - 15% EXECUTED no conciliado (pago hecho, sin match banco)
      - 10% RECONCILED (todo cuadra)
      - 5% REJECTED (rechazado con razón)
    """
    # 1. Validar empresa
    empresa_existe = await db.scalar(
        text(
            "SELECT 1 FROM core.empresas WHERE codigo = :e AND activo = TRUE"
        ),
        {"e": body.empresa_codigo},
    )
    if not empresa_existe:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Empresa {body.empresa_codigo} no existe o está inactiva",
        )

    # 2. Buscar cuenta banco (tipo ACTIVO + flag_caja preferido)
    banco_row = (
        await db.execute(
            text(
                """
                SELECT pc.codigo
                FROM core.plan_cuentas pc
                INNER JOIN core.plan_cuenta_empresa pce
                  ON pce.cuenta_codigo = pc.codigo
                  AND pce.empresa_codigo = :empresa
                  AND pce.habilitada = TRUE
                WHERE pc.imputable = TRUE
                  AND pc.activa = TRUE
                  AND pc.tipo = 'ACTIVO'
                  AND pc.flag_caja = TRUE
                ORDER BY pc.codigo
                LIMIT 1
                """
            ),
            {"empresa": body.empresa_codigo},
        )
    ).first()
    if not banco_row:
        # Fallback: cualquier cuenta ACTIVO imputable
        banco_row = (
            await db.execute(
                text(
                    """
                    SELECT pc.codigo
                    FROM core.plan_cuentas pc
                    INNER JOIN core.plan_cuenta_empresa pce
                      ON pce.cuenta_codigo = pc.codigo
                      AND pce.empresa_codigo = :empresa
                      AND pce.habilitada = TRUE
                    WHERE pc.imputable = TRUE
                      AND pc.activa = TRUE
                      AND pc.tipo = 'ACTIVO'
                    ORDER BY pc.codigo
                    LIMIT 1
                    """
                ),
                {"empresa": body.empresa_codigo},
            )
        ).first()
    if not banco_row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"No hay cuenta imputable tipo ACTIVO habilitada para "
                f"{body.empresa_codigo}. Importá el plan de cuentas primero."
            ),
        )
    cuenta_banco = banco_row[0]

    # 3. Buscar cuenta gasto
    gasto_row = (
        await db.execute(
            text(
                """
                SELECT pc.codigo
                FROM core.plan_cuentas pc
                INNER JOIN core.plan_cuenta_empresa pce
                  ON pce.cuenta_codigo = pc.codigo
                  AND pce.empresa_codigo = :empresa
                  AND pce.habilitada = TRUE
                WHERE pc.imputable = TRUE
                  AND pc.activa = TRUE
                  AND pc.tipo IN ('GASTO', 'RESULTADO')
                ORDER BY pc.codigo
                LIMIT 1
                """
            ),
            {"empresa": body.empresa_codigo},
        )
    ).first()
    if not gasto_row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"No hay cuenta imputable tipo GASTO habilitada para "
                f"{body.empresa_codigo}."
            ),
        )
    cuenta_gasto = gasto_row[0]

    # 4. Buscar proyecto activo + área aplicable
    proyecto_row = (
        await db.execute(
            text(
                "SELECT codigo FROM core.proyectos_contables "
                "WHERE empresa_codigo = :e AND estado = 'ACTIVE' "
                "ORDER BY codigo LIMIT 1"
            ),
            {"e": body.empresa_codigo},
        )
    ).first()
    proyecto_codigo = proyecto_row[0] if proyecto_row else None

    area_row = (
        await db.execute(
            text(
                "SELECT area_codigo FROM core.area_empresa "
                "WHERE empresa_codigo = :e AND aplica = TRUE "
                "ORDER BY area_codigo LIMIT 1"
            ),
            {"e": body.empresa_codigo},
        )
    ).first()
    area_codigo = area_row[0] if area_row else None

    # 5. Distribución de estados (segura para los CHECK del DB)
    estados_pool = (
        ["DRAFT"] * max(2, body.cantidad // 4)
        + ["PENDING"] * max(2, body.cantidad // 4)
        + ["APPROVED"] * max(1, body.cantidad // 5)
        + ["EXECUTED"] * max(1, body.cantidad // 6)
        + ["RECONCILED"] * max(1, body.cantidad // 8)
        + ["REJECTED"]
    )
    random.shuffle(estados_pool)
    estados_pool = estados_pool[: body.cantidad]

    # 6. Crear vouchers
    counters: dict[str, int] = {}
    today = date.today()
    proveedores_demo = [
        ("76.111.111-1", "Proveedor Demo Alpha SpA"),
        ("77.222.222-2", "Servicios Beta Ltda"),
        ("78.333.333-3", "Consultoría Gamma S.A."),
        ("79.444.444-4", "Insumos Delta SpA"),
    ]
    glosas_demo = [
        f"{_DEMO_GLOSA_PREFIX} Pago servicios consultoría",
        f"{_DEMO_GLOSA_PREFIX} Compra suministros operación",
        f"{_DEMO_GLOSA_PREFIX} Honorarios profesionales",
        f"{_DEMO_GLOSA_PREFIX} Reparación equipos",
        f"{_DEMO_GLOSA_PREFIX} Servicios técnicos especializados",
    ]
    montos_demo = [
        Decimal("119000"),    # bajo, no reforzado
        Decimal("450000"),
        Decimal("1190000"),
        Decimal("3500000"),
        Decimal("5950000"),    # cruza umbral 5M, debería ser reforzado
        Decimal("8900000"),
    ]

    for est in estados_pool:
        # Crear voucher en DRAFT primero (para evitar trigger partida doble en INSERT)
        codigo = await generate_voucher_code(
            db, body.empresa_codigo, today.year, "EGRESO"
        )
        proveedor = random.choice(proveedores_demo)
        glosa = random.choice(glosas_demo)
        monto = random.choice(montos_demo)
        fecha_offset = random.randint(0, 30)
        fecha_doc = today - timedelta(days=fecha_offset)

        result = await db.execute(
            text(
                """
                INSERT INTO core.vouchers (
                    codigo, empresa_codigo, tipo, status,
                    fecha_documento, fecha_contable, fecha_ejecucion,
                    glosa, total_debit, total_credit, moneda,
                    contraparte_rut, contraparte_nombre, contraparte_tipo,
                    banco, banco_cuenta_alias,
                    threshold_aplicado,
                    created_by, requested_by,
                    rejection_reason
                )
                VALUES (
                    :codigo, :empresa, 'EGRESO', 'DRAFT',
                    :fecha_doc, :fecha_doc, :fecha_doc,
                    :glosa, :monto, :monto, 'CLP',
                    :rut, :nombre, 'PROVEEDOR',
                    'BCI', 'Operativa',
                    :reforzado,
                    CAST(:user AS UUID), CAST(:user AS UUID),
                    :rejection
                )
                RETURNING voucher_id
                """
            ),
            {
                "codigo": codigo,
                "empresa": body.empresa_codigo,
                "fecha_doc": fecha_doc,
                "glosa": f"{glosa} #{random.randint(1000, 9999)}",
                "monto": monto,
                "rut": proveedor[0],
                "nombre": proveedor[1],
                "reforzado": monto >= Decimal("5000000"),
                "user": str(user.sub),
                "rejection": (
                    f"{_DEMO_GLOSA_PREFIX} Falta documentación de respaldo (demo)"
                    if est == "REJECTED"
                    else None
                ),
            },
        )
        voucher_id = result.scalar_one()

        # Crear líneas debe/haber (cuadradas)
        await db.execute(
            text(
                """
                INSERT INTO core.voucher_lines (
                    voucher_id, line_number, cuenta_codigo, proyecto_codigo,
                    area_codigo, debit, credit, descripcion, balance_treatment
                ) VALUES
                    (:v, 1, :gasto, :proy, :area, :monto, 0, '[DEMO] Línea gasto', 'GASTO'),
                    (:v, 2, :banco, NULL,   NULL,  0, :monto, '[DEMO] Salida banco', 'NA')
                """
            ),
            {
                "v": voucher_id,
                "gasto": cuenta_gasto,
                "banco": cuenta_banco,
                "proy": proyecto_codigo,
                "area": area_codigo,
                "monto": monto,
            },
        )

        # Cambiar status (el trigger valida partida doble — pasa porque cuadran)
        if est != "DRAFT":
            await db.execute(
                text(
                    "UPDATE core.vouchers SET status = :st WHERE voucher_id = :v"
                ),
                {"st": est, "v": voucher_id},
            )

        counters[est] = counters.get(est, 0) + 1

    await db.commit()

    return SeedVouchersResponse(
        empresa_codigo=body.empresa_codigo,
        vouchers_creados=body.cantidad,
        por_estado=counters,
        cuentas_usadas={
            "banco": cuenta_banco,
            "gasto": cuenta_gasto,
            "proyecto": proyecto_codigo or "(sin proyecto)",
            "area": area_codigo or "(sin área)",
        },
        nota=(
            "Vouchers de demo creados. Glosa empieza con [DEMO]. "
            "Para limpiar: POST /admin/vouchers-demo/cleanup."
        ),
    )


@router.post(
    "/admin/vouchers-demo/cleanup",
    response_model=CleanupResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def cleanup_vouchers_demo(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
) -> CleanupResponse:
    """Borra TODOS los vouchers cuya glosa empieza con [DEMO].

    Trigger inmutabilidad post-cierre puede bloquear si los vouchers
    están en período cerrado — ese es el comportamiento correcto, no
    se borran.
    """
    # Contar lines primero
    lines_count = await db.scalar(
        text(
            """
            SELECT COUNT(*) FROM core.voucher_lines vl
            INNER JOIN core.vouchers v ON v.voucher_id = vl.voucher_id
            WHERE v.glosa LIKE :prefix
            """
        ),
        {"prefix": f"{_DEMO_GLOSA_PREFIX}%"},
    )

    # CASCADE borra lines + attachments + approvals + nubox_export_voucher
    res = await db.execute(
        text(
            "DELETE FROM core.vouchers WHERE glosa LIKE :prefix"
        ),
        {"prefix": f"{_DEMO_GLOSA_PREFIX}%"},
    )
    await db.commit()
    return CleanupResponse(
        vouchers_eliminados=res.rowcount,
        lines_eliminadas=int(lines_count or 0),
    )
