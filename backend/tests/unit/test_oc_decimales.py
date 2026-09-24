"""El interruptor "con decimales / sin decimales" de la OC (2026-09-24).

Nicolás: "coloca un botón en las OC para elegir que salgan con decimales o
sin decimales".

La regla que estas pruebas cuidan: es SÓLO presentación del precio
unitario. Con TRUE y con FALSE la OC vale exactamente lo mismo — mismo
importe por línea, mismo neto, mismo IVA, mismo total. Si alguna vez el
interruptor mueve un peso, algo se rompió.
"""
from __future__ import annotations

import re
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

BACKEND = Path(__file__).resolve().parents[2]
R_FRONT = BACKEND.parent / "frontend"


# ──────────────────────────────────────────────────────────────────────
# El formateador del PDF
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("precio", "con_decimales", "esperado"),
    [
        ("67142.86", True, "$67.142,86"),
        ("67142.86", False, "$67.143"),      # redondea, no trunca
        ("420.17", False, "$420"),
        ("0.5", False, "$1"),                # HALF_UP, como el resto
        ("-1680.60", False, "-$1.681"),      # descuento: el signo adelante
        ("600000", True, "$600.000"),        # entero: igual en los dos modos
        ("600000", False, "$600.000"),
    ],
)
def test_el_interruptor_solo_cambia_como_se_ve_el_precio(precio, con_decimales, esperado):
    from app.services.oc_pdf_v2_service import _formatear_precio_unitario

    assert _formatear_precio_unitario(Decimal(precio), "CLP", con_decimales) == esperado


@pytest.mark.parametrize("moneda", ["UF", "USD"])
def test_fuera_de_pesos_los_centesimos_son_plata_y_no_se_apagan(moneda):
    """En UF y USD el interruptor se ignora: 12,45 no puede imprimirse 12."""
    from app.services.oc_pdf_v2_service import _formatear_precio_unitario

    con = _formatear_precio_unitario(Decimal("12.45"), moneda, True)
    sin = _formatear_precio_unitario(Decimal("12.45"), moneda, False)
    assert con == sin
    # UF usa coma decimal y USD punto (así venía el PDF); lo que importa acá
    # es que los centésimos siguen impresos con el interruptor apagado.
    assert "12,45" in con or "12.45" in con


def test_el_default_del_formateador_sigue_siendo_con_decimales():
    from app.services.oc_pdf_v2_service import _formatear_precio_unitario

    assert _formatear_precio_unitario(Decimal("67142.86"), "CLP") == "$67.142,86"


def test_el_helper_del_template_queda_atado_a_la_oc():
    """`_load_context` no es testeable barato (es async y dispara 6 queries
    con fallbacks), así que el cableado vive en una función con nombre y se
    prueba acá. Lo único que queda por grep es la linea que la llama."""
    from app.services.oc_pdf_v2_service import _helper_precio_unitario

    assert _helper_precio_unitario(True)(Decimal("67142.86"), "CLP") == "$67.142,86"
    assert _helper_precio_unitario(False)(Decimal("67142.86"), "CLP") == "$67.143"
    # Columna ausente (ventana pre-migración) o NULL: como siempre.
    assert _helper_precio_unitario(None)(Decimal("67142.86"), "CLP") == "$67.142,86"
    # Y en UF no se apaga aunque la OC diga que no.
    assert _helper_precio_unitario(False)(Decimal("12.45"), "UF") == "UF 12,45"


def test_el_pdf_ata_el_helper_a_la_bandera_de_la_oc():
    fuente = (BACKEND / "app/services/oc_pdf_v2_service.py").read_text(encoding="utf-8")
    assert 'presentacion.get("mostrar_decimales")' in fuente
    assert "_helper_precio_unitario(" in fuente


def test_los_templates_llaman_al_helper_con_dos_argumentos():
    """El servicio ata `con_decimales` con functools.partial (keyword). Si un
    template pasara un TERCER posicional, el render moriría con "multiple
    values for argument" — y el PDF de esa empresa deja de salir."""
    plantillas = list((BACKEND / "app/templates/oc/documents").glob("orden_compra*.html"))
    assert plantillas, "no se encontraron templates de OC"
    llamadas = []
    for t in plantillas:
        llamadas += re.findall(
            r"formatear_precio_unitario\(([^)]*)\)", t.read_text(encoding="utf-8")
        )
    assert llamadas, "ningún template usa formatear_precio_unitario"
    for args in llamadas:
        assert args.count(",") == 1, f"formatear_precio_unitario({args}): sobra un argumento"


