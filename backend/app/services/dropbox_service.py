"""Servicio para interactuar con Dropbox API (lectura del workspace Cehta).

Diseño:
- Soporta OAuth offline (refresh_token) — el SDK rota access_token solo si
  recibe `oauth2_refresh_token` + `app_key`/`app_secret`.
- Single-tenant en V3: la app asume una sola cuenta Dropbox conectada
  (la corporativa de Cehta). Multi-tenant queda para V4.
- `build_oauth_flow` arma el `DropboxOAuth2Flow` con `token_access_type=offline`
  para garantizar refresh_token persistente en el callback.

Excepciones:
- `DropboxNotConfigured`: faltan client_id/secret en `Settings`. El handler
  HTTP debe traducirla a 503.
"""
from __future__ import annotations

from typing import Any

import dropbox
from dropbox.files import FolderMetadata
from dropbox.oauth import DropboxOAuth2Flow

from app.core.config import settings


class DropboxNotConfigured(Exception):  # noqa: N818 — alias compat: ya importado así
    """Cliente Dropbox no configurado en backend (faltan client_id/secret)."""


def _require_client_credentials() -> tuple[str, str]:
    if not settings.dropbox_client_id or not settings.dropbox_client_secret:
        raise DropboxNotConfigured(
            "DROPBOX_CLIENT_ID/DROPBOX_CLIENT_SECRET no configurados en backend"
        )
    return settings.dropbox_client_id, settings.dropbox_client_secret


class DropboxService:
    """Wrapper sobre `dropbox.Dropbox` con utilities para listar/buscar/descargar."""

    def __init__(self, access_token: str, refresh_token: str | None = None) -> None:
        client_id, client_secret = _require_client_credentials()
        self.dbx = dropbox.Dropbox(
            oauth2_access_token=access_token,
            oauth2_refresh_token=refresh_token,
            app_key=client_id,
            app_secret=client_secret,
        )

    def get_account(self) -> dict[str, Any]:
        acc = self.dbx.users_get_current_account()
        return {
            "account_id": acc.account_id,
            "email": acc.email,
            "display_name": acc.name.display_name,
        }

    def list_folder(self, path: str = "") -> list[dict[str, Any]]:
        """Lista archivos y carpetas en `path`. '' = root del app/usuario.

        Cada item: name, path, type (file|folder), size, modified (ISO 8601 o None).
        Pagina automáticamente con `files_list_folder_continue` mientras
        `has_more` siga true (hasta 10K entradas — protección anti-runaway).
        """
        items: list[dict[str, Any]] = []
        result = self.dbx.files_list_folder(path)
        items.extend(self._serialize_entries(result.entries))

        guard = 0
        while result.has_more and guard < 10:
            result = self.dbx.files_list_folder_continue(result.cursor)
            items.extend(self._serialize_entries(result.entries))
            guard += 1

        return items

    @staticmethod
    def _serialize_entries(entries: list[Any]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for entry in entries:
            is_folder = isinstance(entry, FolderMetadata)
            modified = getattr(entry, "client_modified", None)
            out.append(
                {
                    "name": entry.name,
                    "path": entry.path_display,
                    "type": "folder" if is_folder else "file",
                    "size": None if is_folder else getattr(entry, "size", None),
                    "modified": modified.isoformat() if modified else None,
                }
            )
        return out

    def find_folder(self, name: str, root: str = "") -> str | None:
        """Devuelve el `path_display` de una subcarpeta de `root` (case-insensitive)."""
        try:
            items = self.list_folder(root)
        except Exception:
            # root puede no existir; preferimos None silente
            return None
        target = name.casefold()
        for item in items:
            if item["type"] == "folder" and item["name"].casefold() == target:
                path = item["path"]
                return path if isinstance(path, str) else None
        return None

    def download_file(self, path: str) -> bytes:
        _, response = self.dbx.files_download(path)
        content = response.content
        return content if isinstance(content, bytes) else bytes(content)

    # ------------------------------------------------------------------
    # Write operations (V3 fase 2 — trabajadores upload)
    # ------------------------------------------------------------------

    def create_folder(self, path: str) -> str:
        """Crea carpeta. Idempotente — si ya existe, no falla."""
        try:
            self.dbx.files_create_folder_v2(path)
        except dropbox.exceptions.ApiError as exc:
            # Si ya existe, OK (path/conflict/folder)
            if "conflict" in str(exc).lower():
                return path
            raise
        return path

    def ensure_folder_path(self, path: str) -> str:
        """Crea recursivamente todas las subcarpetas de path si no existen."""
        parts = [p for p in path.split("/") if p]
        current = ""
        for part in parts:
            current = f"{current}/{part}"
            self.create_folder(current)
        return path

    def upload_file(
        self, path: str, content: bytes, *, overwrite: bool = True
    ) -> dict[str, Any]:
        """Sube un archivo. Si existe y overwrite=True, sobreescribe."""
        mode = (
            dropbox.files.WriteMode.overwrite
            if overwrite
            else dropbox.files.WriteMode.add
        )
        res = self.dbx.files_upload(content, path, mode=mode, autorename=False)
        return {
            "name": res.name,
            "path": res.path_display,
            "size": res.size,
        }

    def move(self, from_path: str, to_path: str) -> str:
        """Mueve archivo o carpeta. autorename=False — falla si destino existe."""
        self.dbx.files_move_v2(
            from_path, to_path, allow_shared_folder=True, autorename=False
        )
        return to_path

    def get_temporary_link(self, path: str) -> str:
        """Genera URL temporal (4h vida) para descarga directa del archivo."""
        res = self.dbx.files_get_temporary_link(path)
        return str(res.link)

    def delete(self, path: str) -> None:
        """Borra archivo o carpeta (no falla si no existe)."""
        try:
            self.dbx.files_delete_v2(path)
        except dropbox.exceptions.ApiError as exc:
            if "not_found" in str(exc).lower():
                return
            raise


def build_oauth_flow(session_state: dict[str, Any]) -> DropboxOAuth2Flow:
    """Crea el flow OAuth2 con `token_access_type=offline` (refresh_token).

    `session_state` es un dict mutable que el SDK usa para guardar el csrf
    token entre `start()` y `finish()`. En single-admin/single-tenant alcanza
    con un dict en memoria a nivel módulo (ver `app.api.v1.dropbox`).
    """
    client_id, client_secret = _require_client_credentials()
    if not settings.dropbox_redirect_uri:
        raise DropboxNotConfigured("DROPBOX_REDIRECT_URI no configurado")

    return DropboxOAuth2Flow(
        consumer_key=client_id,
        consumer_secret=client_secret,
        redirect_uri=settings.dropbox_redirect_uri,
        session=session_state,
        csrf_token_session_key="dropbox-auth-csrf-token",  # noqa: S106 — session key, no secret
        token_access_type="offline",  # noqa: S106 — flag literal del SDK, no secret
    )
