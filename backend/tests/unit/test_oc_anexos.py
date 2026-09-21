"""Anexos de OC subidos a mano (app/api/v1/oc_anexos.py).

Sin Postgres ni Dropbox: se prueban las reglas del endpoint con dobles.
Lo que importa que no se rompa:
  · scope y estado se chequean ANTES de tocar Dropbox;
  · el archivo va a la carpeta canónica de la empresa, con nombre seguro;
  · la fila queda con source='manual_upload' (el CHECK de la BD sólo admite
    ese valor para subidas a mano) y con quién lo subió;
  · lo que ya estaba cuando firmaron no se puede quitar.
"""
from __future__ import annotations

import io
from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.api.v1 import oc_anexos
from app.main import app

# ──────────────────────────────────────────────────────────────────────
# Nombre seguro para Dropbox
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("entrada", "esperado"),
    [
        ("Cotización Nº 12.pdf", "Cotizacion No 12.pdf"),
        ("../../etc/passwd", "etc_passwd"),
        ("a/b\\c.pdf", "a_b_c.pdf"),
        ("   ", "archivo"),
        ("OC-T&E-0002", "OC-T_E-0002"),
    ],
)
def test_nombre_seguro(entrada, esperado):
    assert oc_anexos._nombre_seguro(entrada) == esperado


def test_nombre_seguro_largo_conserva_la_extension():
    n = oc_anexos._nombre_seguro("x" * 300 + ".pdf")
    assert len(n) <= 120 and n.endswith(".pdf")


def test_rutas_registradas():
    rutas = {(tuple(sorted(r.methods)), r.path) for r in app.routes if hasattr(r, "methods")}
    base = "/api/v1/ordenes-compra/{oc_id:int}/anexos"
    assert (("GET",), base) in rutas
    assert (("POST",), base) in rutas
    assert (("GET",), base + "/{attachment_id:int}/url") in rutas
    assert (("DELETE",), base + "/{attachment_id:int}") in rutas


# ──────────────────────────────────────────────────────────────────────
# Dobles
# ──────────────────────────────────────────────────────────────────────


class _Res:
    def __init__(self, fila: dict | None):
        self._fila = fila

    def mappings(self):
        return self

    def one(self):
        return self._fila

    def first(self):
        return self._fila


class _DB:
    def __init__(self, anexos_existentes: int = 0, fila_delete: dict | None = None):
        self.anexos_existentes = anexos_existentes
        self.fila_delete = fila_delete
        self.sql: list[tuple[str, dict]] = []
        self.commits = 0

    async def scalar(self, stmt, params=None):
        q = str(stmt)
        if "count(*)" in q:
            return self.anexos_existentes
        if "auth.users" in q:
            return "nicolas@example.com"
        raise AssertionError(q)

    async def execute(self, stmt, params=None):
        q = str(stmt)
        self.sql.append((q, params or {}))
        if "INSERT INTO core.oc_attachments" in q:
            return _Res(
                {
                    "attachment_id": 7,
                    "oc_id": params["oc"],
                    "file_name": params["n"],
                    "mime_type": params["m"],
                    "size_bytes": params["s"],
                    "source": "manual_upload",
                    "descripcion": params["d"],
                    "subido_por_email": params["email"],
                    "created_at": datetime.now(UTC),
                }
            )
        if "FOR UPDATE OF a" in q:
            return _Res(self.fila_delete)
        return _Res(None)

    async def commit(self):
        self.commits += 1


class _Dbx:
    def __init__(self):
        self.carpetas: list[str] = []
        self.subidas: list[tuple[str, int, bool]] = []

    def ensure_folder_path(self, path):
        self.carpetas.append(path)

    def upload_file(self, path, content, *, overwrite=True):
        self.subidas.append((path, len(content), overwrite))


_OC = {
    "oc_id": 59,
    "numero_oc": "OC-T&E-0002",
    "empresa_codigo": "TECMAVIDA",
    "estado": "en_firma",
    "fecha_emision": date(2026, 8, 20),
}


def _archivo(nombre="cotizacion.pdf", mime="application/pdf", contenido=b"%PDF-1.4 x"):
    return UploadFile(
        file=io.BytesIO(contenido),
        filename=nombre,
        headers=Headers({"content-type": mime}),
    )


@pytest.fixture
def dobles(monkeypatch):
    dbx = _Dbx()
    auditoria: list[dict[str, Any]] = []
    estado = {"oc": dict(_OC)}

    async def fake_oc(db, user, oc_id):
        return estado["oc"]

    async def fake_dropbox(db):
        return dbx

    async def fake_audit(db, request, user, **kw):
        auditoria.append(kw)

    monkeypatch.setattr(oc_anexos, "_oc_con_scope", fake_oc)
    monkeypatch.setattr(oc_anexos, "_dropbox", fake_dropbox)
    monkeypatch.setattr(oc_anexos, "audit_log", fake_audit)
    return SimpleNamespace(dbx=dbx, auditoria=auditoria, estado=estado)


_USER = SimpleNamespace(sub="00000000-0000-0000-0000-000000000001")