# ──────────────────────────────────────────────────────────────────────
# La vista imprimible (Ctrl+P) tiene que verse igual que el PDF
# ──────────────────────────────────────────────────────────────────────


def _html_oc(mostrar_decimales: bool) -> str:
    from app.services.report_renderer_service import render_orden_compra_html

    return render_orden_compra_html(
        oc={
            "numero_oc": "OC0059-PAN001",
            "empresa_codigo": "PANIMAVIDA",
            "fecha_emision": "2026-09-22",
            "moneda": "CLP",
            "tipo_documento": "FACTURA",
            "neto": Decimal("336387"),
            "iva": Decimal("63914"),
            "total": Decimal("400301"),
            "total_a_pagar": Decimal("400301"),
            "retencion_porcentaje": Decimal("0"),
            "retencion_monto": Decimal("0"),
            "estado": "emitida",
            "mostrar_decimales": mostrar_decimales,
        },
        items=[
            {"item": 1, "descripcion": "Termofusora", "cantidad": Decimal("2"),
             "precio_unitario": Decimal("67142.86"), "total_linea": Decimal("134286")},
            {"item": 5, "descripcion": "Codo PPR 32", "cantidad": Decimal("19"),
             "precio_unitario": Decimal("420.17"), "total_linea": Decimal("7983")},
        ],
        empresa={},
        proveedor=None,
    )


def test_la_vista_imprimible_apaga_los_decimales_cuando_la_oc_lo_pide():
    html = _html_oc(False)
    assert "$67.143" in html and "$67.142,86" not in html
    assert "$420" in html and "$420,17" not in html


def test_la_vista_imprimible_los_muestra_por_defecto():
    assert "$67.142,86" in _html_oc(True)


def test_apagar_los_decimales_no_mueve_un_peso():
    """Lo único que cambia entre los dos HTML es el precio unitario: los
    importes de las líneas y los totales son idénticos."""
    con, sin = _html_oc(True), _html_oc(False)
    for monto in ("$134.286", "$7.983", "$336.387", "$63.914", "$400.301"):
        assert monto in con, monto
        assert monto in sin, monto


def test_sin_la_clave_se_imprime_como_siempre():
    """Ventana entre el deploy y el SQL aplicado a mano: sin la columna, con
    decimales (que es como quedó el documento el 2026-09-22)."""
    from app.services.report_renderer_service import render_orden_compra_html

    html = render_orden_compra_html(
        oc={"numero_oc": "OC-X", "moneda": "CLP", "estado": "emitida",
            "neto": Decimal("100"), "iva": Decimal("19"), "total": Decimal("119"),
            "total_a_pagar": Decimal("119"), "tipo_documento": "FACTURA"},
        items=[{"item": 1, "descripcion": "x", "cantidad": Decimal("1"),
                "precio_unitario": Decimal("100.50"), "total_linea": Decimal("101")}],
        empresa={},
    )
    assert "$100,50" in html


# ──────────────────────────────────────────────────────────────────────
# Modelo, schemas y persistencia
# ──────────────────────────────────────────────────────────────────────


def test_el_modelo_y_los_schemas_exponen_la_bandera():
    from app.models.orden_compra import OrdenCompra
    from app.schemas.orden_compra import (
        OcFormatoUpdate,
        OrdenCompraCreate,
        OrdenCompraRead,
        OrdenCompraUpdate,
    )

    assert "mostrar_decimales" in OrdenCompra.__table__.columns
    assert OrdenCompraCreate.model_fields["mostrar_decimales"].default is True
    assert OrdenCompraRead.model_fields["mostrar_decimales"].default is True
    assert OrdenCompraUpdate.model_fields["mostrar_decimales"].default is None
    assert OcFormatoUpdate(mostrar_decimales=False).mostrar_decimales is False


def test_un_false_explicito_sobrevive_al_patch():
    """`exclude_unset`: False tiene que persistirse; None es "no me pronuncio"."""
    from app.schemas.orden_compra import OrdenCompraUpdate

    assert OrdenCompraUpdate(mostrar_decimales=False).model_dump(exclude_unset=True) == {
        "mostrar_decimales": False
    }
    assert OrdenCompraUpdate().model_dump(exclude_unset=True) == {}


async def test_un_null_explicito_no_tumba_la_columna_not_null():
    """`{"mostrar_decimales": null}` en el PATCH general no puede escribir
    NULL: la columna es NOT NULL y el operador vería un 500 sin explicación."""
    from app.infrastructure.repositories.orden_compra_repository import (
        OrdenCompraRepository,
    )
    from app.schemas.orden_compra import OrdenCompraUpdate

    class _Sesion:
        async def flush(self):
            return None

        async def refresh(self, obj):
            return None

    oc = SimpleNamespace(mostrar_decimales=False, incluye_condiciones=False)
    repo = OrdenCompraRepository(_Sesion())
    await repo.update_fields(oc, OrdenCompraUpdate.model_validate(
        {"mostrar_decimales": None, "incluye_condiciones": None}
    ))
    assert oc.mostrar_decimales is False
    assert oc.incluye_condiciones is False


