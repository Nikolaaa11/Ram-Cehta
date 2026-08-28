"""Vista previa LOCAL del PDF de la Orden de Compra, sin WeasyPrint.

Por qué existe: WeasyPrint no corre en Windows sin GTK/Pango, así que en la
máquina de desarrollo no hay forma de ver el PDF sin deployar a Fly. Esto
renderiza el mismo template Jinja con datos realistas y lo pagina con
Chromium headless (via Playwright, que ya está instalado para los E2E).

⚠️ NO es WeasyPrint. Chromium soporta MÁS CSS que WeasyPrint 63, así que
sirve para juzgar diseño, jerarquía tipográfica y paginación, pero NO
garantiza que algo se vea igual en producción. Reglas para que la vista
previa sea representativa:
  · Nada de flex ni grid (WeasyPrint 63 no los implementa completos).
  · Nada de `gap`, `aspect-ratio`, `clamp()`, custom properties en @page.
  · Tablas y bloques, que es lo que WeasyPrint pagina de forma predecible.

Uso:
    python scripts/preview_oc.py                       # escenario por defecto (RHO)
    python scripts/preview_oc.py --escenario afis      # otra empresa/logo
    python scripts/preview_oc.py --escenario ciclo     # el FIP: logo apaisado + ficha propia
    python scripts/preview_oc.py --items 25            # OC larga, para ver el corte
    python scripts/preview_oc.py --tipo honorarios     # bloque de totales con retención
    python scripts/preview_oc.py --tipo exenta         # factura exenta (sin fila de IVA)
    python scripts/preview_oc.py --moneda uf           # importes en UF (con decimales)

Deja el PDF y un PNG por página en scripts/_preview_oc/.
"""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND))

from app.domain.value_objects.iva import paso_de_moneda  # noqa: E402
from app.services.oc_pdf_v2_service import (  # noqa: E402
    _LOGOS_DIR,
    _env,
    _fecha_larga,
    _firma_font_data_uri,
    _formatear_moneda,
    _logo_data_uri,
    _logo_max_css,
    _logo_raw_bytes,
    _qr_placeholder_svg,
)

_OUT = Path(__file__).resolve().parent / "_preview_oc"
_DOCUMENTS = _BACKEND / "app" / "templates" / "oc" / "documents"


def _obj(**kw):
    """Objeto anónimo: el template accede por atributo, no por clave."""
    return type("Ctx", (), kw)()


ESCENARIOS = {
    # (codigo_empresa, razon_social, color) — el logo sale del código.
    "rho": ("RHO", "Rho Generación SpA", "#1A793B"),
    "afis": ("AFIS", "AFIS SpA", "#1F2937"),
    # CICLO es INVERSIONES CICLO CAPITAL SPA, la sociedad que OPERA bajo el
    # Fondo de Inversión Privado Ciclo Capital. El alta original describía al
    # fondo; Nicolás confirmó (2026-08-17, con el e-RUT a la vista) que la que
    # emite las OC es la SpA. Son dos personas jurídicas distintas y el bloque
    # Mandante lleva la que contrata.
    #
    # Su color es #111111 porque su logotipo es negro sobre blanco: darle el
    # verde institucional que trae por DEFAULT la columna
    # `empresas.oc_color_primario` dejaría un filete verde cerrando un logo
    # negro. La razón social va COMPLETA y literal — es la que se imprime en el
    # bloque Mandante de un documento que firma un tercero.
    "ciclo": ("CICLO", "Inversiones Ciclo Capital SpA", "#111111"),
    # TECMAVIDA es Tecnologia y Ecomateriales SpA — "tecmavida" es el nombre
    # de fantasia, la razon social es la que va en el bloque Mandante.
    #
    # El color NO es el verde de marca (#91cc7a). Ese verde da 1,89:1 de
    # contraste sobre blanco y el template lo usa para el TOTAL y para los
    # filetes de seccion: el numero mas importante del documento saldria
    # ilegible. #42762d es el MISMO verde —tono 103°, saturacion 45%— bajado
    # a 32% de luminosidad: 5,44:1, casi identico al verde de RHO (5,47:1)
    # que ya se lee bien en papel. El logotipo conserva los colores exactos
    # de la marca; lo que se ajusta es el color de tinta del documento.
    "tecmavida": ("TECMAVIDA", "Tecnología y Ecomateriales SpA", "#42762d"),
    "dte": ("DTE", "DTE Consulting & Development SpA", "#0A3A6B"),
    "revtech": ("REVTECH", "Revtech SpA", "#D97706"),
    "trongkai": ("TRONGKAI", "Trongkai SpA", "#2E7D32"),
    "sin-logo": ("PANIMAVIDA", "Panimávida Energy SpA", "#1A793B"),
}

