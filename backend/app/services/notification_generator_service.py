"""Generador de alertas in-app (V3 fase 8).

Crea filas en `app.notifications` para los eventos operativos del
reglamento Cehta:

  * **F29 due**: F29 con `fecha_vencimiento` en próximos 7 días y
    `estado != 'pagado'`.
  * **Contrato due**: documento legal categoría `trabajadores` con
    `fecha_vigencia_hasta` en próximos 30 días.
  * **OC pending**: orden de compra con estado `emitida` (no pagada,
    no anulada) y `fecha_emision` mayor a 7 días atrás.

Idempotencia: antes de insertar, consulta si ya existe una alerta para
`(user_id, entity_type, entity_id, tipo)` en las últimas 24h. Si sí,
skip.

Recipients: las alertas se crean para todos los usuarios con rol
`admin` o `finance` (lectores operativos). `viewer` no recibe alertas.

Notas:
  - Se asume que F29.estado canónico es 'pagado' (no 'pagada'); los
    valores de OC son `emitida/pagada/anulada/parcial`. Cualquier OC
    no pagada/anulada y vieja entra como pending.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.infrastructure.repositories.notification_repository import (
    NotificationRepository,
)
from app.schemas.notification import GenerateAlertsReport
from app.services.event_broadcaster import get_broadcaster

log = get_logger(__name__)


class NotificationGeneratorService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = NotificationRepository(session)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _operational_user_ids(self) -> list[str]:
        """Lista user_ids con rol admin o finance (recipients de alertas)."""
        result = await self._session.execute(
            text(
                """
                SELECT user_id::text AS user_id
                FROM core.user_roles
                WHERE app_role IN ('admin', 'finance')
                """
            )
        )
        return [row[0] for row in result.all()]

    async def _create_idempotent(
        self,
        *,
        user_ids: list[str],
        tipo: str,
        title: str,
        body: str,
        severity: str,
        link: str | None,
        entity_type: str,
        entity_id: str,
    ) -> int:
        """Crea una alerta por user_id, salta los que ya tienen una en 24h."""
        created = 0
        for uid in user_ids:
            existing = await self._repo.find_recent_for_idempotency(
                user_id=uid,
                tipo=tipo,
                entity_type=entity_type,
                entity_id=entity_id,
            )
            if existing:
                continue
            notif = await self._repo.create(
                user_id=uid,
                tipo=tipo,
                title=title,
                body=body,
                severity=severity,
                link=link,
                entity_type=entity_type,
                entity_id=entity_id,
            )
            created += 1
            # Real-time push (V4 fase 2). Soft-fail: el broadcaster nunca
            # debería raisear, pero envolvemos defensivamente igual — la
            # alerta ya quedó persistida, no queremos romper la corrida
            # entera por un fallo del fanout in-memory.
            try:
                await get_broadcaster().publish(
                    "notification.created",
                    {
                        "id": str(notif.id),
                        "user_id": uid,
                        "tipo": tipo,
                        "severity": severity,
                        "title": title,
                        "body": body,
                        "link": link,
                        "entity_type": entity_type,
                        "entity_id": entity_id,
                    },
                    user_id=uid,
                )
            except Exception as exc:  # pragma: no cover — defensivo
                log.warning("sse_publish_notification_failed", error=str(exc))
        return created

    # ------------------------------------------------------------------
    # Generators
    # ------------------------------------------------------------------

    async def generate_f29_due_alerts(self) -> int:
        """F29 que vencen en los próximos 7 días y no están pagados."""
        today = date.today()
        horizon = today + timedelta(days=7)
        user_ids = await self._operational_user_ids()
        if not user_ids:
            return 0

        rows = (
            await self._session.execute(
                text(
                    """
                    SELECT
                        f29_id::text       AS f29_id,
                        empresa_codigo,
                        periodo_tributario,
                        fecha_vencimiento,
                        estado
                    FROM core.f29_obligaciones
                    WHERE fecha_vencimiento BETWEEN :today AND :horizon
                      AND estado <> 'pagado'
                    """
                ),
                {"today": today, "horizon": horizon},
            )
        ).mappings().all()

        total = 0
        for r in rows:
            dias = (r["fecha_vencimiento"] - today).days
            severity = "critical" if dias <= 2 else "warning"
            title = (
                f"F29 {r['empresa_codigo']} {r['periodo_tributario']} "
                f"vence en {dias} día{'s' if dias != 1 else ''}"
            )
            body = (
                f"La F29 de {r['empresa_codigo']} (periodo "
                f"{r['periodo_tributario']}) vence el "
                f"{r['fecha_vencimiento'].isoformat()} y aún no está pagada."
            )
            link = f"/f29?empresa_codigo={r['empresa_codigo']}"
            total += await self._create_idempotent(
                user_ids=user_ids,
                tipo="f29_due",
                title=title,
                body=body,
                severity=severity,
                link=link,
                entity_type="f29",
                entity_id=str(r["f29_id"]),
            )
        return total

    async def generate_contrato_due_alerts(self) -> int:
        """Contratos de trabajadores con vigencia hasta en próximos 30 días."""
        today = date.today()
        horizon = today + timedelta(days=30)
        user_ids = await self._operational_user_ids()
        if not user_ids:
            return 0

        rows = (
            await self._session.execute(
                text(
                    """
                    SELECT
                        documento_id::text        AS documento_id,
                        empresa_codigo,
                        nombre,
                        contraparte,
                        fecha_vigencia_hasta
                    FROM core.legal_documents
                    WHERE categoria = 'trabajadores'
                      AND fecha_vigencia_hasta BETWEEN :today AND :horizon
                    """
                ),
                {"today": today, "horizon": horizon},
            )
        ).mappings().all()

        total = 0
        for r in rows:
            dias = (r["fecha_vigencia_hasta"] - today).days
            severity = "critical" if dias <= 7 else "warning"
            title = (
                f"Contrato {r['empresa_codigo']} — {r['nombre']} "
                f"vence en {dias} día{'s' if dias != 1 else ''}"
            )
            body = (
                f"El contrato '{r['nombre']}' "
                f"({r.get('contraparte') or 'sin contraparte'}) de "
                f"{r['empresa_codigo']} vence el "
                f"{r['fecha_vigencia_hasta'].isoformat()}."
            )
            link = (
                f"/empresa/{r['empresa_codigo']}/legal/{r['documento_id']}"
            )
            total += await self._create_idempotent(
                user_ids=user_ids,
                tipo="contrato_due",
                title=title,
                body=body,
                severity=severity,
                link=link,
                entity_type="legal_document",
                entity_id=str(r["documento_id"]),
            )
        return total

    async def generate_oc_pending_alerts(self) -> int:
        """OCs en estado 'emitida' por más de 7 días — pendientes de pago."""
        threshold = date.today() - timedelta(days=7)
        user_ids = await self._operational_user_ids()
        if not user_ids:
            return 0

        rows = (
            await self._session.execute(
                text(
                    """
                    SELECT
                        oc_id::text       AS oc_id,
                        numero_oc,
                        empresa_codigo,
                        fecha_emision,
                        total
                    FROM core.ordenes_compra
                    WHERE estado = 'emitida'
                      AND fecha_emision <= :threshold
                    """
                ),
                {"threshold": threshold},
            )
        ).mappings().all()

        total = 0
        for r in rows:
            dias = (date.today() - r["fecha_emision"]).days
            severity = "warning" if dias < 30 else "critical"
            title = (
                f"OC {r['numero_oc']} ({r['empresa_codigo']}) pendiente "
                f"hace {dias} días"
            )
            body = (
                f"La orden de compra {r['numero_oc']} de "
                f"{r['empresa_codigo']} fue emitida el "
                f"{r['fecha_emision'].isoformat()} y sigue sin pagarse."
            )
            link = f"/ordenes-compra/{r['oc_id']}"
            total += await self._create_idempotent(
                user_ids=user_ids,
                tipo="oc_pending",
                title=title,
                body=body,
                severity=severity,
                link=link,
                entity_type="orden_compra",
                entity_id=str(r["oc_id"]),
            )
        return total

    async def generate_entregable_due_alerts(self) -> int:
        """V4 fase 6: alertas para entregables regulatorios FIP CEHTA ESG.

        Criterio: estado != 'entregado' AND fecha_limite en próximos 7 días
        AND alerta_5 = true. Severity:
          - critical si vencido / vence hoy / ≤3 días
          - warning si ≤7 días

        Recipients: admin + finance (compliance es responsabilidad de
        ambos roles operativos).
        """
        rows = await self._session.execute(
            text(
                """
                SELECT entregable_id, nombre, categoria, fecha_limite,
                       periodo, prioridad,
                       (fecha_limite - CURRENT_DATE) AS dias
                FROM app.entregables_regulatorios
                WHERE estado IN ('pendiente', 'en_proceso')
                  AND fecha_limite >= (CURRENT_DATE - INTERVAL '3 days')
                  AND fecha_limite <= (CURRENT_DATE + INTERVAL '7 days')
                  AND alerta_5 = TRUE
                ORDER BY fecha_limite ASC
                """
            )
        )
        items = rows.mappings().all()
        if not items:
            return 0

        user_ids = await self._operational_user_ids()
        if not user_ids:
            return 0

        total = 0
        for it in items:
            dias = it["dias"]
            severity = (
                "critical" if dias <= 3 else "warning"
            )
            if dias < 0:
                title = f"⚠️ Entregable VENCIDO: {it['nombre']}"
                body = (
                    f"Vencido hace {abs(dias)}d · {it['categoria']} · "
                    f"período {it['periodo']}. Marcar como entregado o "
                    f"justificar."
                )
            elif dias == 0:
                title = f"🔴 Vence HOY: {it['nombre']}"
                body = (
                    f"{it['categoria']} · período {it['periodo']}. Acción "
                    f"inmediata requerida."
                )
            else:
                title = f"⏰ Entregable en {dias}d: {it['nombre']}"
                body = (
                    f"{it['categoria']} · período {it['periodo']}. Vence el "
                    f"{it['fecha_limite'].isoformat()}."
                )

            count = await self._create_idempotent(
                user_ids=user_ids,
                tipo="entregable_due",
                title=title,
                body=body,
                severity=severity,
                link=f"/entregables?focus={it['entregable_id']}",
                entity_type="entregable",
                entity_id=str(it["entregable_id"]),
            )
            total += count
        return total

    async def run_all(self) -> GenerateAlertsReport:
        """Ejecuta todos los generadores y devuelve un report con counts."""
        report = GenerateAlertsReport()
        try:
            report.f29_due = await self.generate_f29_due_alerts()
        except Exception as exc:
            report.errores.append(f"f29_due: {exc}")
            log.error("f29_due_failed", error=str(exc))
        try:
            report.contrato_due = await self.generate_contrato_due_alerts()
        except Exception as exc:
            report.errores.append(f"contrato_due: {exc}")
            log.error("contrato_due_failed", error=str(exc))
        try:
            report.oc_pending = await self.generate_oc_pending_alerts()
        except Exception as exc:
            report.errores.append(f"oc_pending: {exc}")
            log.error("oc_pending_failed", error=str(exc))
        try:
            report.entregable_due = await self.generate_entregable_due_alerts()
        except Exception as exc:
            report.errores.append(f"entregable_due: {exc}")
            log.error("entregable_due_failed", error=str(exc))
        report.total = (
            report.f29_due
            + report.contrato_due
            + report.oc_pending
            + report.entregable_due
        )
        return report


# Helper module-level functions (para imports más cómodos en tests/cron).


async def generate_f29_due_alerts(db: AsyncSession) -> int:
    return await NotificationGeneratorService(db).generate_f29_due_alerts()


async def generate_contrato_due_alerts(db: AsyncSession) -> int:
    return await NotificationGeneratorService(db).generate_contrato_due_alerts()


async def generate_oc_pending_alerts(db: AsyncSession) -> int:
    return await NotificationGeneratorService(db).generate_oc_pending_alerts()


async def run_all(db: AsyncSession) -> dict[str, int]:
    report = await NotificationGeneratorService(db).run_all()
    return {
        "f29_due": report.f29_due,
        "contrato_due": report.contrato_due,
        "oc_pending": report.oc_pending,
        "total": report.total,
    }


# Re-export for type-only imports in tests.
__all__ = [
    "NotificationGeneratorService",
    "generate_contrato_due_alerts",
    "generate_f29_due_alerts",
    "generate_oc_pending_alerts",
    "run_all",
]


