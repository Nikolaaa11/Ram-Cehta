"""Unit tests para `app.services.dropbox_service` y la matriz RBAC integraciones.

No tocamos red ni la base. La cara con red (Dropbox API) se prueba via mocks
sobre `dropbox.Dropbox` en `test_dropbox_service_serialization`.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.core import config as config_module
from app.core.rbac import scopes_for
from app.services.dropbox_service import (
    DropboxNotConfigured,
    DropboxService,
    build_oauth_flow,
)

# ---------------------------------------------------------------------------
# RBAC: integration:write/read pertenecen solo a admin
# ---------------------------------------------------------------------------


def test_admin_has_integration_write() -> None:
    assert "integration:write" in scopes_for("admin")


def test_admin_has_integration_read() -> None:
    assert "integration:read" in scopes_for("admin")


def test_finance_does_not_have_integration_write() -> None:
    assert "integration:write" not in scopes_for("finance")


def test_viewer_does_not_have_integration_write() -> None:
    assert "integration:write" not in scopes_for("viewer")


def test_finance_does_not_have_integration_read() -> None:
    assert "integration:read" not in scopes_for("finance")


# ---------------------------------------------------------------------------
# DropboxNotConfigured: faltan credenciales
# ---------------------------------------------------------------------------


def test_service_raises_if_client_id_missing() -> None:
    with (
        patch.object(config_module.settings, "dropbox_client_id", None),
        patch.object(config_module.settings, "dropbox_client_secret", "secret"),
        pytest.raises(DropboxNotConfigured),
    ):
        DropboxService(access_token="x")


def test_service_raises_if_client_secret_missing() -> None:
    with (
        patch.object(config_module.settings, "dropbox_client_id", "id"),
        patch.object(config_module.settings, "dropbox_client_secret", None),
        pytest.raises(DropboxNotConfigured),
    ):
        DropboxService(access_token="x")


def test_oauth_flow_requires_redirect_uri() -> None:
    with (
        patch.object(config_module.settings, "dropbox_client_id", "id"),
        patch.object(config_module.settings, "dropbox_client_secret", "secret"),
        patch.object(config_module.settings, "dropbox_redirect_uri", None),
        pytest.raises(DropboxNotConfigured),
    ):
        build_oauth_flow({})


# ---------------------------------------------------------------------------
# Serialización de entries (no toca red)
# ---------------------------------------------------------------------------


@patch("app.services.dropbox_service.dropbox.Dropbox")
def test_list_folder_serializes_entries(mock_dropbox: MagicMock) -> None:
    """list_folder() devuelve dicts con campos esperados y diferencia file vs folder."""
    from datetime import datetime

    from dropbox.files import FolderMetadata

    file_entry = SimpleNamespace(
        name="Data Madre.xlsx",
        path_display="/Cehta Capital/Inteligencia de Negocios/Data Madre.xlsx",
        size=12345,
        client_modified=datetime(2026, 4, 25, 10, 30, 0),
    )
    folder_entry = MagicMock(spec=FolderMetadata)
    folder_entry.name = "Histórico"
    folder_entry.path_display = "/Cehta Capital/Inteligencia de Negocios/Histórico"

    fake_result = SimpleNamespace(
        entries=[file_entry, folder_entry], has_more=False, cursor=""
    )
    fake_dbx = MagicMock()
    fake_dbx.files_list_folder.return_value = fake_result
    mock_dropbox.return_value = fake_dbx

    with (
        patch.object(config_module.settings, "dropbox_client_id", "id"),
        patch.object(config_module.settings, "dropbox_client_secret", "secret"),
    ):
        svc = DropboxService(access_token="t", refresh_token="r")
        items = svc.list_folder("/Cehta Capital/Inteligencia de Negocios")

    assert len(items) == 2
    file_item, folder_item = items
    assert file_item["type"] == "file"
    assert file_item["name"] == "Data Madre.xlsx"
    assert file_item["size"] == 12345
    assert file_item["modified"] == "2026-04-25T10:30:00"
    assert folder_item["type"] == "folder"
    assert folder_item["name"] == "Histórico"
    assert folder_item["size"] is None
    assert folder_item["modified"] is None


@patch("app.services.dropbox_service.dropbox.Dropbox")
def test_find_folder_is_case_insensitive(mock_dropbox: MagicMock) -> None:
    from dropbox.files import FolderMetadata

    folder_entry = MagicMock(spec=FolderMetadata)
    folder_entry.name = "Inteligencia de Negocios"
    folder_entry.path_display = "/Cehta Capital/Inteligencia de Negocios"

    fake_result = SimpleNamespace(entries=[folder_entry], has_more=False, cursor="")
    fake_dbx = MagicMock()
    fake_dbx.files_list_folder.return_value = fake_result
    mock_dropbox.return_value = fake_dbx

    with (
        patch.object(config_module.settings, "dropbox_client_id", "id"),
        patch.object(config_module.settings, "dropbox_client_secret", "secret"),
    ):
        svc = DropboxService(access_token="t")
        path = svc.find_folder("inteligencia DE NEGOCIOS", "/Cehta Capital")

    assert path == "/Cehta Capital/Inteligencia de Negocios"


@patch("app.services.dropbox_service.dropbox.Dropbox")
def test_find_folder_returns_none_when_missing(mock_dropbox: MagicMock) -> None:
    fake_result = SimpleNamespace(entries=[], has_more=False, cursor="")
    fake_dbx = MagicMock()
    fake_dbx.files_list_folder.return_value = fake_result
    mock_dropbox.return_value = fake_dbx

    with (
        patch.object(config_module.settings, "dropbox_client_id", "id"),
        patch.object(config_module.settings, "dropbox_client_secret", "secret"),
    ):
        svc = DropboxService(access_token="t")
        path = svc.find_folder("Carpeta Inexistente", "")

    assert path is None