# Logos que este banco carga a mano desde templates/oc/logos/.
#
# Por qué hace falta: `_logo_raw_bytes(codigo, None)` resuelve el archivo local
# por el dict `_LOGO_LOCAL` de oc_pdf_v2_service, y CICLO todavía NO está en ese
# dict. Sin esto la vista previa del fondo saldría con el wordmark tipográfico
# en vez del logo y no probaría nada de lo que se vino a probar.
#
# Pasar los bytes a mano NO disimula el hueco: reproduce producción. Ahí el logo
# llega por HTTP desde `empresas.logo_dropbox_path`
# (https://cehta-capital.vercel.app/logos/ciclo.png), o sea que `logo_bytes` ya
# viene lleno y el dict local ni se consulta. Ese dict es la RED para cuando el
# fetch falla (cold start de Fly, miss del CDN de Vercel) y hoy no cubre a
# CICLO — queda reportado, no se arregla acá: el servicio está fuera de la lista
# de archivos de este agente.
_LOGO_PRECARGADO: dict[str, str] = {
    "CICLO": "ciclo.png",
    "TECMAVIDA": "tecmavida.png",
}


def _logo_del_escenario(codigo: str) -> bytes | None:
    """Bytes del logo, por el mismo camino que producción."""
    fname = _LOGO_PRECARGADO.get(codigo.upper())
    # Si el archivo no estuviera, que reviente acá y no que imprima un PDF sin
    # logo: en un banco de vista previa el silencio es lo único inservible.
    precargado = (_LOGOS_DIR / fname).read_bytes() if fname else None
    return _logo_raw_bytes(codigo, precargado)


# Ficha del MANDANTE y redacción del encargo, por código de empresa.
#
# Hasta ahora el banco imprimía SIEMPRE los datos de RHO y sólo variaba código,
# razón social y color: alcanzaba, porque los escenarios existentes son pruebas
# de logo, de color y de paginación. CICLO no entra en esa categoría — su
# dirección y su sitio salen impresos en el bloque Mandante y en el pie de TODAS
# las páginas, así que tienen que ser los de su ficha
# (docs/DATOS_CICLO_CAPITAL.md) y no los de una constructora de Providencia.
#
# Lo que está marcado FALTA en la ficha va en None y se queda en None: el
# template omite la fila entera cuando el dato es falsy, que es exactamente el
# comportamiento buscado. Un RUT inventado en el Mandante de una OC firmada no
# es un dato de relleno, es un documento falso.
_FICHA_DEFAULT: dict = {
    "rut": "77.931.386-7",
    "giro": "Ingeniería y construcción",
    "direccion": "General del Canto 50 Of 301",
    "ciudad": "Providencia",
    "telefono": "+56 2 2345 6789",
    "pagina_web": "rhogeneracion.com",
    "representante_legal": "Javier Álvarez Abarca",
    "firmantes": None,   # None = usa la nómina de firmantes de muestra
    # Observación de VARIAS LÍNEAS a propósito. Es el caso real: de las tres
    # observaciones que hay escritas en producción, dos son listas cortas
    # ("- Proyecto Ptec / - CC BANCO CHILE 11125365"). Con una sola línea de
    # muestra no se vería si `white-space: pre-line` está conservando los
    # saltos que el operador tecleó en el textarea.
    "observaciones": ("Se utilizó valor de UF del día 17-08-2026.\n"
                      "Proyecto Panimávida — CC Banco de Chile 11125365.\n"
                      "Los precios unitarios incluyen traslados a faena."),
    "hitos": ("Anticipo al inicio de la obra", "Contra entrega conforme"),
}

