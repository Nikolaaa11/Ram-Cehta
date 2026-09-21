"""Anexos de OC subidos a mano (app/api/v1/oc_anexos.py).

Sin Postgres ni Dropbox: se prueban las reglas del endpoint con dobles.
Lo que importa que no se rompa:
  · scope y reglas se chequean ANTES de tocar Dropbox;
  · un anexo sólo entra o sale mientras NADIE firmó (es parte de lo firmado);
  · el tipo se verifica por CONTENIDO, no por el Content-Type del navegador;
  · topes por archivo y por OC (el PDF viaja por correo);
  · si la fila no se guarda, el archivo recién subido se borra de Dropbox;
  · el archivo va a la carpeta canónica de la empresa, con nombre seguro.
"""
from __future__ import annotations

import io
import zipfile
from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.api.v1 import oc_anexos
from app.main import app

# ──────────────────────────────────────────────────────────────────────
# Archivos reales mínimos (el contenido se verifica de verdad)
# ──────────────────────────────────────────────────────────────────────


def _pdf(paginas: int = 1, clave: str | None = None) -> bytes:
    from pypdf import PdfWriter

    w = PdfWriter()
    for _ in range(paginas):
        w.add_blank_page(width=200, height=200)
    if clave:
        w.encrypt(user_password=clave)
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def _png(ancho: int = 40, alto: int = 30) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGBA", (ancho, alto), (10, 120, 60, 200)).save(out, format="PNG")
    return out.getvalue()


def _jpg() -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 10, 10)).save(out, format="JPEG")
    return out.getvalue()


def _xlsx(macros: bool = False) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("xl/workbook.xml", "<workbook/>")
        if macros:
            z.writestr("xl/vbaProject.bin", b"\x00")
    return out.getvalue()


def _docx() -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<document/>")
    return out.getvalue()


# ──────────────────────────────────────────────────────────────────────
# Helpers puros
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


@pytest.mark.parametrize(
    ("nombre", "mime_cliente", "esperado"),
    [
        ("a.PDF", "application/octet-stream", "application/pdf"),
        ("foto.jpeg", "", "image/jpeg"),
        ("presupuesto.xlsx", "application/octet-stream",
         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        ("escaneo", "application/pdf", "application/pdf"),  # sin extensión: pista del mime
    ],
)
def test_tipo_por_extension_no_por_content_type(nombre, mime_cliente, esperado):
    assert oc_anexos._tipo_de(nombre, mime_cliente)[0] == esperado


@pytest.mark.parametrize("nombre", ["x.exe", "x.html", "x.xlsm", "x.svg", "foto.heic", "sin_ext"])
def test_formatos_no_aceptados(nombre):
    with pytest.raises(HTTPException) as e:
        oc_anexos._tipo_de(nombre, "application/x-whatever")
    assert e.value.status_code == 400


def test_heic_explica_que_hacer():
    with pytest.raises(HTTPException) as e:
        oc_anexos._tipo_de("IMG_1234.HEIC", "image/heic")
    assert "JPG" in e.value.detail


def _verificar(nombre: str, contenido: bytes) -> str:
    mime, familia = oc_anexos._tipo_de(nombre, None)
    return oc_anexos._verificar_contenido(familia, mime, contenido, nombre)


def test_contenido_valido_pasa():
    assert _verificar("a.pdf", _pdf()) == "application/pdf"
    assert _verificar("a.png", _png()) == "image/png"
    assert _verificar("a.xlsx", _xlsx()).endswith("spreadsheetml.sheet")
    assert _verificar("a.docx", _docx()).endswith("wordprocessingml.document")
    assert _verificar("a.xls", oc_anexos._OLE_MAGIC + b"\x00" * 100) == "application/vnd.ms-excel"


def test_imagen_con_extension_equivocada_toma_el_formato_real():
    # Un JPG guardado como .png sigue siendo una imagen válida.
    assert _verificar("foto.png", _jpg()) == "image/jpeg"


@pytest.mark.parametrize(
    ("nombre", "contenido", "pista"),
    [
        ("falso.pdf", b"<html>no soy pdf</html>", "no es un PDF"),
        ("roto.pdf", b"%PDF-1.4 basura sin estructura", "dañado"),
        ("clave.pdf", None, "contraseña"),
        ("falsa.jpg", b"GIF89a....", "imagen"),
        ("macros.xlsx", None, "macros"),
        ("disfrazado.docx", None, "no corresponde"),
        ("texto.xls", b"hola mundo", "Office"),
    ],
)
def test_contenido_que_no_calza_se_rechaza(nombre, contenido, pista):
    if nombre == "clave.pdf":
        contenido = _pdf(clave="secreta")
    elif nombre == "macros.xlsx":
        contenido = _xlsx(macros=True)
    elif nombre == "disfrazado.docx":
        contenido = _xlsx()  # un Excel con extensión .docx
    with pytest.raises(HTTPException) as e:
        _verificar(nombre, contenido)
    assert e.value.status_code == 400
    assert pista in e.value.detail


def test_imagen_que_no_cabe_en_memoria_se_rechaza():
    """Un PNG de pocos KB puede pedir >1 GB al renderizarse: se mide por los
    bytes decodificados (el mismo criterio que usa el PDF)."""
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGBA", (5000, 4000), (0, 0, 0, 0)).save(out, format="PNG")
    assert len(out.getvalue()) < 1_000_000  # pesa poco...
    with pytest.raises(HTTPException) as e:
        _verificar("plano.png", out.getvalue())  # ...pero son 80 MB decodificado
    assert "resolución demasiado alta" in e.value.detail


def test_foto_mpo_de_iphone_o_camara_se_acepta_como_jpeg():
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (400, 300), (1, 2, 3)).save(
        out, format="MPO", save_all=True, append_images=[Image.new("RGB", (80, 60))]
    )
    assert _verificar("IMG_1234.JPG", out.getvalue()) == "image/jpeg"


