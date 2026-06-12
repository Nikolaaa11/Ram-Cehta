"""Repository para `app.notifications` (V3 fase 8 — Inbox in-app).

Queries siempre filtradas por `user_id` (privacy + RLS). El generator de
alertas usa `find_recent_for_idempotency` para no duplicar alertas en
ventana de 24h.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification


class NotificationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_for_user(
        self,
        user_id: str,
        *,
        only_unread: bool = False,
        page: int = 1,
        size: int = 20,
    ) -> tuple[list[Notification], int]:
        conditions = [Notification.user_id == user_id]
        if only_unread:
            conditions.append(Notification.read_at.is_(None))

        # R152OOOOOO — COUNT(*) OVER() en la misma query: antes eran 2
        # round-trips (count + página). El inbox se consulta en cada
        # navegación, así que el ahorro (~40-60ms) se siente.
        q = (
            select(Notification, func.count().over().label("_total"))
            .where(and_(*conditions))
            .order_by(Notification.created_at.desc())
            .limit(size)
            .offset((page - 1) * size)
        )
        rows = (await self._session.execute(q)).all()
        total = rows[0]._total if rows else 0
        items = [r.Notification for r in rows]
        if not rows and page > 1:
            # Página fuera de rango (raro): fallback al count clásico.
            count_q = (
                select(func.count()).select_from(Notification).where(and_(*conditions))
            )
            total = (await self._session.scalar(count_q)) or 0
        return items, int(total)

    async def unread_count(self, user_id: str) -> int:
        q = (
            select(func.count())
            .select_from(Notification)
            .where(
                and_(
                    Notification.user_id == user_id,
                    Notification.read_at.is_(None),
                )
            )
        )
        return int((await self._session.scalar(q)) or 0)

    async def mark_read(self, notification_id: str, user_id: str) -> Notification | None:
        """Marca leída si pertenece al user. Devuelve None si no existe / no es suya."""
        q = select(Notification).where(
            and_(Notification.id == notification_id, Notification.user_id == user_id)
        )
        notif = (await self._session.scalars(q)).first()
        if notif is None:
            return None
        if notif.read_at is None:
            notif.read_at = datetime.now(UTC)
            await self._session.flush()
            await self._session.refresh(notif)
        return notif

    async def mark_all_read(self, user_id: str) -> int:
        now = datetime.now(UTC)
        stmt = (
            update(Notification)
            .where(
                and_(
                    Notification.user_id == user_id,
                    Notification.read_at.is_(None),
                )
            )
            .values(read_at=now)
        )
        result = await self._session.execute(stmt)
        return int(getattr(result, "rowcount", 0) or 0)

    async def resolve_stale(
        self, *, tipo: str, vigentes_entity_ids: set[str]
    ) -> int:
        """R152GGGGGG — Auto-resuelve alertas zombie.

        Marca como leídas (read_at=now) las notificaciones de un `tipo` cuyo
        `entity_id` YA NO está en el set de entidades vigentes. Ejemplo: una
        alerta "F29 due" cuyo F29 ya pasó a 'pagado' deja de estar vigente —
        se marca leída para que desaparezca de la inbox/bell del user.

        Llamar desde cada generador tras computar las filas vigentes.
        Devuelve cantidad de notifs resueltas.
        """
        now = datetime.now(UTC)
        conditions = [
            Notification.tipo == tipo,
            Notification.read_at.is_(None),
        ]
        # Solo las que tienen entity_id y NO están vigentes.
        if vigentes_entity_ids:
            conditions.append(
                Notification.entity_id.notin_(list(vigentes_entity_ids))
            )
        # Si vigentes está vacío → todas las del tipo son stale.
        conditions.append(Notification.entity_id.is_not(None))

        stmt = (
            update(Notification)
            .where(and_(*conditions))
            .values(read_at=now)
        )
        result = await self._session.execute(stmt)
        return int(getattr(result, "rowcount", 0) or 0)

    async def create(
        self,
        *,
        user_id: str,
        tipo: str,
        title: str,
        body: str = "",
        severity: str = "info",
        link: str | None = None,
        entity_type: str | None = None,
        entity_id: str | None = None,
    ) -> Notification:
        notif = Notification(
            user_id=user_id,
            tipo=tipo,
            severity=severity,
            title=title,
            body=body,
            link=link,
            entity_type=entity_type,
            entity_id=entity_id,
        )
        self._session.add(notif)
        await self._session.flush()
        await self._session.refresh(notif)
        return notif

    async def bulk_create_for_users(
        self,
        user_ids: list[str],
        *,
        tipo: str,
        title: str,
        body: str = "",
        severity: str = "info",
        link: str | None = None,
        entity_type: str | None = None,
        entity_id: str | None = None,
    ) -> list[Notification]:
        notifs = [
            Notification(
                user_id=uid,
                tipo=tipo,
                severity=severity,
                title=title,
                body=body,
                link=link,
                entity_type=entity_type,
                entity_id=entity_id,
            )
            for uid in user_ids
        ]
        if not notifs:
            return []
        self._session.add_all(notifs)
        await self._session.flush()
        for n in notifs:
            await self._session.refresh(n)
        return notifs

    async def find_recent_for_idempotency(
        self,
        *,
        user_id: str,
        tipo: str,
        entity_type: str | None,
        entity_id: str | None,
        window_hours: int = 24,
    ) -> Notification | None:
        """Busca alerta existente en ventana reciente para evitar duplicados.

        Empareja por (user_id, tipo, entity_type, entity_id). NULLs en
        entity_type/entity_id matchean NULLs.
        """
        since = datetime.now(UTC) - timedelta(hours=window_hours)
        conditions = [
            Notification.user_id == user_id,
            Notification.tipo == tipo,
            Notification.created_at >= since,
        ]
        if entity_type is None:
            conditions.append(Notification.entity_type.is_(None))
        else:
            conditions.append(Notification.entity_type == entity_type)
        if entity_id is None:
            conditions.append(Notification.entity_id.is_(None))
        else:
            conditions.append(Notification.entity_id == entity_id)

        q = select(Notification).where(and_(*conditions)).limit(1)
        return (await self._session.scalars(q)).first()