FICHAS: dict[str, dict] = {
    "TECMAVIDA": {
        # e-RUT 78343203-K, serie 202608636254, emitido 23-07-2026.
        "rut": "78.343.203-K",
        # Glosa literal del e-RUT y de la declaracion de inicio de
        # actividades (folio 16657040, 20-07-2026). No se resume.
        "giro": "Valorización de residuos industriales sólidos no peligrosos",
        # Casa matriz declarada al SII. Es el MISMO predio que Panimavida
        # Energy: Panimavida PC 3 Lote 3, rol 209-96, arrendado.
        "direccion": "Panimávida PC 3 Lote 3",
        "ciudad": "Colbún",
        "telefono": "+56 9 8266 8731",
        # FALTA: no hay sitio declarado en ningun documento. El pie del PDF
        # omite la fila cuando es falsy.
        "pagina_web": None,
        # Constituyente y unico administrador segun el extracto del Diario
        # Oficial N°44.342 del 07-01-2026 (escritura 22-12-2025, repertorio
        # 4345-2025, Notaria de Talca de Pablo Andres Almendras Burgos).
        "representante_legal": "José Antonio Maturana Coronado",
        "firmantes": [{"nombre": "José Antonio Maturana Coronado",
                       "cargo": "Representante Legal"}],
        "observaciones": ("Servicios contratados para la operación de "
                          "valorización de residuos en planta Panimávida."),
        "hitos": ("Anticipo a la firma de la orden",
                  "Contra recepción conforme en planta"),
    },
    "CICLO": {
        # e-RUT serie 202608549755, emitido 18/06/2026. Es el de la SPA, no el
        # del fondo: el RUT del Fondo de Inversión Privado sigue marcado FALTA
        # en la ficha (§1) y sigue sin inventarse — pero el que se imprime en
        # una OC es el de quien contrata, y quien contrata es la SpA.
        "rut": "78.447.248-5",
        # El e-RUT trae la "GLOSA DE ACTIVIDAD ECONÓMICA" **en blanco**, así que
        # no hay giro que copiar. El que había describía al fondo (Cap. V Ley
        # 20.712) y para la SpA sería falso. El template omite la fila entera
        # cuando el dato es falsy: un giro equivocado en un documento
        # tributario es peor que ninguno.
        "giro": None,
        "direccion": "Av. Américo Vespucio Sur 80, Oficina 31",
        "ciudad": "Las Condes",
        # FALTA en la ficha: teléfono.
        "telefono": None,
        # Único sitio verificado de la ficha (§3 · Plataforma). El dominio
        # ciclocapital.cl aparece SÓLO en los correos, nunca declarado como web:
        # ponerlo acá sería deducirlo, no leerlo.
        "pagina_web": "fondo-ciclo.vercel.app",
        # Usuario declarado del e-RUT y, según Nicolás, administrador de todo
        # Ciclo. La PERSONERÍA (escritura + notaría) sigue FALTA en la ficha:
        # ser usuario de un e-RUT no prueba la representación legal.
        "representante_legal": "Juan Pablo Velasco García",
        # Un solo firmante, que es lo que hay cargado hoy en la empresa. NO se
        # usa la nómina de muestra: rellenar con los firmantes de RHO haría que
        # la vista previa mintiera justo sobre el dato que la ficha marca como
        # incompleto.
        "firmantes": [{"nombre": "Juan Pablo Velasco García",
                       "cargo": "Gerente General"}],
        # Redacción con el verbo que la ley admite: "pactadas", nunca
        # "garantizadas" (art. 61 Ley 18.045). El texto de muestra tiene que
        # poder copiarse tal cual a una OC real sin generar un hallazgo legal.
        "observaciones": ("Servicios contratados para la operación de "
                          "financiamiento inmobiliario individualizada en el "
                          "expediente respectivo, conforme a las condiciones "
                          "pactadas entre las partes.\n"
                          "Se utilizó valor de UF del día 17-08-2026."),
        "hitos": ("Anticipo a la firma de la orden",
                  "Contra entrega del informe conforme"),
    },
}