def test_jpeg_cortado_se_rechaza_antes_de_llegar_al_pdf():
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (800, 600), (120, 30, 30)).save(out, format="JPEG", quality=95)
    cortado = out.getvalue()[: len(out.getvalue()) // 3]
    with pytest.raises(HTTPException) as e:
        _verificar("foto.jpg", cortado)
    assert e.value.status_code == 400


def test_docx_de_word_web_con_document2_se_acepta():
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr(
            "_rels/.rels",
            '<Relationships><Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/'
            'relationships/officeDocument" Target="word/document2.xml"/>'
            "</Relationships>",
        )
        z.writestr("word/document2.xml", "<document/>")
    assert _verificar("acta.docx", out.getvalue()).endswith("wordprocessingml.document")


def test_doc_antiguo_con_macros_se_rechaza():
    ole = oc_anexos._OLE_MAGIC + b"\x00" * 200 + "_VBA_PROJECT".encode("utf-16-le")
    with pytest.raises(HTTPException) as e:
        _verificar("viejo.doc", ole)
    assert "macros" in e.value.detail


def test_xls_que_en_verdad_es_html_explica_que_hacer():
    with pytest.raises(HTTPException) as e:
        _verificar("cartola.xls", b"<html><table><tr><td>1</td></tr></table></html>")
    assert "HTML" in e.value.detail and ".xlsx" in e.value.detail


@pytest.mark.parametrize(
    ("mime", "esperado"),
    [("application/pdf", True), ("image/png", True), ("image/gif", False),
     ("image/heic", False), ("application/vnd.ms-excel", False), (None, False)],
)
def test_en_el_pdf_sigue_al_render(mime, esperado):
    assert oc_anexos._en_el_pdf(mime) is esperado


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

    def all(self):
        return [] if self._fila is None else [self._fila]


class _DB:
    def __init__(
        self,
        *,
        firmadas: int = 0,
        anexos: int = 0,
        bytes_usados: int = 0,
        fila_delete: dict | None = None,
        falla_insert: bool = False,
        firmadas_al_insertar: int | None = None,
    ):
        self.firmadas = firmadas
        self.anexos = anexos
        self.bytes_usados = bytes_usados
        self.fila_delete = fila_delete
        self.falla_insert = falla_insert
        self.firmadas_al_insertar = firmadas_al_insertar
        self.sql: list[tuple[str, dict]] = []
        self.commits = 0
        self.rollbacks = 0

    async def scalar(self, stmt, params=None):
        q = str(stmt)
        if "FROM core.oc_firmas" in q:
            return self.firmadas
        if "auth.users" in q:
            return "nicolas@example.com"
        raise AssertionError(q)

    async def execute(self, stmt, params=None):
        q = str(stmt)
        self.sql.append((q, params or {}))
        if "sum(size_bytes)" in q:
            return _Res({"n": self.anexos, "b": self.bytes_usados})
        if "INSERT INTO core.oc_attachments" in q:
            if self.falla_insert:
                raise RuntimeError("se cayó la BD")
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
        if "SELECT file_name, dropbox_path, descripcion" in q:
            return _Res(self.fila_delete)
        return _Res(None)

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


class _Dbx:
    def __init__(self):
        self.carpetas: list[str] = []
        self.subidas: list[tuple[str, int, bool]] = []
        self.borrados: list[str] = []

    def ensure_folder_path(self, path):
        self.carpetas.append(path)

    def upload_file(self, path, content, *, overwrite=True):
        self.subidas.append((path, len(content), overwrite))

    def delete(self, path):
        self.borrados.append(path)


_OC = {
    "oc_id": 59,
    "numero_oc": "OC-T&E-0002",
    "empresa_codigo": "TECMAVIDA",
    "estado": "en_firma",
    "fecha_emision": date(2026, 8, 20),
}


def _archivo(nombre="cotizacion.pdf", mime="application/pdf", contenido=None):
    return UploadFile(
        file=io.BytesIO(_pdf() if contenido is None else contenido),
        filename=nombre,
        headers=Headers({"content-type": mime}),
    )


@pytest.fixture
def dobles(monkeypatch):
    dbx = _Dbx()
    auditoria: list[dict[str, Any]] = []
    estado = {"oc": dict(_OC), "llamadas": []}

    async def fake_oc(db, user, oc_id, *, bloquear=False):
        estado["llamadas"].append(bloquear)
        # Simula que alguien firmó MIENTRAS se subía el archivo.
        if bloquear and getattr(db, "firmadas_al_insertar", None) is not None:
            db.firmadas = db.firmadas_al_insertar
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
    ruta, _tam, overwrite = dobles.dbx.subidas[0]
    assert ruta.startswith(carpeta + "/") and ruta.endswith("_cotizacion.pdf")
    assert overwrite is False  # dos "cotizacion.pdf" no se pisan

    insert = next(p for q, p in db.sql if "INSERT INTO core.oc_attachments" in q)
    assert insert["p"] == ruta
    assert insert["d"] == "Cotización firmada"
    assert insert["m"] == "application/pdf"
    assert insert["uid"] == _USER.sub
    assert r.source == "manual_upload" and r.en_el_pdf is True
    # La fila se inserta con la OC BLOQUEADA (segunda lectura con FOR UPDATE).
    assert dobles.estado["llamadas"] == [False, True]
    assert dobles.dbx.borrados == []
    assert dobles.auditoria[0]["action"] == "create"


async def test_el_mime_guardado_es_el_verificado_no_el_del_navegador(dobles):
    db = _DB()
    r = await _subir(db, _archivo("plano.png", "application/octet-stream", _png()))
    assert r.mime_type == "image/png"


async def test_excel_se_guarda_pero_no_va_dentro_del_pdf(dobles):
    r = await _subir(_DB(), _archivo("presupuesto.xlsx", "application/octet-stream", _xlsx()))
    assert r.en_el_pdf is False


@pytest.mark.parametrize(
    "estado", ["firmada", "enviada_proveedor", "facturada", "pagada", "parcial", "anulada"]
)
async def test_fuera_de_borrador_emision_o_firma_no_se_agrega_ni_toca_dropbox(dobles, estado):
    dobles.estado["oc"] = {**_OC, "estado": estado}
    with pytest.raises(HTTPException) as e:
        await _subir(_DB(), _archivo())
    assert e.value.status_code == 409
    assert dobles.dbx.subidas == []


async def test_con_una_firma_puesta_ya_no_se_agrega(dobles):
    with pytest.raises(HTTPException) as e:
        await _subir(_DB(firmadas=1), _archivo())
    assert e.value.status_code == 409
    assert "Duplicar" in e.value.detail
    assert dobles.dbx.subidas == []


async def test_si_firman_mientras_se_sube_no_se_guarda_y_se_limpia_dropbox(dobles):
    db = _DB(firmadas=0, firmadas_al_insertar=1)
    with pytest.raises(HTTPException) as e:
        await _subir(db, _archivo())
    assert e.value.status_code == 409
    assert len(dobles.dbx.subidas) == 1
    assert dobles.dbx.borrados == [dobles.dbx.subidas[0][0]]
    assert not any("INSERT" in q for q, _ in db.sql)


async def test_si_falla_el_insert_se_borra_el_archivo_de_dropbox(dobles):
    db = _DB(falla_insert=True)
    with pytest.raises(RuntimeError):
        await _subir(db, _archivo())
    assert dobles.dbx.borrados == [dobles.dbx.subidas[0][0]]
    assert db.rollbacks == 1


async def test_techo_de_cantidad(dobles):
    with pytest.raises(HTTPException) as e:
        await _subir(_DB(anexos=oc_anexos._MAX_ANEXOS_POR_OC), _archivo())
    assert e.value.status_code == 409
    assert dobles.dbx.subidas == []


async def test_techo_total_por_oc(dobles):
    usado = oc_anexos._MAX_BYTES_TOTAL - 10
    with pytest.raises(HTTPException) as e:
        await _subir(_DB(bytes_usados=usado), _archivo())
    assert e.value.status_code == 409
    assert "no cabe" in e.value.detail
    assert dobles.dbx.subidas == []


async def test_archivo_vacio(dobles):
    with pytest.raises(HTTPException) as e:
        await _subir(_DB(), _archivo(contenido=b""))
    assert e.value.status_code == 400


async def test_archivo_demasiado_grande(dobles, monkeypatch):
    monkeypatch.setattr(oc_anexos, "_MAX_BYTES_ARCHIVO", 10)
    with pytest.raises(HTTPException) as e:
        await _subir(_DB(), _archivo())
    assert e.value.status_code == 413
    assert dobles.dbx.subidas == []


async def test_contenido_falso_no_llega_a_dropbox(dobles):
    with pytest.raises(HTTPException) as e:
        await _subir(_DB(), _archivo("x.pdf", "application/pdf", b"MZ\x90\x00 ejecutable"))
    assert e.value.status_code == 400
    assert dobles.dbx.subidas == []


async def test_dropbox_caido_da_502_y_no_inserta(dobles):
    def revienta(*a, **k):
        raise RuntimeError("dropbox down")

    dobles.dbx.upload_file = revienta
    db = _DB()
    with pytest.raises(HTTPException) as e:
        await _subir(db, _archivo())
    assert e.value.status_code == 502
    assert "dropbox down" not in e.value.detail  # sin detalle técnico al usuario
    assert not any("INSERT" in q for q, _ in db.sql)


# ──────────────────────────────────────────────────────────────────────
# Listar
# ──────────────────────────────────────────────────────────────────────


async def test_listar_dice_si_se_puede_modificar_y_por_que_no(dobles):
    r = await oc_anexos.listar_anexos(user=_USER, db=_DB(), oc_id=59)
    assert r.se_pueden_modificar is True and r.motivo_bloqueo is None
    r = await oc_anexos.listar_anexos(user=_USER, db=_DB(firmadas=2), oc_id=59)
    assert r.se_pueden_modificar is False
    assert "2 firmas puestas" in r.motivo_bloqueo


# ──────────────────────────────────────────────────────────────────────
# Quitar
# ──────────────────────────────────────────────────────────────────────


async def _quitar(db):
    return await oc_anexos.quitar_anexo(
        user=_USER, db=db, request=None, oc_id=59, attachment_id=7
    )


async def test_quitar_con_firmas_da_409(dobles):
    db = _DB(firmadas=1, fila_delete={"file_name": "a.pdf", "dropbox_path": "/x/a.pdf",
                                      "descripcion": None})
    with pytest.raises(HTTPException) as e:
        await _quitar(db)
    assert e.value.status_code == 409
    assert not any(q.strip().startswith("DELETE") for q, _ in db.sql)


async def test_quitar_borra_la_fila_audita_y_no_toca_dropbox(dobles):
    db = _DB(fila_delete={"file_name": "a.pdf", "dropbox_path": "/x/a.pdf",
                          "descripcion": "cotización"})
    r = await _quitar(db)
    assert r.status_code == 204
    assert any(q.strip().startswith("DELETE FROM core.oc_attachments") for q, _ in db.sql)
    assert dobles.estado["llamadas"] == [True]  # OC bloqueada
    assert dobles.dbx.borrados == []
    assert db.commits == 1
    assert dobles.auditoria[0]["before"]["dropbox_path"] == "/x/a.pdf"


async def test_quitar_inexistente_da_404(dobles):
    with pytest.raises(HTTPException) as e:
        await _quitar(_DB(fila_delete=None))
    assert e.value.status_code == 404
