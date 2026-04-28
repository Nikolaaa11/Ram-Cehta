"""Agentes que generan eventos automáticos en el calendario.

Se invocan via cron (V3 fase 5 manual via scheduled scripts) o pueden
correr ad-hoc desde admin. Los agentes son idempotentes — si el evento
ya existe (mismo tipo + empresa + día), no lo duplican.

Agentes V3 fase 5:
    - generate_f29_events: F29 mensual vence día 12. Crea evento aviso
      3 días antes (día 9) por cada empresa.
    - generate_monthly_report_events: día 1 de cada mes, evento "Generar
      Reporte LP" para vencer día 5 del mismo mes.
    - run_all_agents: corre todos y devuelve summary.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.infrastructure.repositories.calendar_repository import (
    CalendarRepository,
)
from app.models.empresa import Empresa
from app.schemas.calendar import AgentRunReport, CalendarEventCreate

log = get_logger(__name__)


class CalendarAgentsService:
    """Servicio de agentes que crean calendar_events automáticos."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = CalendarRepository(session)

    async def _list_empresas_activas(self) -> list[Empresa]:
        q = select(Empresa).where(Empresa.activo.is_(True))
        return list((await self._session.scalars(q)).all())

    async def generate_f29_events(
        self, empresa_codigo: str | None = None
    ) -> int:
        """Para cada empresa con F29 mensual, crea evento aviso 3 días antes.

        Política V3 fase 5 (manual scheduled): generamos para el mes actual
        y el próximo. Idempotente: si ya existe el evento (mismo tipo,
        empresa, día) no lo duplica.
        """
        today = date.today()
        target_months = [
            (today.year, today.month),
            _next_month(today.year, today.month),
        ]

        empresas = (
            [e for e in await self._list_empresas_activas() if e.codigo == empresa_codigo]
            if empresa_codigo
            else await self._list_empresas_activas()
        )

        created = 0
        for empresa in empresas:
            for year, month in target_months:
                vence = date(year, month, 12)
                aviso = vence - timedelta(days=3)
                if aviso < today:
                    continue
                aviso_dt = datetime.combine(aviso, datetime.min.time(), tzinfo=timezone.utc)
                existing = await self._repo.find_existing(
                    tipo="f29",
                    empresa_codigo=empresa.codigo,
                    fecha=aviso_dt,
                )
                if existing:
                    continue
                await self._repo.create(
                    CalendarEventCreate(
                        titulo=f"F29 {empresa.codigo} — vence {vence.isoformat()}",
                        descripcion=(
                            f"Recordatorio: F29 de {empresa.razon_social} "
                            f"vence el {vence.isoformat()}. Preparar borrador."
                        ),
                        tipo="f29",
                        empresa_codigo=empresa.codigo,
                        fecha_inicio=aviso_dt,
                        todo_el_dia=True,
                        notificar_dias_antes=0,
                        recurrencia="mensual_dia_9",
                    ),
                    auto_generado=True,
                )
                created += 1

        return created

    async def generate_monthly_report_events(self) -> int:
        """Crea evento 'Generar Reporte LP' día 1 (vence día 5) del mes.

        Va a nivel global (sin empresa_codigo) — un solo reporte mensual
        consolidado por la administradora.
        """
        today = date.today()
        target_months = [
            (today.year, today.month),
            _next_month(today.year, today.month),
        ]

        created = 0
        for year, month in target_months:
            entrega = date(year, month, 5)
            if entrega < today:
                continue
            aviso = date(year, month, 1)
            aviso_dt = datetime.combine(aviso, datetime.min.time(), tzinfo=timezone.utc)
            existing = await self._repo.find_existing(
                tipo="reporte_lp",
                empresa_codigo=None,
                fecha=aviso_dt,
            )
            if existing:
                continue
            await self._repo.create(
                CalendarEventCreate(
                    titulo=f"Reporte mensual LP — entregar {entrega.isoformat()}",
                    descripcion=(
                        "Compilar reporte mensual a LPs (estado de fondo, "
                        "composición, KPIs). Plantilla en Dropbox/Cehta Capital/"
                        "Inteligencia de Negocios/Templates/."
                    ),
                    tipo="reporte_lp",
                    empresa_codigo=None,
                    fecha_inicio=aviso_dt,
                    todo_el_dia=True,
                    notificar_dias_antes=0,
                    recurrencia="mensual_dia_1",
                ),
                auto_generado=True,
            )
            created += 1

        return created

    async def run_all_agents(self) -> AgentRunReport:
        """Ejecuta todos los agentes, devuelve summary con counts."""
        report = AgentRunReport()
        try:
            report.f29_eventos_creados = await self.generate_f29_events()
        except Exception as exc:  # noqa: BLE001 — capture-and-report intencional
            report.errores.append(f"f29_agent: {exc}")
            log.error("f29_agent_failed", error=str(exc))
        try:
            report.reporte_lp_eventos_creados = (
                await self.generate_monthly_report_events()
            )
        except Exception as exc:  # noqa: BLE001
            report.errores.append(f"reporte_lp_agent: {exc}")
            log.error("reporte_lp_agent_failed", error=str(exc))
        report.total_creados = (
            report.f29_eventos_creados + report.reporte_lp_eventos_creados
        )
        return report


def _next_month(year: int, month: int) -> tuple[int, int]:
    if month == 12:
        return year + 1, 1
    return year, month + 1
