"""Tests para cartolas_sync_service — testea la lógica de orquestación
con mocks de DropboxService + AsyncSession.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.cartolas_parser_service import (
    CartolaParseResult,
    CartolaRow,
)




def _patch_integration(found: bool = True):
    """R152ZZZZZZ — el servicio ya no hace DropboxService() sin args: primero
    carga la integración desde core.integrations (IntegrationRepository).
    Estos tests quedaron del diseño viejo; este helper mockea el repo."""
    fake = MagicMock()
    fake.access_token = "tok"
    fake.refresh_token = "rtok"
    repo = MagicMock()
    repo.get_by_provider = AsyncMock(return_value=fake if found else None)
    return patch(
        "app.services.cartolas_sync_service.IntegrationRepository",
        return_value=repo,
    )

class TestSyncCartolasForEmpresa:
    """Tests de orquestación con servicios mockeados."""

    @pytest.mark.asyncio
    async def test_no_dropbox_returns_error(self) -> None:
        """Si DropboxService no está configurado, devuelve stats con error."""
        from app.services.cartolas_sync_service import sync_cartolas_for_empresa
        from app.services.dropbox_service import DropboxNotConfigured

        mock_db = AsyncMock()

        with _patch_integration(found=False):
            result = await sync_cartolas_for_empresa(
                mock_db, "TRONGKAI", triggered_by="test"
            )

        assert result["files_seen"] == 0
        assert any("Dropbox no configurado" in e for e in result["errors"])

    @pytest.mark.asyncio
    async def test_skips_non_pdf_files(self) -> None:
        """Files con extensión != pdf se ignoran sin contar."""
        from app.services.cartolas_sync_service import sync_cartolas_for_empresa

        mock_db = AsyncMock()
        mock_db.execute.return_value.fetchall = MagicMock(return_value=[])
        mock_db.commit = AsyncMock()

        mock_dbx = MagicMock()
        mock_dbx.list_folder.return_value = [
            {"type": "file", "name": "readme.txt", "path": "/x/readme.txt"},
            {"type": "file", "name": "script.exe", "path": "/x/script.exe"},
            {"type": "folder", "name": "subdir", "path": "/x/subdir"},
        ]

        with _patch_integration(), patch(
            "app.services.cartolas_sync_service.DropboxService",
            return_value=mock_dbx,
        ):
            result = await sync_cartolas_for_empresa(
                mock_db, "TRONGKAI", triggered_by="test"
            )

        assert result["files_seen"] == 0  # ningún PDF encontrado
        assert result["files_imported"] == 0
        assert result["errors"] == []

    @pytest.mark.asyncio
    async def test_skips_duplicate_file_hash(self) -> None:
        """Si el file_hash ya está en cartolas_runs, skip."""
        from app.services import cartolas_sync_service

        # Pre-existing hash que matchea el del fake content
        from app.services.cartolas_parser_service import file_hash

        fake_pdf = b"fake pdf content"
        existing_hash = file_hash(fake_pdf)

        mock_db = AsyncMock()
        # Pre-loaded existing hashes
        mock_result = MagicMock()
        mock_result.fetchall = MagicMock(
            return_value=[(existing_hash,)]
        )
        mock_db.execute.return_value = mock_result
        mock_db.commit = AsyncMock()

        mock_dbx = MagicMock()
        mock_dbx.list_folder.return_value = [
            {
                "type": "file",
                "name": "2026-04_santander.pdf",
                "path": "/x/2026-04_santander.pdf",
            }
        ]
        mock_dbx.download_file.return_value = fake_pdf

        with _patch_integration(), patch.object(
            cartolas_sync_service, "DropboxService", return_value=mock_dbx
        ):
            result = await cartolas_sync_service.sync_cartolas_for_empresa(
                mock_db, "TRONGKAI", triggered_by="test"
            )

        assert result["files_seen"] == 1
        assert result["files_skipped"] == 1
        assert result["files_imported"] == 0

    @pytest.mark.asyncio
    async def test_handles_failed_parse(self) -> None:
        """Si parse_cartola_pdf devuelve error, run pasa a failed_parse."""
        from app.services import cartolas_sync_service

        mock_db = AsyncMock()
        empty_result = MagicMock()
        empty_result.fetchall = MagicMock(return_value=[])
        # First call (existing hashes) returns empty.
        # Second call (insert run) returns scalar (run_id).
        # Third call (update status) returns nothing.
        mock_db.execute.return_value = empty_result
        mock_db.execute.return_value.scalar = MagicMock(return_value=42)
        mock_db.commit = AsyncMock()

        mock_dbx = MagicMock()
        mock_dbx.list_folder.return_value = [
            {
                "type": "file",
                "name": "broken.pdf",
                "path": "/x/broken.pdf",
            }
        ]
        mock_dbx.download_file.return_value = b"broken pdf"

        # Mock parse_cartola_pdf para devolver error
        bad_result = CartolaParseResult(
            banco="unknown",
            periodo_desde=None,
            periodo_hasta=None,
            error="PdfReader falló: invalid PDF header",
        )
        with _patch_integration(), patch.object(
            cartolas_sync_service, "DropboxService", return_value=mock_dbx
        ), patch.object(
            cartolas_sync_service, "parse_cartola_pdf", return_value=bad_result
        ):
            result = await cartolas_sync_service.sync_cartolas_for_empresa(
                mock_db, "TRONGKAI", triggered_by="test"
            )

        assert result["files_seen"] == 1
        assert result["files_failed_parse"] == 1
        assert result["files_imported"] == 0

    @pytest.mark.asyncio
    async def test_handles_scanned_pdf(self) -> None:
        """PDF escaneado (is_scanned=True) → failed_ocr_required."""
        from app.services import cartolas_sync_service

        mock_db = AsyncMock()
        empty_result = MagicMock()
        empty_result.fetchall = MagicMock(return_value=[])
        mock_db.execute.return_value = empty_result
        mock_db.execute.return_value.scalar = MagicMock(return_value=43)
        mock_db.commit = AsyncMock()

        mock_dbx = MagicMock()
        mock_dbx.list_folder.return_value = [
            {
                "type": "file",
                "name": "scanned.pdf",
                "path": "/x/scanned.pdf",
            }
        ]
        mock_dbx.download_file.return_value = b"scanned pdf bytes"

        scanned_result = CartolaParseResult(
            banco="unknown",
            periodo_desde=None,
            periodo_hasta=None,
            is_scanned=True,
            error="PDF parece escaneado",
        )
        with _patch_integration(), patch.object(
            cartolas_sync_service, "DropboxService", return_value=mock_dbx
        ), patch.object(
            cartolas_sync_service,
            "parse_cartola_pdf",
            return_value=scanned_result,
        ):
            result = await cartolas_sync_service.sync_cartolas_for_empresa(
                mock_db, "TRONGKAI", triggered_by="test"
            )

        assert result["files_failed_ocr_required"] == 1
        assert result["files_imported"] == 0
