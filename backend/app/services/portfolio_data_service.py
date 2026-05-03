"""Portfolio Data Service (V4 fase 9 — Sprint 2).

Helper centralizado para pull de datos del portafolio que alimenta:
- Informes LP (narrativas + métricas)
- Vista pública /informe/{token} (live_data)
- Sección Outlook con próximos hitos (cross-empresa)

Diseño: funciones puras que devuelven dicts serializables (no ORM
objects). Para que el caller pueda meterlos directo en JSON o a un
prompt de AI sin más procesamiento.

Performance: cada función hace 1-2 queries simples. No uses esto en
loops (N+1) — si necesitas batch, agrega una variante batch.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import and_, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.empresa import Empresa
from app.models.lp import Lp
from app.models.proyecto import Hito, ProyectoEmpresa


# ---------------------------------------------------------------------------
# KPIs cross-portfolio
# ---------------------------------------------------------------------------


async def pull_portfolio_kpis(db: AsyncSession) -> dict[str, Any]:
    """KPIs agregados cross-empresa para hero del informe LP.

    Output:
        {
            "aum_total_clp": 1200000000,
            "empresas_count": 9,
            "empresas_con_actividad": 5,
            "proyectos_total": 46,
            "proyectos_en_progreso": 32,
            "proyectos_completados": 4,
            "hitos_total": 2894,
            "hitos_completados": 856,
            "pct_avance_global": 30,
        }

    Si `core.empresas_kpis` (vista materializada) no existe en el ambiente,
    devuelve los campos como `None` con `_warning` en el dict.
    """
    out: dict[str, Any] = {}

    # AUM consolidado — desde la vista materializada (CEO dashboard)
    try:
        aum_row = (
            await db.execute(
                text(
                    """
                    SELECT
                      COALESCE(SUM(saldo_actual), 0) AS aum_total,
                      COUNT(DISTINCT empresa_codigo) AS empresas_count
                    FROM core.empresas_kpis
                    WHERE saldo_actual IS NOT NULL
                    """
                )
            )
        ).mappings().first()
        if aum_row:
            out["aum_total_clp"] = float(aum_row["aum_total"] or 0)
            out["empresas_count"] = int(aum_row["empresas_count"] or 0)
    except Exception:  # noqa: BLE001
        out["aum_total_clp"] = None
        out["empresas_count"] = None
        out["_warning_aum"] = "Vista core.empresas_kpis no disponible"

    # Total empresas en el catálogo (siempre disponible)
    total_empresas = (
        await db.scalar(select(func.count(Empresa.empresa_id)))
    ) or 0
    out["empresas_total_catalogo"] = int(total_empresas)

    # Proyectos + hitos agregados
    proyectos_stats = (
        await db.execute(
            select(
                func.count(ProyectoEmpresa.proyecto_id).label("total"),
                func.sum(
                    func.cast(
                        ProyectoEmpresa.estado == "en_progreso", func.INTEGER  # noqa
                    )
                ).label("en_progreso"),
                func.sum(
                    func.cast(
                        ProyectoEmpresa.estado == "completado", func.INTEGER
                    )
                ).label("completados"),
                func.count(func.distinct(ProyectoEmpresa.empresa_codigo)).label(
                    "empresas_activas"
                ),
            )
        )
    ).mappings().first()
    if proyectos_stats:
        out["proyectos_total"] = int(proyectos_stats["total"] or 0)
        out["proyectos_en_progreso"] = int(proyectos_stats["en_progreso"] or 0)
        out["proyectos_completados"] = int(proyectos_stats["completados"] or 0)
        out["empresas_con_actividad"] = int(proyectos_stats["empresas_activas"] or 0)

    hitos_stats = (
        await db.execute(
            select(
                func.count(Hito.hito_id).label("total"),
                func.sum(
                    func.cast(Hito.estado == "completado", func.INTEGER)
                ).label("completados"),
            )
        )
    ).mappings().first()
    if hitos_stats:
        total_hitos = int(hitos_stats["total"] or 0)
        completados_hitos = int(hitos_stats["completados"] or 0)
        out["hitos_total"] = total_hitos
        out["hitos_completados"] = completados_hitos
        out["pct_avance_global"] = (
            round((completados_hitos / total_hitos) * 100)
            if total_hitos > 0
            else 0
        )

    return out


# ---------------------------------------------------------------------------
# Por empresa: storytelling data
# ---------------------------------------------------------------------------


async def pull_empresa_data(
    db: AsyncSession, empresa_codigo: str
) -> dict[str, Any]:
    """Datos consolidados de UNA empresa para EmpresaShowcase del informe.

    Output:
        {
            "codigo": "RHO",
            "razon_social": "Rho Generación SpA",
            "rut": "77.931.386-7",
            "proyectos": [
                {"codigo": "RHO0001", "nombre": "Panimávida", "progreso_pct": 25, "estado": "en_progreso"},
                ...
            ],
            "metricas": {
                "proyectos_count": 12,
                "proyectos_en_progreso": 8,
                "hitos_total": 1434,
                "hitos_completados": 280,
                "pct_avance": 19,
            },
            "encargado_top": "Javier Álvarez",
            "ultimo_hito_completado": {
                "nombre": "...",
                "fecha": "2026-04-23",
                "proyecto": "RHO0001 Panimávida"
            }
        }
    """
    empresa = (
        await db.scalars(
            select(Empresa).where(Empresa.codigo == empresa_codigo).limit(1)
        )
    ).first()
    if empresa is None:
        return {"_error": f"Empresa {empresa_codigo} no encontrada"}

    out: dict[str, Any] = {
        "codigo": empresa.codigo,
        "razon_social": empresa.razon_social,
        "rut": empresa.rut,
    }

    # Proyectos de la empresa
    proyectos = list(
        (
            await db.scalars(
                select(ProyectoEmpresa)
                .where(ProyectoEmpresa.empresa_codigo == empresa_codigo)
                .order_by(ProyectoEmpresa.created_at.desc())
            )
        ).all()
    )
    out["proyectos"] = [
        {
            "proyecto_id": p.proyecto_id,
            "codigo": (p.metadata_ or {}).get("codigo_excel") or str(p.proyecto_id),
            "nombre": p.nombre,
            "estado": p.estado,
            "progreso_pct": p.progreso_pct,
            "fecha_inicio": p.fecha_inicio.isoformat() if p.fecha_inicio else None,
            "fecha_fin_estimada": (
                p.fecha_fin_estimada.isoformat() if p.fecha_fin_estimada else None
            ),
        }
        for p in proyectos
    ]

    # Métricas agregadas
    proyecto_ids = [p.proyecto_id for p in proyectos]
    if proyecto_ids:
        hitos_stats = (
            await db.execute(
                select(
                    func.count(Hito.hito_id).label("total"),
                    func.sum(
                        func.cast(Hito.estado == "completado", func.INTEGER)
                    ).label("completados"),
                ).where(Hito.proyecto_id.in_(proyecto_ids))
            )
        ).mappings().first()
        total_hitos = int(hitos_stats["total"] or 0) if hitos_stats else 0
        completados = int(hitos_stats["completados"] or 0) if hitos_stats else 0
        out["metricas"] = {
            "proyectos_count": len(proyectos),
            "proyectos_en_progreso": sum(1 for p in proyectos if p.estado == "en_progreso"),
            "proyectos_completados": sum(1 for p in proyectos if p.estado == "completado"),
            "hitos_total": total_hitos,
            "hitos_completados": completados,
            "pct_avance": (
                round((completados / total_hitos) * 100) if total_hitos > 0 else 0
            ),
        }

        # Encargado más recurrente
        encargado_top = (
            await db.execute(
                select(Hito.encargado, func.count(Hito.hito_id).label("c"))
                .where(Hito.proyecto_id.in_(proyecto_ids))
                .where(Hito.encargado.isnot(None))
                .group_by(Hito.encargado)
                .order_by(func.count(Hito.hito_id).desc())
                .limit(1)
            )
        ).first()
        out["encargado_top"] = encargado_top[0] if encargado_top else None

        # Último hito completado (storytelling — "X completó Y la semana pasada")
        ultimo = (
            await db.execute(
                select(Hito, ProyectoEmpresa.nombre)
                .join(
                    ProyectoEmpresa,
                    Hito.proyecto_id == ProyectoEmpresa.proyecto_id,
                )
                .where(Hito.proyecto_id.in_(proyecto_ids))
                .where(Hito.estado == "completado")
                .where(Hito.fecha_completado.isnot(None))
                .order_by(Hito.fecha_completado.desc())
                .limit(1)
            )
        ).first()
        if ultimo:
            hito, proyecto_nombre = ultimo
            out["ultimo_hito_completado"] = {
                "nombre": hito.nombre,
                "fecha": (
                    hito.fecha_completado.isoformat()
                    if hito.fecha_completado
                    else None
                ),
                "proyecto": proyecto_nombre,
                "encargado": hito.encargado,
            }
    else:
        out["metricas"] = {
            "proyectos_count": 0,
            "proyectos_en_progreso": 0,
            "proyectos_completados": 0,
            "hitos_total": 0,
            "hitos_completados": 0,
            "pct_avance": 0,
        }

    return out


# ---------------------------------------------------------------------------
# ESG Impact estimado
# ---------------------------------------------------------------------------


# Factor de emisión grid Chile 2024 ≈ 0.40 ton CO2 / MWh (CDE)
_FACTOR_EMISION_CL = 0.40
# Equivalentes IPCC: 1 ton CO2 ≈ 0.21 autos/año (4.6 ton/auto promedio)
_TON_CO2_POR_AUTO_AÑO = 4.6


def estimar_esg_impact(
    mw_renovables_instalados: float | None = None,
    mwh_anuales_estimados: float | None = None,
) -> dict[str, Any]:
    """Calcula equivalentes ESG concretos para sección ESG del informe.

    Si tenés MW instalados pero no MWh anuales, asume factor de planta
    25% para solar fotovoltaico (conservador).

    Output:
        {
            "mw_instalados": 12.5,
            "mwh_anuales": 27375,
            "co2_evitado_ton_año": 10950,
            "autos_equivalentes_año": 2380,
            "hogares_chilenos_equivalentes": 9125,
            "_assumptions": {...}
        }

    Si no hay inputs, devuelve None para todos los campos.
    """
    if mw_renovables_instalados is None and mwh_anuales_estimados is None:
        return {
            "mw_instalados": None,
            "mwh_anuales": None,
            "co2_evitado_ton_año": None,
            "autos_equivalentes_año": None,
            "hogares_chilenos_equivalentes": None,
            "_warning": "Sin datos de capacidad instalada para calcular ESG",
        }

    # Si solo tenés MW, estimar MWh con factor de planta 25%
    if mwh_anuales_estimados is None and mw_renovables_instalados is not None:
        mwh_anuales_estimados = mw_renovables_instalados * 8760 * 0.25

    co2_evitado = (mwh_anuales_estimados or 0) * _FACTOR_EMISION_CL
    autos = co2_evitado / _TON_CO2_POR_AUTO_AÑO if co2_evitado > 0 else 0
    # Consumo promedio hogar CL ≈ 3000 kWh/año = 3 MWh
    hogares = (mwh_anuales_estimados or 0) / 3.0 if mwh_anuales_estimados else 0

    return {
        "mw_instalados": mw_renovables_instalados,
        "mwh_anuales": int(mwh_anuales_estimados) if mwh_anuales_estimados else None,
        "co2_evitado_ton_año": int(co2_evitado),
        "autos_equivalentes_año": int(autos),
        "hogares_chilenos_equivalentes": int(hogares),
        "_assumptions": {
            "factor_planta_default": 0.25,
            "factor_emision_grid_cl": _FACTOR_EMISION_CL,
            "ton_co2_por_auto_año": _TON_CO2_POR_AUTO_AÑO,
            "consumo_hogar_mwh_año": 3.0,
        },
    }


# ---------------------------------------------------------------------------
# Hitos próximos para sección Outlook
# ---------------------------------------------------------------------------


async def pull_hitos_proximos(
    db: AsyncSession,
    horizonte_dias: int = 180,
    limite: int = 10,
    empresa_codigos: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Hitos próximos relevantes para sección Outlook del informe.

    Output: lista de hasta `limite` hitos ordenados por fecha ascendente.
        [
            {
                "hito_id": 123,
                "nombre": "Cierre BESS Codegua",
                "fecha_planificada": "2026-05-20",
                "proyecto": "RHO0003 Codegua",
                "empresa_codigo": "RHO",
                "encargado": "Javier Álvarez",
                "dias_hasta": 17
            },
            ...
        ]
    """
    hoy = date.today()
    fin = hoy + timedelta(days=horizonte_dias)

    q = (
        select(Hito, ProyectoEmpresa)
        .join(ProyectoEmpresa, Hito.proyecto_id == ProyectoEmpresa.proyecto_id)
        .where(Hito.estado.in_(["pendiente", "en_progreso"]))
        .where(Hito.fecha_planificada.isnot(None))
        .where(Hito.fecha_planificada >= hoy)
        .where(Hito.fecha_planificada <= fin)
        .order_by(Hito.fecha_planificada.asc())
        .limit(limite)
    )
    if empresa_codigos:
        q = q.where(ProyectoEmpresa.empresa_codigo.in_(empresa_codigos))

    rows = (await db.execute(q)).all()
    out: list[dict[str, Any]] = []
    for hito, proyecto in rows:
        dias_hasta = (
            (hito.fecha_planificada - hoy).days if hito.fecha_planificada else 0
        )
        out.append(
            {
                "hito_id": hito.hito_id,
                "nombre": hito.nombre,
                "fecha_planificada": (
                    hito.fecha_planificada.isoformat()
                    if hito.fecha_planificada
                    else None
                ),
                "proyecto": proyecto.nombre,
                "empresa_codigo": proyecto.empresa_codigo,
                "encargado": hito.encargado,
                "dias_hasta": dias_hasta,
                "progreso_pct": hito.progreso_pct,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Live data del LP destinatario (para personalización)
# ---------------------------------------------------------------------------


async def pull_lp_context(
    db: AsyncSession, lp_id: int
) -> dict[str, Any] | None:
    """Datos del LP destinatario del informe para personalización."""
    lp = await db.scalar(select(Lp).where(Lp.lp_id == lp_id).limit(1))
    if lp is None:
        return None

    return {
        "nombre": lp.nombre,
        "apellido": lp.apellido,
        "nombre_completo": (
            (lp.nombre + (f" {lp.apellido}" if lp.apellido else "")).strip()
        ),
        "email": lp.email,
        "empresa": lp.empresa,
        "rol": lp.rol,
        "perfil_inversor": lp.perfil_inversor,
        "intereses": lp.intereses or [],
        "aporte_total_clp": (
            float(lp.aporte_total) if lp.aporte_total else None
        ),
        "aporte_actual_clp": (
            float(lp.aporte_actual) if lp.aporte_actual else None
        ),
        "empresas_invertidas": list(lp.empresas_invertidas or []),
        "estado": lp.estado,
    }


# ---------------------------------------------------------------------------
# Live data agregado para vista pública (lo que ve el LP al abrir el informe)
# ---------------------------------------------------------------------------


async def build_live_data(
    db: AsyncSession,
    *,
    lp_id: int | None = None,
    empresas_destacadas: list[str] | None = None,
    horizonte_outlook_dias: int = 180,
) -> dict[str, Any]:
    """Construye el dict `live_data` que se inyecta en /informe/{token}.

    Llama a todas las funciones de pull anteriores en paralelo lógico
    (cada una es 1-2 queries) y devuelve el bundle completo para que
    el frontend renderice secciones con números reales al momento.

    Performance: ~150-300ms total contra Postgres en producción.
    """
    out: dict[str, Any] = {
        "generated_at": datetime.utcnow().isoformat(),
        "lp": None,
        "portfolio_kpis": {},
        "empresas": {},
        "hitos_proximos": [],
        "esg_impact": {},
    }

    if lp_id is not None:
        out["lp"] = await pull_lp_context(db, lp_id)

    out["portfolio_kpis"] = await pull_portfolio_kpis(db)

    # Pull data por empresa destacada
    if empresas_destacadas:
        for cod in empresas_destacadas:
            try:
                out["empresas"][cod] = await pull_empresa_data(db, cod)
            except Exception as e:  # noqa: BLE001
                out["empresas"][cod] = {"_error": str(e)}

    # Hitos próximos
    out["hitos_proximos"] = await pull_hitos_proximos(
        db,
        horizonte_dias=horizonte_outlook_dias,
        limite=10,
        empresa_codigos=empresas_destacadas,
    )

    # ESG: por ahora sin MW reales (placeholder hasta que el KB los tenga).
    # Sprint 2.5 va a leer del KB markdown los MW confirmados por empresa.
    out["esg_impact"] = estimar_esg_impact()

    return out