async def _subir(db, archivo, descripcion=None):
    return await oc_anexos.subir_anexo(
        user=_USER, db=db, request=None, oc_id=59, file=archivo, descripcion=descripcion
    )


# ──────────────────────────────────────────────────────────────────────
# Subir
# ──────────────────────────────────────────────────────────────────────


async def test_subir_va_a_la_carpeta_canonica_y_queda_manual_upload(dobles):
    db = _DB()
    r = await _subir(db, _archivo(), descripcion="  Cotización firmada  ")

    carpeta = "/Cehta Capital/01-Empresas/TECMAVIDA/06-Adjuntos-OCs/2026/OC-T_E-0002"
    assert dobles.dbx.carpetas == [carpeta]
    ruta, tam, overwrite = dobles.dbx.subidas[0]
    assert ruta.startswith(carpeta + "/") and ruta.endswith("_cotizacion.pdf")
    assert overwrite is False  # dos "cotizacion.pdf" no se pisan

    insert = next(p for q, p in db.sql if "INSERT INTO core.oc_attachments" in q)
    assert insert["p"] == ruta
    assert insert["d"] == "Cotización firmada"
    assert insert["uid"] == _USER.sub
    assert r.source == "manual_upload" and r.se_puede_quitar is True
    assert db.commits == 1
    assert dobles.auditoria[0]["action"] == "create"
    assert "cotizacion.pdf" in dobles.auditoria[0]["summary"]


async def test_oc_anulada_no_recibe_anexos_ni_toca_dropbox(dobles):
    dobles.estado["oc"] = {**_OC, "estado": "anulada"}
    with pytest.raises(HTTPException) as e:
        await _subir(_DB(), _archivo())
    assert e.value.status_code == 409
    assert dobles.dbx.subidas == []


async def test_techo_de_anexos_por_oc(dobles):
    with pytest.raises(HTTPException) as e:
        await _subir(_DB(anexos_existentes=oc_anexos._MAX_ANEXOS_POR_OC), _archivo())
    assert e.value.status_code == 409
    assert dobles.dbx.subidas == []


async def test_archivo_vacio(dobles):
    with pytest.raises(HTTPException) as e:
        await _subir(_DB(), _archivo(contenido=b""))
    assert e.value.status_code == 400


async def test_archivo_demasiado_grande(dobles, monkeypatch):
    monkeypatch.setattr(oc_anexos, "_MAX_BYTES", 10)
    with pytest.raises(HTTPException) as e:
        await _subir(_DB(), _archivo(contenido=b"x" * 11))
    assert e.value.status_code == 413
    assert dobles.dbx.subidas == []


@pytest.mark.parametrize("mime", ["application/x-msdownload", "text/html", "image/svg+xml"])
async def test_tipo_no_permitido(dobles, mime):
    with pytest.raises(HTTPException) as e:
        await _subir(_DB(), _archivo(nombre="x.bin", mime=mime))
    assert e.value.status_code == 400
    assert dobles.dbx.subidas == []


@pytest.mark.parametrize(
    "mime",
    ["image/jpeg", "image/png",
     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
)
async def test_tipos_permitidos(dobles, mime):
    r = await _subir(_DB(), _archivo(nombre="a.x", mime=mime))
    assert r.mime_type == mime


async def test_dropbox_caido_da_502_y_no_inserta(dobles):
    def revienta(*a, **k):
        raise RuntimeError("dropbox down")

    dobles.dbx.upload_file = revienta
    db = _DB()
    with pytest.raises(HTTPException) as e:
        await _subir(db, _archivo())
    assert e.value.status_code == 502
    assert not any("INSERT" in q for q, _ in db.sql)


# ──────────────────────────────────────────────────────────────────────
# Quitar
# ──────────────────────────────────────────────────────────────────────


async def _quitar(db):
    return await oc_anexos.quitar_anexo(
        user=_USER, db=db, request=None, oc_id=59, attachment_id=7
    )


async def test_quitar_lo_que_ya_estaba_cuando_firmaron_da_409(dobles):
    db = _DB(fila_delete={"file_name": "a.pdf", "dropbox_path": "/x/a.pdf",
                          "descripcion": None, "firmado_despues": True})
    with pytest.raises(HTTPException) as e:
        await _quitar(db)
    assert e.value.status_code == 409
    assert not any(q.strip().startswith("DELETE") for q, _ in db.sql)


async def test_quitar_borra_la_fila_audita_y_no_toca_dropbox(dobles):
    db = _DB(fila_delete={"file_name": "a.pdf", "dropbox_path": "/x/a.pdf",
                          "descripcion": "cotización", "firmado_despues": False})
    r = await _quitar(db)
    assert r.status_code == 204
    assert any(q.strip().startswith("DELETE FROM core.oc_attachments") for q, _ in db.sql)
    assert db.commits == 1
    assert dobles.auditoria[0]["action"] == "delete"
    assert dobles.auditoria[0]["before"]["dropbox_path"] == "/x/a.pdf"


async def test_quitar_inexistente_da_404(dobles):
    with pytest.raises(HTTPException) as e:
        await _quitar(_DB(fila_delete=None))
    assert e.value.status_code == 404