# Cada ficha declara TODAS las claves: se usa `FICHAS[codigo]` entera, sin merge
# contra el default. Con merge, una clave olvidada caería en silencio a los datos
# de RHO, y la dirección de otra empresa impresa en el bloque Mandante es
# exactamente el error que este dict existe para evitar. Que falte una clave
# tiene que romper al importar el módulo y no a mitad de un render.
for _cod, _f in FICHAS.items():
    _faltan = sorted(set(_FICHA_DEFAULT) - set(_f))
    if _faltan:
        raise RuntimeError(f"ficha {_cod}: faltan las claves {_faltan}")

# Monedas del banco. Son las dos que hay que mirar en el papel: el peso NO tiene
# centavos y la UF SÍ, y el bloque de totales es donde se ve si el paso de
# redondeo está bien elegido. CICLO opera en UF, así que para el fondo la
# corrida en UF no es un extra sino el caso principal.
MONEDAS = ("CLP", "UF")

# Itemizados de muestra. Se eligen por DOS ejes:
#   · por FICHA   — qué compra esa empresa. Un fondo de inversión no contrata
#     movimiento de tierras: si el itemizado no habla del mismo negocio que la
#     observación de arriba, el documento se contradice a sí mismo y el que lo
#     revisa deja de confiar en la vista previa entera.
#   · por MONEDA  — cada catálogo trae sus precios en pesos y en UF, y no uno
#     convertido del otro. Un tipo de cambio inventado no aportaría nada y las
#     cifras en pesos leídas como UF serían absurdas (2.925.000 UF ≈ 117 mil
#     millones de pesos), con lo que no se podría juzgar ni el ancho de las
#     columnas ni el corte de página.
# Los precios en UF llevan decimales NO redondos a propósito: un ,00 en cada
# fila no probaría que el paso de redondeo decimal esté funcionando.
# Son montos de muestra — el banco entero es data sintética. Lo que no se
# inventa son los datos identificatorios del mandante, que salen de su ficha.
_Item = tuple[str, str, Decimal, Decimal]

_ITEMS_OBRA: dict[str, list[_Item]] = {
    "CLP": [
        ("Instalación de fosa séptica, cámaras de inspección y drenes",
         "Gl", Decimal(1), Decimal(2_925_000)),
        ("Apoyo de retroexcavadora", "Días", Decimal(3), Decimal(240_000)),
        # Línea de DESCUENTO (precio negativo): existe desde que la OC admite
        # restar. Va tercera para que `--items 3` la incluya y se VEA cómo
        # imprime el PDF un monto negativo en la columna de totales.
        ("Descuento por anticipo de obra", "Gl", Decimal(1), Decimal(-450_000)),
        ("Suministro e instalación de tubería HDPE 110mm",
         "ml", Decimal(120), Decimal(8_400)),
        ("Movimiento de tierras y compactación de plataforma",
         "m3", Decimal(45), Decimal(32_000)),
        ("Ensayo de compactación Proctor modificado",
         "Un", Decimal(6), Decimal(95_000)),
    ],
    "UF": [
        ("Instalación de fosa séptica, cámaras de inspección y drenes",
         "Gl", Decimal(1), Decimal("78.40")),
        ("Apoyo de retroexcavadora", "Días", Decimal(3), Decimal("6.45")),
        ("Suministro e instalación de tubería HDPE 110mm",
         "ml", Decimal(120), Decimal("0.23")),
        ("Movimiento de tierras y compactación de plataforma",
         "m3", Decimal(45), Decimal("0.86")),
        ("Ensayo de compactación Proctor modificado",
         "Un", Decimal(6), Decimal("2.55")),
    ],
}

