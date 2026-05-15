"""Etapa H — Deteccion de anomalias en vouchers.

Endpoint puramente estadistico (sin LLM) que evalua un voucher contra
el historico de la misma empresa + mismo proveedor + cuentas usadas
y devuelve una lista de warnings priorizados:

  - HIGH    rojo:    "El monto es 5x mayor al promedio del proveedor"
  - HIGH    rojo:    "Folio duplicado en otro voucher activo"
  - MED     amber:   "Proveedor sin historial previo en esta empresa"
  - MED     amber:   "Dia de la semana inusual (sabado/domingo)"
  - MED     amber:   "Cuenta contable atipica para este proveedor"
  - LOW     ink:     "Glosa muy corta (menos de 15 chars)"

Endpoints:
  GET /vouchers/{id}/anomaly-check    — analiza un voucher existente
  GET /vouchers/anomaly-radar          — lista los N vouchers mas
                                          anomalos (DRAFT/PENDING/APPROVED)
                                          para revision retroactiva.

Heuristicas son SQL puro — rapido (~50ms cada check), barato (sin
tokens AI), y suficientemente preciso para flagging temprano.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.models.voucher import Voucher
from app.services.empresa_scope_service import (
    EmpresaScopeDep,
    assert_empresa_access,
)

router = APIRouter()


SeverityLevel = Literal["HIGH", "MED", "LOW"]


class AnomalyWarning(BaseModel):
    code: str
    severity: SeverityLevel
    title: str
    detail: str
    metric: dict | None = None  # numbers utiles para el FE


class AnomalyReport(BaseModel):
    voucher_id: int
    codigo: str
    score: int  # 0-100, suma ponderada de severities
    warnings: list[AnomalyWarning]
    checked_at: str


# Pesos para calcular el score 0-100
_SEVERITY_WEIGHT = {"HIGH": 30, "MED": 12, "LOW": 4}


async def _check_anomalies(db, voucher: Voucher) -> list[AnomalyWarning]:
    """Corre todas las heuristicas para un voucher dado."""
    warnings: list[AnomalyWarning] = []

    monto = Decimal(voucher.total_credit or 0)

    # ── 1. Monto vs promedio del proveedor ───────────────────────────────
    if voucher.contraparte_rut and monto > 0:
        avg_row = (
            await db.execute(
                text(
                    """
                    SELECT
                        AVG(total_credit) AS avg_monto,
                        STDDEV_POP(total_credit) AS std_monto,
                        COUNT(*) AS n
                    FROM core.vouchers
                    WHERE contraparte_rut = :rut
                      AND empresa_codigo = :emp
                      AND tipo = :tipo
                      AND status IN ('APPROVED', 'EXECUTED', 'SYNCED')
                      AND voucher_id != :vid
                    """
                ),
                {
                    "rut": voucher.contraparte_rut,
                    "emp": voucher.empresa_codigo,
                    "tipo": voucher.tipo,
                    "vid": voucher.voucher_id,
                },
            )
        ).first()
        if avg_row and avg_row[2] and int(avg_row[2]) >= 3:
            avg_m = Decimal(avg_row[0] or 0)
            n = int(avg_row[2])
            if avg_m > 0:
                ratio = monto / avg_m
                if ratio >= Decimal("5"):
                    warnings.append(
                        AnomalyWarning(
                            code="MONTO_FUERA_DE_RANGO",
                            severity="HIGH",
                            title=f"Monto {ratio:.1f}x mayor al promedio del proveedor",
                            detail=(
                                f"Este proveedor ({voucher.contraparte_nombre}) "
                                f"tiene un promedio historico de ${avg_m:,.0f} "
                                f"sobre {n} vouchers. Este voucher es de "
                                f"${monto:,.0f}. Verificá que no haya un error "
                                "de monto antes de enviarlo a aprobacion."
                            ),
                            metric={
                                "monto_actual": float(monto),
                                "promedio_historico": float(avg_m),
                                "ratio": float(ratio),
                                "n_vouchers_historicos": n,
                            },
                        )
                    )
                elif ratio >= Decimal("2.5"):
                    warnings.append(
                        AnomalyWarning(
                            code="MONTO_ALTO_PROVEEDOR",
                            severity="MED",
                            title=f"Monto {ratio:.1f}x mayor al promedio",
                            detail=(
                                f"Promedio historico del proveedor: ${avg_m:,.0f}. "
                                f"Este voucher: ${monto:,.0f}."
                            ),
                            metric={
                                "monto_actual": float(monto),
                                "promedio_historico": float(avg_m),
                                "ratio": float(ratio),
                            },
                        )
                    )

    # ── 2. Folio duplicado (mismo proveedor + mismo numero) ──────────────
    if voucher.doc_tributario_folio and voucher.contraparte_rut:
        dup_row = (
            await db.execute(
                text(
                    """
                    SELECT voucher_id, codigo, status, fecha_documento::text
                    FROM core.vouchers
                    WHERE empresa_codigo = :emp
                      AND contraparte_rut = :rut
                      AND doc_tributario_folio = :folio
                      AND doc_tributario_tipo = :tipo_doc
                      AND voucher_id != :vid
                      AND status NOT IN ('REJECTED', 'VOIDED', 'CANCELLED')
                    LIMIT 3
                    """
                ),
                {
                    "emp": voucher.empresa_codigo,
                    "rut": voucher.contraparte_rut,
                    "folio": voucher.doc_tributario_folio,
                    "tipo_doc": voucher.doc_tributario_tipo,
                    "vid": voucher.voucher_id,
                },
            )
        ).all()
        if dup_row:
            duplicados = [r[1] for r in dup_row]
            warnings.append(
                AnomalyWarning(
                    code="FOLIO_DUPLICADO",
                    severity="HIGH",
                    title=f"Folio {voucher.doc_tributario_folio} ya existe",
                    detail=(
                        f"Encontre {len(duplicados)} voucher(s) activo(s) con el "
                        f"mismo folio para este proveedor: {', '.join(duplicados)}. "
                        "Verificá que no estes duplicando un documento."
                    ),
                    metric={"duplicados": duplicados},
                )
            )

    # ── 3. Proveedor sin historial previo ────────────────────────────────
    if voucher.contraparte_rut:
        prev_count = await db.scalar(
            text(
                """
                SELECT COUNT(*)
                FROM core.vouchers
                WHERE contraparte_rut = :rut
                  AND empresa_codigo = :emp
                  AND voucher_id != :vid
                  AND status IN ('APPROVED', 'EXECUTED', 'SYNCED')
                """
            ),
            {
                "rut": voucher.contraparte_rut,
                "emp": voucher.empresa_codigo,
                "vid": voucher.voucher_id,
            },
        )
        if prev_count == 0 and monto >= Decimal("500000"):
            warnings.append(
                AnomalyWarning(
                    code="PROVEEDOR_NUEVO",
                    severity="MED",
                    title="Primer voucher de este proveedor",
                    detail=(
                        f"No hay historial previo de {voucher.contraparte_nombre} "
                        f"en {voucher.empresa_codigo} con status APPROVED+. "
                        "Verificá que el proveedor este validado y que el monto "
                        "($"
                        + f"{monto:,.0f}"
                        + ") sea esperado."
                    ),
                    metric={"monto": float(monto)},
                )
            )

    # ── 4. Dia de la semana inusual ──────────────────────────────────────
    if voucher.fecha_documento:
        dow = voucher.fecha_documento.weekday()  # 0=lunes, 6=domingo
        if dow >= 5:  # sabado o domingo
            day_label = "sábado" if dow == 5 else "domingo"
            warnings.append(
                AnomalyWarning(
                    code="DIA_INUSUAL",
                    severity="LOW",
                    title=f"Fecha cae en {day_label}",
                    detail=(
                        f"La fecha del documento ({voucher.fecha_documento.isoformat()}) "
                        f"es {day_label}. Los proveedores raramente emiten facturas "
                        "fines de semana — confirmá que la fecha sea correcta."
                    ),
                )
            )

    # ── 5. Glosa muy corta ───────────────────────────────────────────────
    if voucher.glosa and len(voucher.glosa.strip()) < 15:
        warnings.append(
            AnomalyWarning(
                code="GLOSA_CORTA",
                severity="LOW",
                title="Glosa poco descriptiva",
                detail=(
                    f"La glosa tiene solo {len(voucher.glosa.strip())} caracteres. "
                    "Una glosa clara ayuda al cierre contable y a la trazabilidad. "
                    "Sugerencia: incluí proveedor + concepto + folio."
                ),
                metric={"longitud": len(voucher.glosa.strip())},
            )
        )

    # ── 6. Cuenta contable atipica para el proveedor ─────────────────────
    # Si hay 5+ vouchers previos con este proveedor y todos usan cierta
    # cuenta dominante, y este voucher usa otra, flag.
    if voucher.contraparte_rut and voucher.voucher_id:
        result = await db.execute(
            text(
                """
                WITH actuales AS (
                    SELECT DISTINCT vl.cuenta_codigo
                    FROM core.voucher_lines vl
                    WHERE vl.voucher_id = :vid
                      AND vl.tipo_imputacion = 'CONTABLE'
                ),
                historicos AS (
                    SELECT
                        vl.cuenta_codigo,
                        COUNT(DISTINCT v.voucher_id) AS n
                    FROM core.vouchers v
                    JOIN core.voucher_lines vl ON vl.voucher_id = v.voucher_id
                    WHERE v.contraparte_rut = :rut
                      AND v.empresa_codigo = :emp
                      AND v.voucher_id != :vid
                      AND v.status IN ('APPROVED', 'EXECUTED', 'SYNCED')
                      AND vl.tipo_imputacion = 'CONTABLE'
                    GROUP BY vl.cuenta_codigo
                )
                SELECT
                    (SELECT array_agg(cuenta_codigo) FROM actuales) AS actuales,
                    (SELECT array_agg(cuenta_codigo ORDER BY n DESC)
                       FROM historicos
                       WHERE n >= 3) AS dominantes,
                    (SELECT SUM(n) FROM historicos) AS total
                """
            ),
            {
                "rut": voucher.contraparte_rut,
                "emp": voucher.empresa_codigo,
                "vid": voucher.voucher_id,
            },
        )
        row = result.first()
        if row and row[0] and row[1] and row[2] and int(row[2]) >= 5:
            actuales = set(row[0])
            dominantes = set(row[1] or [])
            if dominantes and not (actuales & dominantes):
                warnings.append(
                    AnomalyWarning(
                        code="CUENTA_ATIPICA",
                        severity="MED",
                        title="Cuenta contable distinta a la habitual",
                        detail=(
                            f"Este proveedor historicamente se imputa a "
                            f"{', '.join(sorted(dominantes))} "
                            f"pero este voucher usa "
                            f"{', '.join(sorted(actuales))}. "
                            "Confirmá la imputacion contable."
                        ),
                        metric={
                            "actuales": sorted(actuales),
                            "dominantes_historicas": sorted(dominantes),
                        },
                    )
                )

    return warnings


def _score(warnings: list[AnomalyWarning]) -> int:
    score = 0
    for w in warnings:
        score += _SEVERITY_WEIGHT.get(w.severity, 0)
    return min(100, score)


@router.get(
    "/vouchers/{voucher_id}/anomaly-check",
    response_model=AnomalyReport,
)
async def check_voucher_anomalies(
    user: CurrentUser,
    db: DBSession,
    voucher_id: int,
) -> AnomalyReport:
    """Analiza un voucher existente contra heuristicas de anomalias.

    Devuelve lista de warnings con severity (HIGH/MED/LOW) + score 0-100.
    """
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, voucher.empresa_codigo)

    warnings = await _check_anomalies(db, voucher)
    from datetime import datetime, UTC

    return AnomalyReport(
        voucher_id=voucher_id,
        codigo=voucher.codigo,
        score=_score(warnings),
        warnings=warnings,
        checked_at=datetime.now(UTC).isoformat(),
    )


class AnomalyRadarItem(BaseModel):
    voucher_id: int
    codigo: str
    empresa_codigo: str
    status: str
    contraparte_nombre: str | None
    fecha_documento: date | None
    total: str
    score: int
    top_warnings: list[str]  # codes


class AnomalyRadarResponse(BaseModel):
    items: list[AnomalyRadarItem]
    count: int
    threshold_score: int


@router.get(
    "/vouchers/anomaly-radar",
    response_model=AnomalyRadarResponse,
)
async def voucher_anomaly_radar(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    min_score: Annotated[int, Query(ge=0, le=100)] = 30,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    statuses: Annotated[
        str, Query(description="Statuses separados por coma")
    ] = "DRAFT,PENDING,APPROVED",
) -> AnomalyRadarResponse:
    """Etapa H — radar de vouchers anomalos.

    Recorre los ultimos N vouchers en los statuses pedidos, corre las
    heuristicas, y devuelve los que superan min_score (default 30).
    """
    status_list = [s.strip().upper() for s in statuses.split(",") if s.strip()]
    if not status_list:
        status_list = ["DRAFT", "PENDING", "APPROVED"]

    if scope.is_global:
        scope_clause = ""
        params = {"statuses": status_list, "lim": limit * 4}
    else:
        allowed = list(scope.allowed_codes or [])
        if not allowed:
            return AnomalyRadarResponse(
                items=[], count=0, threshold_score=min_score
            )
        scope_clause = "AND empresa_codigo = ANY(CAST(:scope AS text[]))"
        params = {
            "statuses": status_list,
            "lim": limit * 4,
            "scope": allowed,
        }

    # Pre-fetch candidatos (limit*4 para no perder por filtro de score)
    sql = f"""
        SELECT voucher_id
        FROM core.vouchers
        WHERE status = ANY(:statuses)
          {scope_clause}
        ORDER BY created_at DESC
        LIMIT :lim
    """
    candidates = [int(r[0]) for r in (await db.execute(text(sql), params)).all()]

    items: list[AnomalyRadarItem] = []
    for vid in candidates:
        v = await db.get(Voucher, vid)
        if v is None:
            continue
        warnings = await _check_anomalies(db, v)
        score = _score(warnings)
        if score < min_score:
            continue
        items.append(
            AnomalyRadarItem(
                voucher_id=v.voucher_id,
                codigo=v.codigo,
                empresa_codigo=v.empresa_codigo,
                status=v.status,
                contraparte_nombre=v.contraparte_nombre,
                fecha_documento=v.fecha_documento,
                total=str(v.total_credit),
                score=score,
                top_warnings=[w.code for w in warnings[:3]],
            )
        )
        if len(items) >= limit:
            break

    items.sort(key=lambda x: x.score, reverse=True)
    return AnomalyRadarResponse(
        items=items, count=len(items), threshold_score=min_score
    )
