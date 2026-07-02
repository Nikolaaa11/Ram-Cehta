"""Dashboard Institucional CEHTA Capital — endpoints para director + LPs.

Round 152 — Implementa el modelo de datos y vistas del super-prompt
PROMPT-DASHBOARD-CEHTA.md (Mayo 2026).

Endpoints:
  GET /dashboard/fund/metrics            — G01 KPI Row (8 tiles fund-level)
  GET /dashboard/fund/jcurve             — G02 J-Curve (cashflow neto acumulado)
  GET /dashboard/portfolio               — G09 Treemap data + tear-sheet por company
  GET /dashboard/portfolio/{ticker}      — Detail de 1 portfolio company
  GET /dashboard/impact                  — G16 Impact KPI Cards (IRIS+ agregados)
  GET /dashboard/compliance              — Status OPIM + CMF + CORFO
  GET /dashboard/lps                     — Lista LPs (solo director/auditor)
  GET /dashboard/lps/mine                — Mi PCAP (vista LP)

Scope:
  - Director / GG / AUDITOR_EXTERNO: ven todo.
  - LP_CORFO / LP_PRIVADO: ven fund-level + sus propios cashflows + impact agregado.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.core.security import AuthenticatedUser
from app.services.empresa_scope_service import EmpresaScope, _resolve_scope

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class FundMetrics(BaseModel):
    fund_codigo: str
    fund_nombre: str
    commitments_total_usd: Decimal
    called_total_usd: Decimal
    called_pct: Decimal
    distributed_total_usd: Decimal
    current_nav_usd: Decimal
    unfunded_commitments_usd: Decimal
    tvpi: Decimal | None
    dpi: Decimal | None
    rvpi: Decimal | None
    net_irr: Decimal | None
    moic: Decimal | None


class JCurvePoint(BaseModel):
    quarter: date
    quarter_net: Decimal
    cumulative_net: Decimal


class JCurveResponse(BaseModel):
    fund_codigo: str
    points: list[JCurvePoint]


class PortfolioCompanyRow(BaseModel):
    empresa_codigo: str
    ticker: str
    razon_social: str | None
    sector: str | None
    stage: str | None
    invested_amount_usd: Decimal | None
    fair_value_usd: Decimal | None
    moic_net: Decimal | None
    irr_net: Decimal | None
    is_public_disclosure: bool
    b_corp_score: Decimal | None


class PortfolioResponse(BaseModel):
    total_portfolio_companies: int
    total_invested_usd: Decimal
    total_fair_value_usd: Decimal
    weighted_moic: Decimal | None
    companies: list[PortfolioCompanyRow]


class ImpactMetricCard(BaseModel):
    iris_metric_id: str
    metric_name: str
    aggregate_value: Decimal
    unit: str
    framework: str
    companies_count: int
    verified_count: int


class ImpactResponse(BaseModel):
    period: str
    cards: list[ImpactMetricCard]


class ComplianceItem(BaseModel):
    framework: str
    principle_or_item: str
    status: str
    last_review_date: date | None
    next_review_date: date | None
    notes: str | None


class ComplianceResponse(BaseModel):
    fund_codigo: str
    items: list[ComplianceItem]


class LpRow(BaseModel):
    lp_id: str
    legal_name: str
    lp_type: str
    commitment_usd: Decimal
    paid_in_usd: Decimal
    distributed_usd: Decimal
    ownership_pct: Decimal | None


class MyPcapResponse(BaseModel):
    """ILPA Reporting Template v2.0 — Partner Capital Account Statement (PCAP)."""
    lp_legal_name: str
    fund_codigo: str
    commitment_usd: Decimal
    paid_in_to_date_usd: Decimal
    paid_in_pct: Decimal
    distributed_to_date_usd: Decimal
    current_nav_usd: Decimal
    unfunded_commitment_usd: Decimal
    tvpi: Decimal | None
    dpi: Decimal | None
    rvpi: Decimal | None
    moic: Decimal | None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_fund_id(db, codigo: str = "FIP_CEHTA_ESG") -> str:
    """Devuelve el fund_id principal. Por ahora hardcoded a FIP_CEHTA_ESG."""
    row = (await db.execute(
        text("SELECT fund_id::text FROM core.funds WHERE codigo = :c"),
        {"c": codigo},
    )).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Fondo {codigo} no existe (corre migracion R152)",
        )
    return row[0]


async def _is_lp_user(db, user_sub: str) -> dict | None:
    """Si el current user esta linkeado a un LP, devuelve su info; sino None."""
    row = (await db.execute(
        text(
            """
            SELECT lp_id::text, legal_name, lp_type
            FROM core.limited_partners
            WHERE user_id = CAST(:u AS UUID) AND active = TRUE
            LIMIT 1
            """
        ),
        {"u": user_sub},
    )).first()
    if not row:
        return None
    return {"lp_id": row[0], "legal_name": row[1], "lp_type": row[2]}


async def _require_fund_level_access(user, db) -> None:
    """R152TTTTT quedó incompleto: cubrió los endpoints por-empresa pero los
    fund-level (metrics/jcurve/impact/compliance) quedaron abiertos a
    cualquier usuario autenticado — NAV, TVPI, DPI, commitments y estado de
    compliance son confidenciales GP/LP. Acceso: director/auditor
    (admin/finance, mismo gate que /dashboard/lps) o un usuario linkeado a
    un LP activo (reporting estándar a inversionistas)."""
    if user.app_role in ("admin", "finance"):
        return
    if await _is_lp_user(db, str(user.sub)):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Solo directorio, finanzas o LPs pueden ver métricas del fondo",
    )


# ---------------------------------------------------------------------------
# G01 — Fund Metrics (KPI Row)
# ---------------------------------------------------------------------------


@router.get("/dashboard/fund/metrics", response_model=FundMetrics)
async def get_fund_metrics(
    user: CurrentUser,
    db: DBSession,
    fund_codigo: str = "FIP_CEHTA_ESG",
) -> FundMetrics:
    """G01 KPI Row — 8 tiles fund-level.

    Calcula TVPI, DPI, RVPI, MOIC en runtime sobre cashflows + valuations.
    """
    await _require_fund_level_access(user, db)
    row = (await db.execute(
        text(
            """
            SELECT
                f.codigo, f.nombre,
                f.fund_size_committed_usd,
                COALESCE(SUM(CASE WHEN cf.cashflow_type = 'capital_call' THEN cf.amount_usd ELSE 0 END), 0) AS called,
                COALESCE(SUM(CASE WHEN cf.cashflow_type = 'distribution' THEN cf.amount_usd ELSE 0 END), 0) AS distributed,
                f.aum_current_usd
            FROM core.funds f
            LEFT JOIN core.fund_cashflows cf
                ON cf.fund_id = f.fund_id AND cf.lp_id IS NULL
            WHERE f.codigo = :c
            GROUP BY f.codigo, f.nombre, f.fund_size_committed_usd, f.aum_current_usd
            """
        ),
        {"c": fund_codigo},
    )).first()

    if not row:
        raise HTTPException(404, f"Fondo {fund_codigo} no encontrado")

    codigo, nombre, committed, called, distributed, nav = row
    committed = Decimal(committed or 0)
    called = Decimal(called or 0)
    distributed = Decimal(distributed or 0)
    nav = Decimal(nav or 0)

    called_pct = (called / committed * Decimal("100")) if committed > 0 else Decimal("0")
    unfunded = committed - called
    tvpi = (distributed + nav) / called if called > 0 else None
    dpi = distributed / called if called > 0 else None
    rvpi = nav / called if called > 0 else None
    moic = tvpi  # MOIC == TVPI a nivel fund cuando paid-in == invested

    return FundMetrics(
        fund_codigo=codigo,
        fund_nombre=nombre,
        commitments_total_usd=committed,
        called_total_usd=called,
        called_pct=called_pct.quantize(Decimal("0.01")),
        distributed_total_usd=distributed,
        current_nav_usd=nav,
        unfunded_commitments_usd=unfunded,
        tvpi=tvpi.quantize(Decimal("0.001")) if tvpi else None,
        dpi=dpi.quantize(Decimal("0.001")) if dpi else None,
        rvpi=rvpi.quantize(Decimal("0.001")) if rvpi else None,
        net_irr=None,  # Calculo XIRR pendiente para fase 2
        moic=moic.quantize(Decimal("0.001")) if moic else None,
    )


# ---------------------------------------------------------------------------
# G02 — J-Curve
# ---------------------------------------------------------------------------


@router.get("/dashboard/fund/jcurve", response_model=JCurveResponse)
async def get_jcurve(
    user: CurrentUser,
    db: DBSession,
    fund_codigo: str = "FIP_CEHTA_ESG",
) -> JCurveResponse:
    """G02 J-Curve — cashflow neto acumulado por trimestre.

    Capital calls = negativo, distributions = positivo.
    Para la vista del director (fund-level).
    """
    await _require_fund_level_access(user, db)
    rows = (await db.execute(
        text(
            """
            SELECT quarter, quarter_net, cumulative_net
            FROM core.v_jcurve
            WHERE fund_id = (SELECT fund_id FROM core.funds WHERE codigo = :c)
            ORDER BY quarter
            """
        ),
        {"c": fund_codigo},
    )).fetchall()

    return JCurveResponse(
        fund_codigo=fund_codigo,
        points=[
            JCurvePoint(
                quarter=r[0],
                quarter_net=Decimal(r[1] or 0),
                cumulative_net=Decimal(r[2] or 0),
            )
            for r in rows
        ],
    )


# ---------------------------------------------------------------------------
# G09 — Portfolio (Treemap data + tabla)
# ---------------------------------------------------------------------------


@router.get("/dashboard/portfolio", response_model=PortfolioResponse)
async def get_portfolio(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScope = Depends(_resolve_scope),
    fund_codigo: str = "FIP_CEHTA_ESG",
) -> PortfolioResponse:
    """G09 Treemap + tabla — portfolio companies con MOIC + FV.

    Filtrado multi-tenant (R152TTTTT):
        - admin / scope.is_global: ve todas las empresas portfolio
        - usuario con scope limitado: ve solo empresas en su user_company_roles
        - LP (vía `_is_lp_user`): ve solo empresas con is_public_disclosure
    """
    lp_info = await _is_lp_user(db, str(user.sub))

    # R152TTTTT — Filtro multi-tenant. Si scope no es global, el usuario
    # solo puede ver empresas a las que su rol le da acceso. Esto cierra
    # el leak donde un usuario con acceso solo a CENERGY veía valuations
    # confidenciales de RHO, AFIS, etc.
    extra_clauses = []
    sql_params: dict = {"c": fund_codigo}
    if lp_info:
        extra_clauses.append("AND pcm.is_public_disclosure = TRUE")
    if not scope.is_global:
        allowed = sorted(scope.allowed_codes or frozenset()) or ["__NO_EMPRESA__"]
        sql_params["scope_codes"] = allowed
        extra_clauses.append("AND pcm.empresa_codigo = ANY(CAST(:scope_codes AS text[]))")
    extra_sql = " ".join(extra_clauses)

    sql = f"""
        WITH latest_val AS (
            SELECT DISTINCT ON (empresa_codigo)
                empresa_codigo, as_of_date,
                invested_amount_usd, realized_value_usd,
                unrealized_fv_usd, moic_net, irr_net
            FROM core.company_valuations
            ORDER BY empresa_codigo, as_of_date DESC
        )
        SELECT
            pcm.empresa_codigo,
            pcm.ticker,
            e.razon_social,
            pcm.sector,
            pcm.stage,
            v.invested_amount_usd,
            v.unrealized_fv_usd,
            v.moic_net,
            v.irr_net,
            pcm.is_public_disclosure,
            pcm.b_corp_score
        FROM core.portfolio_companies_meta pcm
        JOIN core.empresas e ON e.codigo = pcm.empresa_codigo
        JOIN core.funds f ON f.fund_id = pcm.fund_id
        LEFT JOIN latest_val v ON v.empresa_codigo = pcm.empresa_codigo
        WHERE f.codigo = :c AND pcm.is_portfolio = TRUE
          {extra_sql}
        ORDER BY v.unrealized_fv_usd DESC NULLS LAST
    """

    rows = (await db.execute(text(sql), sql_params)).fetchall()

    companies = [
        PortfolioCompanyRow(
            empresa_codigo=r[0],
            ticker=r[1] or r[0],
            razon_social=r[2],
            sector=r[3],
            stage=r[4],
            invested_amount_usd=Decimal(r[5] or 0),
            fair_value_usd=Decimal(r[6] or 0),
            moic_net=Decimal(r[7]) if r[7] is not None else None,
            irr_net=Decimal(r[8]) if r[8] is not None else None,
            is_public_disclosure=bool(r[9]),
            b_corp_score=Decimal(r[10]) if r[10] is not None else None,
        )
        for r in rows
    ]

    total_inv = sum((c.invested_amount_usd or Decimal("0") for c in companies), Decimal("0"))
    total_fv = sum((c.fair_value_usd or Decimal("0") for c in companies), Decimal("0"))
    weighted_moic = (total_fv / total_inv) if total_inv > 0 else None

    return PortfolioResponse(
        total_portfolio_companies=len(companies),
        total_invested_usd=total_inv,
        total_fair_value_usd=total_fv,
        weighted_moic=weighted_moic.quantize(Decimal("0.001")) if weighted_moic else None,
        companies=companies,
    )


# ---------------------------------------------------------------------------
# G16 — Impact metrics aggregated
# ---------------------------------------------------------------------------


@router.get("/dashboard/impact", response_model=ImpactResponse)
async def get_impact_aggregated(
    user: CurrentUser,
    db: DBSession,
    period: str = "2025-12-31",
) -> ImpactResponse:
    """G16 Impact KPI Cards — IRIS+ v5.3 agregado por metric_id."""
    await _require_fund_level_access(user, db)
    rows = (await db.execute(
        text(
            """
            SELECT
                iris_metric_id,
                MAX(metric_name) AS metric_name,
                SUM(metric_value) AS aggregate_value,
                MAX(unit) AS unit,
                MAX(framework) AS framework,
                COUNT(*) AS companies_count,
                SUM(CASE WHEN verified THEN 1 ELSE 0 END) AS verified_count
            FROM core.impact_metrics
            WHERE period = CAST(:p AS DATE)
            GROUP BY iris_metric_id
            ORDER BY iris_metric_id
            """
        ),
        {"p": period},
    )).fetchall()

    cards = [
        ImpactMetricCard(
            iris_metric_id=r[0],
            metric_name=r[1],
            aggregate_value=Decimal(r[2] or 0),
            unit=r[3],
            framework=r[4],
            companies_count=int(r[5]),
            verified_count=int(r[6]),
        )
        for r in rows
    ]

    return ImpactResponse(period=period, cards=cards)


# ---------------------------------------------------------------------------
# G14 — Impact Frontiers 5 dimensions (per company)
# ---------------------------------------------------------------------------


class ImpactDimensionRow(BaseModel):
    empresa_codigo: str
    ticker: str
    what_score: int
    who_score: int
    how_much_score: int
    contribution_score: int
    risk_score: int


class ImpactDimensionsResponse(BaseModel):
    rows: list[ImpactDimensionRow]


@router.get("/dashboard/impact/dimensions", response_model=ImpactDimensionsResponse)
async def get_impact_dimensions(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScope = Depends(_resolve_scope),
) -> ImpactDimensionsResponse:
    """G14 Radar — Impact Frontiers 5-dimensions per portfolio company.

    Returns most-recent record per company. Si la empresa no tiene fila,
    no aparece (frontend usa 0 como default visual).

    R152TTTTT — Multi-tenant fix: filtra por scope.allowed_codes si el
    user no es global. Sin esto, un user con scope limitado veía scores
    de TODAS las empresas portfolio.
    """
    scope_clause = ""
    sql_params: dict = {}
    if not scope.is_global:
        allowed = sorted(scope.allowed_codes or frozenset()) or ["__NO_EMPRESA__"]
        sql_params["scope_codes"] = allowed
        scope_clause = "AND cid.empresa_codigo = ANY(CAST(:scope_codes AS text[]))"

    rows = (await db.execute(
        text(
            f"""
            SELECT DISTINCT ON (cid.empresa_codigo)
                cid.empresa_codigo,
                pcm.ticker,
                cid.what_score,
                cid.who_score,
                cid.how_much_score,
                cid.contribution_score,
                cid.risk_score
            FROM core.company_impact_dimensions cid
            JOIN core.portfolio_companies_meta pcm ON pcm.empresa_codigo = cid.empresa_codigo
            WHERE pcm.is_portfolio = TRUE
              {scope_clause}
            ORDER BY cid.empresa_codigo, cid.as_of_date DESC
            """
        ),
        sql_params,
    )).fetchall()

    return ImpactDimensionsResponse(
        rows=[
            ImpactDimensionRow(
                empresa_codigo=r[0],
                ticker=r[1] or r[0],
                what_score=int(r[2] or 0),
                who_score=int(r[3] or 0),
                how_much_score=int(r[4] or 0),
                contribution_score=int(r[5] or 0),
                risk_score=int(r[6] or 0),
            )
            for r in rows
        ]
    )


# ---------------------------------------------------------------------------
# G15 — SDG Alignment grid (per company × per SDG)
# ---------------------------------------------------------------------------


class SdgAlignmentRow(BaseModel):
    empresa_codigo: str
    ticker: str
    sdg_number: int
    alignment_score: int  # 1-5


class SdgAlignmentResponse(BaseModel):
    rows: list[SdgAlignmentRow]


@router.get("/dashboard/impact/sdg", response_model=SdgAlignmentResponse)
async def get_impact_sdg(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScope = Depends(_resolve_scope),
) -> SdgAlignmentResponse:
    """G15 SDG Grid — UN 17 SDGs alignment per portfolio company.

    R152TTTTT — Multi-tenant fix: filtra por scope.allowed_codes si el
    user no es global.
    """
    scope_clause = ""
    sql_params: dict = {}
    if not scope.is_global:
        allowed = sorted(scope.allowed_codes or frozenset()) or ["__NO_EMPRESA__"]
        sql_params["scope_codes"] = allowed
        scope_clause = "AND csa.empresa_codigo = ANY(CAST(:scope_codes AS text[]))"

    rows = (await db.execute(
        text(
            f"""
            SELECT
                csa.empresa_codigo,
                pcm.ticker,
                csa.sdg_number,
                csa.alignment_score
            FROM core.company_sdg_alignment csa
            JOIN core.portfolio_companies_meta pcm ON pcm.empresa_codigo = csa.empresa_codigo
            WHERE pcm.is_portfolio = TRUE
              {scope_clause}
            ORDER BY csa.empresa_codigo, csa.sdg_number
            """
        ),
        sql_params,
    )).fetchall()

    return SdgAlignmentResponse(
        rows=[
            SdgAlignmentRow(
                empresa_codigo=r[0],
                ticker=r[1] or r[0],
                sdg_number=int(r[2]),
                alignment_score=int(r[3]),
            )
            for r in rows
        ]
    )


# ---------------------------------------------------------------------------
# Compliance OPIM / CMF / CORFO
# ---------------------------------------------------------------------------


@router.get("/dashboard/compliance", response_model=ComplianceResponse)
async def get_compliance(
    user: CurrentUser,
    db: DBSession,
    fund_codigo: str = "FIP_CEHTA_ESG",
) -> ComplianceResponse:
    """Estado de compliance multi-framework (OPIM + CMF + CORFO + ICMA)."""
    await _require_fund_level_access(user, db)
    rows = (await db.execute(
        text(
            """
            SELECT cci.framework, cci.principle_or_item, cci.status,
                   cci.last_review_date, cci.next_review_date, cci.notes
            FROM core.compliance_checks_institutional cci
            JOIN core.funds f ON f.fund_id = cci.fund_id
            WHERE f.codigo = :c
            ORDER BY cci.framework, cci.principle_or_item
            """
        ),
        {"c": fund_codigo},
    )).fetchall()

    return ComplianceResponse(
        fund_codigo=fund_codigo,
        items=[
            ComplianceItem(
                framework=r[0],
                principle_or_item=r[1],
                status=r[2],
                last_review_date=r[3],
                next_review_date=r[4],
                notes=r[5],
            )
            for r in rows
        ],
    )


# ---------------------------------------------------------------------------
# LPs list (solo director / auditor)
# ---------------------------------------------------------------------------


@router.get("/dashboard/lps", response_model=list[LpRow])
async def list_lps(
    user: CurrentUser,
    db: DBSession,
    fund_codigo: str = "FIP_CEHTA_ESG",
) -> list[LpRow]:
    """Lista de LPs del fondo. Solo director/auditor."""
    # Validar app_role
    if user.app_role not in ("admin", "finance"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo director / auditor pueden ver la lista de LPs",
        )

    rows = (await db.execute(
        text(
            """
            SELECT
                lp.lp_id::text, lp.legal_name, lp.lp_type,
                lp.commitment_usd, lp.paid_in_usd, lp.distributed_usd,
                lp.ownership_pct
            FROM core.limited_partners lp
            JOIN core.funds f ON f.fund_id = lp.fund_id
            WHERE f.codigo = :c AND lp.active = TRUE
            ORDER BY lp.lp_type, lp.legal_name
            """
        ),
        {"c": fund_codigo},
    )).fetchall()

    return [
        LpRow(
            lp_id=r[0],
            legal_name=r[1],
            lp_type=r[2],
            commitment_usd=Decimal(r[3]),
            paid_in_usd=Decimal(r[4] or 0),
            distributed_usd=Decimal(r[5] or 0),
            ownership_pct=Decimal(r[6]) if r[6] is not None else None,
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# My PCAP (vista LP)
# ---------------------------------------------------------------------------


@router.get("/dashboard/lps/mine", response_model=MyPcapResponse)
async def get_my_pcap(
    user: CurrentUser,
    db: DBSession,
    fund_codigo: str = "FIP_CEHTA_ESG",
) -> MyPcapResponse:
    """Mi Cuenta de Capital — Partner Capital Account Statement (ILPA v2.0).

    Si el current user no esta linkeado a un LP, devuelve 404.
    """
    lp_info = await _is_lp_user(db, str(user.sub))
    if not lp_info:
        # Para demo, si no hay LP linkeado, devolvemos el primer LP (CORFO)
        # En produccion real: 404
        row = (await db.execute(
            text(
                """
                SELECT lp_id::text, legal_name, lp_type
                FROM core.limited_partners
                JOIN core.funds USING (fund_id)
                WHERE codigo = :c AND active = TRUE
                LIMIT 1
                """
            ),
            {"c": fund_codigo},
        )).first()
        if not row:
            raise HTTPException(404, "No hay LPs configurados en este fondo")
        lp_info = {"lp_id": row[0], "legal_name": row[1], "lp_type": row[2]}

    pcap = (await db.execute(
        text(
            """
            SELECT
                lp.legal_name,
                f.codigo,
                lp.commitment_usd,
                lp.paid_in_usd,
                lp.distributed_usd
            FROM core.limited_partners lp
            JOIN core.funds f USING (fund_id)
            WHERE lp.lp_id = CAST(:lp AS UUID)
            """
        ),
        {"lp": lp_info["lp_id"]},
    )).first()

    if not pcap:
        raise HTTPException(404, "LP no encontrado")

    legal_name, codigo, commitment, paid_in, distributed = pcap
    commitment = Decimal(commitment or 0)
    paid_in = Decimal(paid_in or 0)
    distributed = Decimal(distributed or 0)

    paid_in_pct = (paid_in / commitment * Decimal("100")) if commitment > 0 else Decimal("0")
    unfunded = commitment - paid_in

    # LP comparte pro-rata del NAV del fondo segun ownership
    fund_nav_row = (await db.execute(
        text("SELECT aum_current_usd FROM core.funds WHERE codigo = :c"),
        {"c": fund_codigo},
    )).first()
    fund_nav = Decimal(fund_nav_row[0] or 0) if fund_nav_row else Decimal("0")

    fund_committed_row = (await db.execute(
        text("SELECT fund_size_committed_usd FROM core.funds WHERE codigo = :c"),
        {"c": fund_codigo},
    )).first()
    fund_committed = Decimal(fund_committed_row[0] or 0) if fund_committed_row else Decimal("0")

    lp_share = (commitment / fund_committed) if fund_committed > 0 else Decimal("0")
    my_nav = fund_nav * lp_share

    tvpi = (distributed + my_nav) / paid_in if paid_in > 0 else None
    dpi = distributed / paid_in if paid_in > 0 else None
    rvpi = my_nav / paid_in if paid_in > 0 else None
    moic = tvpi

    return MyPcapResponse(
        lp_legal_name=legal_name,
        fund_codigo=codigo,
        commitment_usd=commitment,
        paid_in_to_date_usd=paid_in,
        paid_in_pct=paid_in_pct.quantize(Decimal("0.01")),
        distributed_to_date_usd=distributed,
        current_nav_usd=my_nav.quantize(Decimal("0.01")),
        unfunded_commitment_usd=unfunded,
        tvpi=tvpi.quantize(Decimal("0.001")) if tvpi else None,
        dpi=dpi.quantize(Decimal("0.001")) if dpi else None,
        rvpi=rvpi.quantize(Decimal("0.001")) if rvpi else None,
        moic=moic.quantize(Decimal("0.001")) if moic else None,
    )