def test_la_api_devuelve_las_dos_banderas_de_como_se_imprime():
    """`incluye_condiciones` nunca se devolvía (bug preexistente): la API
    respondía el default True del schema, así que el formulario de edición
    mostraba la casilla marcada en una OC que se imprime sin cláusulas."""
    from datetime import date, datetime

    from app.api.v1.ordenes_compra import _to_read

    oc = SimpleNamespace(
        oc_id=1, numero_oc="OC-1", empresa_codigo="PANIMAVIDA", proveedor_id=None,
        fecha_emision=date(2026, 9, 24), validez_dias=30, moneda="CLP",
        neto=Decimal("100"), iva=Decimal("19"), total=Decimal("119"),
        forma_pago=None, plazo_pago=None, plazo_entrega=None, observaciones=None,
        proveedor_contacto_id=None, atte_nombre=None, atte_cargo=None,
        tipo_documento="FACTURA", iva_porcentaje=Decimal("19"),
        retencion_porcentaje=Decimal("0"), retencion_monto=Decimal("0"),
        total_a_pagar=Decimal("119"), estado="emitida", pdf_url=None, items=[],
        created_at=datetime(2026, 9, 24), updated_at=datetime(2026, 9, 24),
        pago_sin_firmas=None, mostrar_decimales=False, incluye_condiciones=False,
    )
    leido = _to_read(SimpleNamespace(has_scope=lambda _s: False), oc)
    assert leido.mostrar_decimales is False
    assert leido.incluye_condiciones is False

    # Y una OC normal sigue diciendo True en las dos.
    oc.mostrar_decimales = True
    oc.incluye_condiciones = True
    leido = _to_read(SimpleNamespace(has_scope=lambda _s: False), oc)
    assert leido.mostrar_decimales is True
    assert leido.incluye_condiciones is True


def test_el_alta_deja_elegir_el_formato_desde_el_principio():
    """Emitir 10 OC por semana y entrar a cada ficha a apagar el interruptor
    no es una respuesta: la casilla está en el formulario de alta."""
    nueva = (
        R_FRONT / "app/(app)/ordenes-compra/nueva/page.tsx"
    ).read_text(encoding="utf-8")
    assert "mostrar_decimales: mostrarDecimales" in nueva
    assert "Precio unitario con decimales" in nueva


def test_el_duplicado_hereda_como_se_imprime_el_original():
    fuente = (BACKEND / "app/api/v1/ordenes_compra.py").read_text(encoding="utf-8")
    bloque = fuente.split("duplicate_payload = OrdenCompraCreate(")[1].split(")\n")[0]
    assert "mostrar_decimales=" in bloque
    assert "incluye_condiciones=" in bloque


# ──────────────────────────────────────────────────────────────────────
# El endpoint
# ──────────────────────────────────────────────────────────────────────


class _Repo:
    """Doble de OrdenCompraRepository: se instancia con (db) y devuelve la OC."""

    def __init__(self, oc):
        self._oc = oc

    def __call__(self, db):
        return self

    async def get(self, oc_id):
        return self._oc


class _Db:
    def __init__(self):
        self.commits = 0

    async def commit(self):
        self.commits += 1


def _preparar(monkeypatch, oc):
    """Aísla el endpoint de la BD: repo, scope de empresa, auditoría y lectura."""
    from app.api.v1 import ordenes_compra as mod

    auditoria: list[dict] = []
    monkeypatch.setattr(mod, "OrdenCompraRepository", _Repo(oc))

    async def _sin_scope(*a, **k):
        return None

    async def _audit(db, request, user, **kw):
        auditoria.append(kw)

    async def _leer(db, user, fila):
        return fila

    monkeypatch.setattr(mod, "assert_empresa_access", _sin_scope)
    monkeypatch.setattr(mod, "audit_log", _audit)
    monkeypatch.setattr(mod, "_to_read_con_unidades", _leer)
    return mod, auditoria


async def test_una_oc_anulada_no_se_retoca(monkeypatch):
    from app.schemas.orden_compra import OcFormatoUpdate

    oc = SimpleNamespace(oc_id=7, numero_oc="OC-7", empresa_codigo="PANIMAVIDA",
                         estado="anulada", mostrar_decimales=True)
    mod, _ = _preparar(monkeypatch, oc)
    with pytest.raises(HTTPException) as exc:
        await mod.update_formato_oc(
            user=SimpleNamespace(), db=_Db(), request=None, oc_id=7,
            body=OcFormatoUpdate(mostrar_decimales=False),
        )
    assert exc.value.status_code == 409
    assert oc.mostrar_decimales is True