# Servicios que un FIP inmobiliario sí contrata: los del expediente de una
# operación de compraventa con pacto de retroventa.
_ITEMS_FONDO: dict[str, list[_Item]] = {
    "CLP": [
        ("Tasación comercial de inmueble urbano",
         "Un", Decimal(1), Decimal(1_060_000)),
        ("Estudio de títulos e informe de dominio vigente",
         "Gl", Decimal(1), Decimal(1_700_000)),
        ("Gastos notariales e inscripción en el Conservador",
         "Gl", Decimal(1), Decimal(2_320_000)),
        ("Inspección técnica en terreno", "Mes", Decimal(3), Decimal(1_270_000)),
        ("Custodia y administración documental",
         "Mes", Decimal(12), Decimal(155_000)),
    ],
    "UF": [
        ("Tasación comercial de inmueble urbano",
         "Un", Decimal(1), Decimal("28.50")),
        ("Estudio de títulos e informe de dominio vigente",
         "Gl", Decimal(1), Decimal("45.75")),
        ("Gastos notariales e inscripción en el Conservador",
         "Gl", Decimal(1), Decimal("62.30")),
        ("Inspección técnica en terreno", "Mes", Decimal(3), Decimal("34.20")),
        ("Custodia y administración documental",
         "Mes", Decimal(12), Decimal("4.15")),
    ],
}

# Qué catálogo le toca a cada empresa. Va acá y no dentro de `FICHAS` sólo
# porque los catálogos se definen más abajo que las fichas; se lee igual y se
# actualiza en el mismo lugar donde se agrega el catálogo nuevo.
_ITEMS_POR_EMPRESA: dict[str, dict[str, list[_Item]]] = {"CICLO": _ITEMS_FONDO}

# Los 4 tipos de documento que la OC sabe emitir, en la forma en que los
# guarda `core.ordenes_compra.tipo_documento` (tokens del catálogo SII).
# La clave del dict es sólo el atajo de línea de comandos.
#   flag → (token, iva_porcentaje, retencion_porcentaje)
# La retención de 2026 es 15,25% (Art. 74 N°2 LIR, escala de la Ley 21.133).
# Acá va literal a propósito: esto es un banco de vista previa, no el motor —
# en la aplicación la tasa se lee de core.tax_config por fecha de emisión.
TIPOS = {
    "factura":    ("FACTURA",        Decimal("19.00"), Decimal("0")),
    "boleta":     ("BOLETA",         Decimal("19.00"), Decimal("0")),
    "exenta":     ("FACTURA_EXENTA", Decimal("0"),     Decimal("0")),
    "honorarios": ("HONORARIOS",     Decimal("0"),     Decimal("15.25")),
}


def _redondear(monto: Decimal, paso: Decimal) -> Decimal:
    """Redondeo al paso de la moneda, ROUND_HALF_UP — igual que `calcular_iva`.

    Dos criterios, los dos importan:

    · El PASO lo decide la moneda y lo trae `paso_de_moneda` del value object de
      IVA, no una constante local: el peso redondea a 1 y la UF a 0,01. Fijar el
      paso en 1 acá haría que la vista previa en UF mostrara un IVA entero donde
      el servidor guarda dos decimales, y una OC de 288,95 UF perdería casi
      media UF (~$17.000) en la diferencia.
    · ROUND_HALF_UP y no `round()`, que usa banker's rounding (redondea .5 al
      par): con él la vista previa mostraría cifras que difieren en $1 de las
      que calcula el servidor. En un banco cuyo trabajo es verificar un
      documento de plata, ese peso de diferencia es exactamente lo que hace
      dudar.
    """
    return Decimal(monto).quantize(paso, rounding=ROUND_HALF_UP)


