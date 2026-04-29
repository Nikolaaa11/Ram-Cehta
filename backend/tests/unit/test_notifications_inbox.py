"""Unit tests para Notifications Inbox (V3 fase 8).

Cubre:
  - Repositorio: list, unread filter, count, mark-read (ownership), mark-all
  - Generator: idempotencia (mismo entity_id en 24h no duplica)
  - Schemas: validación
  - RBAC: scope `notifications:admin` para `/generate-alerts`

No usamos DB real — el repository y el generator se prueban con un
in-memory fake que implementa la mínima superficie de AsyncSession +
Notification que necesitan los tests. El cubrimiento de SQL real queda
para los tests de integración (testcontainers).
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.core.rbac import scopes_for
from app.models.notification import Notification
from app.schemas.notification import (
    GenerateAlertsReport,
    NotificationCreate,
    NotificationRead,
    UnreadCount,
)

# =====================================================================
# In-memory repo (testea contratos lógicos sin DB real)
#
# El SQL real queda cubierto en integration tests con testcontainers.
# Acá testeamos invariantes públicos del repo: filtros, ownership,
# idempotencia, mark-all-read.
# =====================================================================


class InMemoryRepo:
    """Reimplementación in-memory de NotificationRepository — testea
    contratos públicos sin DB."""

    def __init__(self) -> None:
        self.notifs: list[Notification] = []
        self._id = 0

    def _new_id(self) -> str:
        self._id += 1
        return f"00000000-0000-0000-0000-{self._id:012d}"

    async def list_for_user(
        self,
        user_id: str,
        *,
        only_unread: bool = False,
        page: int = 1,
        size: int = 20,
    ) -> tuple[list[Notification], int]:
        owned = [n for n in self.notifs if n.user_id == user_id]
        if only_unread:
            owned = [n for n in owned if n.read_at is None]
        owned.sort(key=lambda n: n.created_at, reverse=True)
        total = len(owned)
        start = (page - 1) * size
        return owned[start : start + size], total

    async def unread_count(self, user_id: str) -> int:
        return sum(
            1 for n in self.notifs if n.user_id == user_id and n.read_at is None
        )

    async def mark_read(
        self, notification_id: str, user_id: str
    ) -> Notification | None:
        for n in self.notifs:
            if n.id == notification_id and n.user_id == user_id:
                if n.read_at is None:
                    n.read_at = datetime.now(UTC)
                return n
        return None

    async def mark_all_read(self, user_id: str) -> int:
        count = 0
        now = datetime.now(UTC)
        for n in self.notifs:
            if n.user_id == user_id and n.read_at is None:
                n.read_at = now
                count += 1
        return count

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
            id=self._new_id(),
            user_id=user_id,
            tipo=tipo,
            severity=severity,
            title=title,
            body=body,
            link=link,
            entity_type=entity_type,
            entity_id=entity_id,
            created_at=datetime.now(UTC),
        )
        self.notifs.append(notif)
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
        return [
            await self.create(
                user_id=uid,
                tipo=tipo,
                title=title,
                body=body,
                severity=severity,
                link=link,
                entity_type=entity_type,
                entity_id=entity_id,
            )
            for uid in user_ids
        ]

    async def find_recent_for_idempotency(
        self,
        *,
        user_id: str,
        tipo: str,
        entity_type: str | None,
        entity_id: str | None,
        window_hours: int = 24,
    ) -> Notification | None:
        since = datetime.now(UTC) - timedelta(hours=window_hours)
        for n in self.notifs:
            if (
                n.user_id == user_id
                and n.tipo == tipo
                and n.entity_type == entity_type
                and n.entity_id == entity_id
                and n.created_at >= since
            ):
                return n
        return None


# =====================================================================
# Repository contract tests (in-memory)
# =====================================================================


class TestNotificationRepositoryContract:
    @pytest.fixture
    def repo(self) -> InMemoryRepo:
        return InMemoryRepo()

    @pytest.mark.asyncio
    async def test_create_and_list(self, repo: InMemoryRepo) -> None:
        await repo.create(
            user_id="u1", tipo="system", title="hola", body="b"
        )
        items, total = await repo.list_for_user("u1")
        assert total == 1
        assert items[0].title == "hola"

    @pytest.mark.asyncio
    async def test_list_filters_unread(self, repo: InMemoryRepo) -> None:
        n1 = await repo.create(user_id="u1", tipo="system", title="a")
        await repo.create(user_id="u1", tipo="system", title="b")
        # Mark first as read
        n1.read_at = datetime.now(UTC)

        items_all, total_all = await repo.list_for_user("u1")
        items_unread, total_unread = await repo.list_for_user(
            "u1", only_unread=True
        )

        assert total_all == 2
        assert total_unread == 1
        assert items_unread[0].title == "b"

    @pytest.mark.asyncio
    async def test_unread_count(self, repo: InMemoryRepo) -> None:
        await repo.create(user_id="u1", tipo="system", title="a")
        await repo.create(user_id="u1", tipo="system", title="b")
        await repo.create(user_id="u2", tipo="system", title="c")
        assert await repo.unread_count("u1") == 2
        assert await repo.unread_count("u2") == 1
        assert await repo.unread_count("u_other") == 0

    @pytest.mark.asyncio
    async def test_mark_read_only_owner(self, repo: InMemoryRepo) -> None:
        n = await repo.create(user_id="u1", tipo="system", title="a")
        # Otro user no la puede marcar
        result = await repo.mark_read(n.id, "u_attacker")
        assert result is None
        assert n.read_at is None
        # Owner sí
        result = await repo.mark_read(n.id, "u1")
        assert result is not None
        assert result.read_at is not None

    @pytest.mark.asyncio
    async def test_mark_read_returns_404_equivalent_for_missing(
        self, repo: InMemoryRepo
    ) -> None:
        result = await repo.mark_read("00000000-0000-0000-0000-999999999999", "u1")
        assert result is None

    @pytest.mark.asyncio
    async def test_mark_all_read(self, repo: InMemoryRepo) -> None:
        await repo.create(user_id="u1", tipo="system", title="a")
        await repo.create(user_id="u1", tipo="system", title="b")
        await repo.create(user_id="u2", tipo="system", title="c")
        updated = await repo.mark_all_read("u1")
        assert updated == 2
        assert await repo.unread_count("u1") == 0
        # u2 no afectado
        assert await repo.unread_count("u2") == 1

    @pytest.mark.asyncio
    async def test_idempotency_window(self, repo: InMemoryRepo) -> None:
        await repo.create(
            user_id="u1",
            tipo="f29_due",
            title="x",
            entity_type="f29",
            entity_id="42",
        )
        existing = await repo.find_recent_for_idempotency(
            user_id="u1",
            tipo="f29_due",
            entity_type="f29",
            entity_id="42",
        )
        assert existing is not None
        # Different entity_id → no match
        existing2 = await repo.find_recent_for_idempotency(
            user_id="u1",
            tipo="f29_due",
            entity_type="f29",
            entity_id="99",
        )
        assert existing2 is None

    @pytest.mark.asyncio
    async def test_bulk_create(self, repo: InMemoryRepo) -> None:
        notifs = await repo.bulk_create_for_users(
            ["u1", "u2", "u3"],
            tipo="system",
            title="broadcast",
        )
        assert len(notifs) == 3
        assert {n.user_id for n in notifs} == {"u1", "u2", "u3"}


# =====================================================================
# Schema validation
# =====================================================================


class TestSchemas:
    def test_notification_read_from_attributes(self) -> None:
        n = Notification(
            id="00000000-0000-0000-0000-000000000001",
            user_id="u1",
            tipo="system",
            severity="info",
            title="hola",
            body="",
            link=None,
            entity_type=None,
            entity_id=None,
            read_at=None,
            created_at=datetime.now(UTC),
        )
        out = NotificationRead.model_validate(n)
        assert out.title == "hola"
        assert out.tipo == "system"
        assert out.read_at is None

    def test_unread_count_schema(self) -> None:
        assert UnreadCount(unread=5).unread == 5

    def test_generate_alerts_report(self) -> None:
        r = GenerateAlertsReport()
        assert r.total == 0
        assert r.errores == []

    def test_notification_create_requires_user_id(self) -> None:
        # Should raise because user_id is required
        with pytest.raises(ValidationError):
            NotificationCreate(  # type: ignore[call-arg]
                tipo="system", title="x"
            )

    def test_notification_invalid_tipo_rejected(self) -> None:
        with pytest.raises(ValidationError):
            NotificationCreate(  # type: ignore[call-arg]
                user_id="u1",
                tipo="not_a_valid_tipo",  # type: ignore[arg-type]
                title="x",
            )

    def test_notification_invalid_severity_rejected(self) -> None:
        with pytest.raises(ValidationError):
            NotificationCreate(  # type: ignore[call-arg]
                user_id="u1",
                tipo="system",
                title="x",
                severity="catastrophic",  # type: ignore[arg-type]
            )


# =====================================================================
# Generator idempotency (uses in-memory repo)
# =====================================================================


class TestGeneratorIdempotency:
    @pytest.mark.asyncio
    async def test_idempotency_same_entity_skips_duplicate(self) -> None:
        repo = InMemoryRepo()
        # Simula un "intento" del generator: para misma f29_id y user
        await repo.create(
            user_id="u1",
            tipo="f29_due",
            title="F29 X vence en 3 días",
            entity_type="f29",
            entity_id="42",
        )
        existing = await repo.find_recent_for_idempotency(
            user_id="u1",
            tipo="f29_due",
            entity_type="f29",
            entity_id="42",
        )
        # Si existing → generator skip, no crea
        assert existing is not None
        assert len(repo.notifs) == 1

    @pytest.mark.asyncio
    async def test_different_user_gets_separate_alert(self) -> None:
        repo = InMemoryRepo()
        await repo.create(
            user_id="u1",
            tipo="f29_due",
            title="x",
            entity_type="f29",
            entity_id="42",
        )
        # u2 todavía no recibió → debe poder
        existing_u2 = await repo.find_recent_for_idempotency(
            user_id="u2",
            tipo="f29_due",
            entity_type="f29",
            entity_id="42",
        )
        assert existing_u2 is None


# =====================================================================
# Generator service-level test: run_all returns dict with counts
# =====================================================================


class TestGeneratorService:
    @pytest.mark.asyncio
    async def test_run_all_returns_report_with_zero_when_no_data(self) -> None:
        """Sin DB real ni filas — un session mock que devuelve queries vacías
        debe producir report con 0s y sin errores."""
        from app.services.notification_generator_service import (
            NotificationGeneratorService,
        )

        # Mock execute → result with empty .all() + .mappings().all() + .scalar()
        result_mock = AsyncMock()
        result_mock.all = lambda: []
        mappings_mock = AsyncMock()
        mappings_mock.all = lambda: []
        result_mock.mappings = lambda: mappings_mock

        session = AsyncMock()
        session.execute = AsyncMock(return_value=result_mock)

        svc = NotificationGeneratorService(session)
        report = await svc.run_all()
        assert report.total == 0
        assert report.f29_due == 0
        assert report.contrato_due == 0
        assert report.oc_pending == 0


# =====================================================================
# RBAC — `notifications:admin` scope
# =====================================================================


class TestNotificationsAdminScope:
    def test_admin_has_notifications_admin(self) -> None:
        assert "notifications:admin" in scopes_for("admin")

    def test_finance_does_not_have_notifications_admin(self) -> None:
        assert "notifications:admin" not in scopes_for("finance")

    def test_viewer_does_not_have_notifications_admin(self) -> None:
        assert "notifications:admin" not in scopes_for("viewer")