@pytest.mark.parametrize("estado", ["borrador", "en_firma", "firmada", "pagada"])
async def test_funciona_donde_el_patch_general_esta_cerrado(monkeypatch, estado):
    """`_OC_EDITABLE_ESTADOS` es emitida/parcial. Esto no es una edición de la
    OC —no mueve plata—, y una OC en borrador o ya pagada también se imprime."""
    from app.schemas.orden_compra import OcFormatoUpdate

    oc = SimpleNamespace(oc_id=7, numero_oc="OC-7", empresa_codigo="PANIMAVIDA",
                         estado=estado, mostrar_decimales=True)
    mod, auditoria = _preparar(monkeypatch, oc)
    db = _Db()
    await mod.update_formato_oc(
        user=SimpleNamespace(), db=db, request=None, oc_id=7,
        body=OcFormatoUpdate(mostrar_decimales=False),
    )
    assert oc.mostrar_decimales is False
    assert db.commits == 1
    assert auditoria and auditoria[0]["before"] == {"mostrar_decimales": True}
    assert auditoria[0]["after"] == {"mostrar_decimales": False}
    assert "sin decimales" in auditoria[0]["summary"]


async def test_el_mismo_valor_no_escribe_ni_audita(monkeypatch):
    """Doble click: sin cambio no hay commit ni entrada de auditoría."""
    from app.schemas.orden_compra import OcFormatoUpdate

    oc = SimpleNamespace(oc_id=7, numero_oc="OC-7", empresa_codigo="PANIMAVIDA",
                         estado="emitida", mostrar_decimales=True)
    mod, auditoria = _preparar(monkeypatch, oc)
    db = _Db()
    await mod.update_formato_oc(
        user=SimpleNamespace(), db=db, request=None, oc_id=7,
        body=OcFormatoUpdate(mostrar_decimales=True),
    )
    assert db.commits == 0
    assert auditoria == []


async def test_una_oc_que_no_existe_da_404(monkeypatch):
    from app.schemas.orden_compra import OcFormatoUpdate

    mod, _ = _preparar(monkeypatch, None)
    with pytest.raises(HTTPException) as exc:
        await mod.update_formato_oc(
            user=SimpleNamespace(), db=_Db(), request=None, oc_id=999,
            body=OcFormatoUpdate(mostrar_decimales=False),
        )
    assert exc.value.status_code == 404


# ──────────────────────────────────────────────────────────────────────
# Migración
# ──────────────────────────────────────────────────────────────────────


def test_la_migracion_esta_registrada_y_sin_metacomandos():
    sql = BACKEND / "scripts/sql/oc_mostrar_decimales_2026_09.sql"
    assert sql.exists()
    texto = sql.read_text(encoding="utf-8")
    assert (
        "ADD COLUMN IF NOT EXISTS mostrar_decimales BOOLEAN NOT NULL DEFAULT TRUE"
        in texto
    )
    for linea in texto.splitlines():
        assert not linea.strip().startswith("\\set"), linea
    runner = (BACKEND / "scripts/apply_pending_migrations.py").read_text(encoding="utf-8")
    assert "oc_mostrar_decimales_2026_09.sql" in runner


def test_las_banderas_de_formato_no_viajan_en_el_select_de_la_plata():
    """El SELECT principal del PDF tiene un fallback reducido que NO trae las
    columnas de retención: si una columna de FORMATO lo hace fallar (la BD
    todavía sin migrar), una OC de honorarios deja de emitir PDF por culpa de
    cómo se imprime un precio. Las banderas se leen en su propia query."""
    fuente = (BACKEND / "app/services/oc_pdf_v2_service.py").read_text(encoding="utf-8")
    # Los dos SELECT de cabecera: el completo y el reducido del except.
    for trozo in fuente.split("SELECT oc_id, numero_oc")[1:]:
        columnas = trozo.split("FROM core.ordenes_compra")[0]
        assert "mostrar_decimales" not in columnas, columnas
        assert "incluye_condiciones" not in columnas, columnas
    assert (
        "SELECT incluye_condiciones, mostrar_decimales" in fuente
    ), "las banderas de formato tienen que leerse aparte"
    assert 'presentacion.get("incluye_condiciones") is not False' in fuente
    assert 'presentacion.get("mostrar_decimales") is not False' in fuente