def construir_contexto(
    escenario: str, n_items: int, folio: str, tipo: str, moneda: str,
    incluye_condiciones: bool = True,
) -> dict:
    codigo, razon, color = ESCENARIOS[escenario]
    ficha = FICHAS.get(codigo, _FICHA_DEFAULT)
    raw = _logo_del_escenario(codigo)
    # El paso de redondeo se calcula UNA vez y se usa en todas las cifras del
    # documento (IVA, retención, hitos). Si cada bloque eligiera el suyo, la
    # suma de los hitos dejaría de cerrar contra el total.
    paso = paso_de_moneda(moneda)

    items = []
    base = _ITEMS_POR_EMPRESA.get(codigo, _ITEMS_OBRA)[moneda]
    for i in range(n_items):
        desc, un, cant, pu = base[i % len(base)]
        items.append(
            _obj(
                numero=i + 1,
                articulo=desc[:60],
                descripcion=desc,
                unidad=un,
                cantidad=cant,
                precio_unitario=pu,
                total=cant * pu,
                plazo=None,
            )
        )
    # Aritmética por tipo, la misma de la §3 del contrato:
    #   FACTURA/BOLETA  total = neto + IVA           · sin retención
    #   FACTURA_EXENTA  total = neto (IVA forzado 0) · sin retención
    #   HONORARIOS      total = neto = BRUTO, IVA 0  · líquido = total − retención
    # El líquido se obtiene POR RESTA y no redondeando aparte, para que
    # `total_a_pagar + retencion_monto == total` cierre exacto.
    token, iva_pct, ret_pct = TIPOS[tipo]
    neto = _redondear(sum((i.total for i in items), Decimal(0)), paso)
    iva = _redondear(neto * iva_pct / 100, paso)
    total = neto + iva
    retencion = _redondear(neto * ret_pct / 100, paso)
    total_a_pagar = total - retencion

    firmantes_muestra = [
        {"nombre": "Javier Álvarez Abarca", "cargo": "Gerente General",
         "firmado_el": "29/07/2026 20:35 UTC", "hash_corto": "2ec7f0535fd3",
         "firma_visual": "Javier Alvarez", "empresa_firmante": None},
        {"nombre": "Victoria Álvarez Abarca", "cargo": "Administración y Finanzas",
         "firmado_el": "29/07/2026 20:35 UTC", "hash_corto": "af38539f9067",
         "firma_visual": "Victoria Álvarez", "empresa_firmante": None},
        {"nombre": "Javiera Vargas Ríos", "cargo": "Líder Coordinación de Proyectos",
         "firmado_el": "29/07/2026 20:35 UTC", "hash_corto": "d8d06aaca595",
         "firma_visual": "Javiera Vargas", "empresa_firmante": None},
        {"nombre": "Francisco Chandía", "cargo": "Project Manager",
         "firmado_el": "29/07/2026 20:35 UTC", "hash_corto": "acf521df5a2b",
         "firma_visual": "Francisco Chandía", "empresa_firmante": None},
        {"nombre": "Guido Rietta González", "cargo": "Director General FIP",
         "firmado_el": "29/07/2026 20:35 UTC", "hash_corto": "2b9aa58decfe",
         "firma_visual": "Guido Rietta", "empresa_firmante": None},
    ]
    # `firmantes` viene de la ficha: None = la nómina de muestra, lista vacía =
    # la empresa NO tiene firmantes cargados y el documento sale así de verdad.
    # No es lo mismo "todavía no lo poblé en el banco" que "en producción no
    # hay nadie", y el PDF se ve distinto en cada caso.
    firmantes = ficha["firmantes"] if ficha["firmantes"] is not None else firmantes_muestra
    externos = [{"nombre": "Octavio Parada Cancino", "cargo": "Representante Legal",
                 "empresa_firmante": "OCTAVIO PARADA CANCINO"}]

    oc = _obj(
        numero=folio, fecha_emision=date(2026, 7, 29),
        moneda=_obj(value=moneda), forma_pago="30% anticipo y 70% contra entrega",
        plazo_pago="30 días", plazo_entrega="No aplica", lugar_entrega=None,
        garantia=None,
        observaciones=ficha["observaciones"],
        # Sin esta clave, `oc.incluye_condiciones` es undefined en Jinja ->
        # falsy -> la vista previa mostraria SIEMPRE la OC sin clausulas,
        # que es lo contrario de produccion (donde el default es True).
        incluye_condiciones=incluye_condiciones,
        gestiones_proveedor=None, emails_documentacion=None, emails_insumos=None,
        total_neto=neto, iva=iva,
        iva_porcentaje=iva_pct, tipo_documento=token,
        total=total,
        retencion_porcentaje=ret_pct, retencion_monto=retencion,
        total_a_pagar=total_a_pagar,
        estado=_obj(value="firmada"), items=items,
    )
    emp = _obj(
        nombre_corto=codigo, razon_social=razon, rut=ficha["rut"],
        giro=ficha["giro"], direccion=ficha["direccion"],
        ciudad=ficha["ciudad"], telefono=ficha["telefono"], email=None,
        pagina_web=ficha["pagina_web"],
        representante_legal=ficha["representante_legal"],
    )
    prov = _obj(
        razon_social="OCTAVIO PARADA CANCINO", rut="14.290.239-7",
        giro="Obras civiles menores", direccion="Camino Panimávida s/n",
        ciudad="Colbún", contacto_nombre="Octavio Parada", contacto_cargo="Titular",
        contacto_email=None, contacto_telefono=None,
    )
    # Los hitos se reparten sobre `total_a_pagar` (plata que sale), no sobre
    # el bruto, y el residuo de redondeo lo absorbe el último para que la suma
    # cierre exacto — igual que `_derivar_montos` en el backend.
    _h1 = _redondear(total_a_pagar * Decimal("30") / 100, paso)
    hitos = [
        {"porcentaje": Decimal("30"), "descripcion": ficha["hitos"][0],
         "fecha": date(2026, 8, 15), "monto": _h1},
        {"porcentaje": Decimal("70"), "descripcion": ficha["hitos"][1],
         "fecha": date(2026, 9, 30), "monto": total_a_pagar - _h1},
    ]

    return {
        "titulo": f"Orden de Compra {folio}", "tipo_doc": "ORDEN DE COMPRA",
        "folio": folio, "fecha_emision_larga": _fecha_larga(oc.fecha_emision),
        "estado": oc.estado.value, "color_primario": color,
        # El pie se ARMA con los mismos campos que el bloque Mandante en vez de
        # ir literal, que es lo que hace `oc_pdf_v2_service` en producción
        # (`pie_pdf + " | " + razón social`). Con el literal, la dirección de
        # RHO salía impresa al pie de TODAS las páginas de cualquier escenario
        # —y habría salido al pie de la OC del fondo—. Para RHO el string
        # resultante es idéntico al que había, así que ningún render anterior
        # cambia.
        # Mismo criterio que produccion (`oc_pdf_v2_service`): si la empresa
        # no tiene sitio declarado, el pie cierra con la razon social. El
        # banco lo interpolaba sin filtrar y con `pagina_web=None` imprimia
        # la palabra "None" en el pie de TODAS las paginas — un defecto de la
        # vista previa, no del PDF real, pero que hacia desconfiar del banco
        # justo cuando se lo usa para decidir si un diseno esta bien.
        "footer_texto": (
            f"{ficha['direccion']}, {ficha['ciudad']}   |   "
            f"{ficha["pagina_web"] or razon}"
        ),
        "empresa": emp, "logo_data_uri": _logo_data_uri(raw),
        "logo_max_css": _logo_max_css(raw), "proveedor": prov, "cuenta": None,
        "tipo_cuenta_label": "Cuenta Corriente", "oc": oc,
        "formatear_moneda": _formatear_moneda, "qr_data_uri": _qr_placeholder_svg(),
        "verify_url": "https://cehta-capital.vercel.app/ordenes-compra/28",
        "hash_verificacion": "oc-28-preview", "watermark": None, "css": "",
        "firmantes": firmantes, "firmantes_externos": externos,
        "firma_font_uri": _firma_font_data_uri(), "hitos_pago": hitos,
    }


_NODE_RENDER = r"""
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [htmlPath, pdfPath] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: pdfPath, format: 'Letter', printBackground: true,
    margin: { top: '16mm', right: '17mm', bottom: '15mm', left: '17mm' },
  });
  await browser.close();
})();
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--escenario", default="rho", choices=sorted(ESCENARIOS))
    ap.add_argument("--items", type=int, default=2)
    ap.add_argument(
        "--sin-condiciones",
        action="store_true",
        help=("Imprime la OC SIN las clausulas de arbitraje, para ver el "
              "efecto de la casilla nueva."),
    )
    ap.add_argument("--folio", default="OC-FLUJO-COMPLETO-9901")
    ap.add_argument("--template", default="orden_compra_panimavida.html")
    ap.add_argument(
        "--tipo",
        default="factura",
        choices=sorted(TIPOS),
        help=("Tipo de documento tributario. Cada uno imprime un bloque de "
              "totales distinto: honorarios agrega la retención y el líquido, "
              "exenta saca la fila de IVA."),
    )
    ap.add_argument(
        "--moneda",
        default="CLP",
        type=str.upper,
        choices=MONEDAS,
        help=("Moneda de la OC. En CLP los importes se redondean al peso; en "
              "UF a la centésima, que es lo que guarda la BD (NUMERIC 18,2) y "
              "lo que corresponde para un fondo que opera en UF."),
    )
    ap.add_argument(
        "--prefix",
        default=None,
        help=("Prefijo de los archivos de salida. Sirve para comparar variantes "
              "del template sin que se pisen los PNG entre sí."),
    )
    args = ap.parse_args()

    # Los defaults históricos (factura + CLP) conservan el nombre de archivo de
    # siempre para no invalidar las corridas ya guardadas; lo que se aparta del
    # default se sufija solo, así `--tipo honorarios` o `--moneda uf` sin
    # `--prefix` no pisan la factura en pesos.
    prefijo = args.prefix or "_".join(
        p for p in (
            args.escenario,
            None if args.tipo == "factura" else args.tipo,
            None if args.moneda == "CLP" else args.moneda.lower(),
        ) if p
    )
    _OUT.mkdir(exist_ok=True)
    ctx = construir_contexto(
        args.escenario, args.items, args.folio, args.tipo, args.moneda,
        incluye_condiciones=not args.sin_condiciones,
    )
    html = _env.get_template(args.template).render(**ctx)

    html_path = _OUT / f"{prefijo}.html"
    pdf_path = _OUT / f"{prefijo}.pdf"
    html_path.write_text(html, encoding="utf-8")

    # El script va DENTRO de frontend/: Node resuelve `require('playwright')`
    # relativo a la ubicación del script, no al cwd, y el único node_modules
    # con playwright es el del frontend.
    frontend = _BACKEND.parent / "frontend"
    js = frontend / "_render_oc_preview.js"
    js.write_text(_NODE_RENDER, encoding="utf-8")
    try:
        r = subprocess.run(
            ["node", str(js), str(html_path), str(pdf_path)],
            cwd=str(frontend), capture_output=True, text=True,
        )
    finally:
        js.unlink(missing_ok=True)
    if r.returncode != 0:
        print("render fallo:", r.stderr[:600])
        return 1

    try:
        import fitz
    except ImportError:
        print(f"PDF: {pdf_path} (instalá pymupdf para los PNG)")
        return 0
    doc = fitz.open(pdf_path)
    for i, p in enumerate(doc):
        out = _OUT / f"{prefijo}_p{i + 1}.png"
        p.get_pixmap(dpi=110).save(out)
    print(f"{doc.page_count} pagina(s) -> {_OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
