"""Nombre de archivo canónico del PDF de una Orden de Compra.

Por qué existe este módulo: el nombre del PDF se armaba a mano en 5 lugares
distintos (endpoint de descarga, 2 adjuntos de email en oc_firmas, el envío a
firmantes y el retry del outbox) y divergían entre sí — unos con "oc-" en
minúscula, otros con "OC-", y todos anteponiendo el prefijo a ciegas sobre
números que YA empiezan con "OC" (las 3 OCs vivas en producción son
'OC0041-PAN001-...', 'OC-FLUJO-COMPLETO-9901' y '...-9900'), produciendo
'OC-OC0041-....pdf'. Acá vive la única fuente de verdad.

Reglas (mirroreadas en `frontend/lib/oc-filename.ts` — si cambiás una, cambiá
la otra; el frontend PISA el Content-Disposition con `a.download` en las
descargas por blob, así que si divergen gana el frontend y el backend miente):

1. El nombre siempre empieza con "OC" en MAYÚSCULA (pedido del cliente).
2. Si el número ya empieza con "OC" no se duplica el prefijo, solo se
   normaliza a mayúscula ('oc0041' → 'OC0041'). "Empieza con OC" significa
   OC seguido de algo que no sea letra (dígito, guion, espacio o fin), para
   no confundir un número tipo 'OCTUBRE-01' con el prefijo.
3. Se sanitizan los caracteres que Windows prohíbe en un nombre de archivo
   (\\ / : * ? " < > | y los de control): los números de OC los tipea el
   usuario y ya vienen con espacios y podrían traer cualquier cosa.
4. Los espacios pasan a "_" — un número real es
   'OC0041-PAN001-Comercializadora los Canelos jv' y un filename con espacios
   sobrevive mal a los clientes de correo y a la shell.

Para el header HTTP usar `oc_pdf_content_disposition()`: Starlette codifica
los headers en latin-1, así que un carácter fuera de latin-1 en el número
(una comilla tipográfica, un guion largo, cualquier cosa pegada desde Word)
reventaría el endpoint con un 500. Por eso emitimos el patrón RFC 5987:
`filename=` con un fallback ASCII plano + `filename*=UTF-8''...` con el
nombre completo percent-encoded, que es el que el navegador realmente usa.
"""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import quote

# Caracteres ilegales en un nombre de archivo Windows + los de control.
_INVALID_FS_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')

# Cualquier corrida de espacios colapsa a un solo "_".
#
# La clase va ENUMERADA y no como `\s` a propósito: `\s` no significa lo mismo
# en Python que en JavaScript, y el frontend tiene que producir exactamente el
# mismo nombre que el backend (si no, el adjunto del mail y el archivo que se
# descarga difieren). Concretamente, Python matchea U+0085 (NEL) y no U+FEFF;
# JS al revés. Los dos aparecen en la vida real: U+0085 sale de un "…" mal
# decodificado como latin-1 en vez de cp1252, y U+FEFF de un pegado desde
# Excel/CSV con BOM. Enumerando la clase los dos motores coinciden.
# Mantener sincronizado con `_WHITESPACE` en frontend/lib/oc-filename.ts.
_WHITESPACE = re.compile(
    "[ \t\n\r\f\v\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+"
)

# "OC" al inicio SOLO si lo que sigue no es una letra: matchea 'OC0041',
# 'OC-FLUJO', 'oc 123' y 'OC' pelado; NO matchea 'OCTUBRE-01'.
_OC_PREFIX = re.compile(r"^oc(?![a-z])", re.IGNORECASE)

# Basura de borde que Windows no tolera al final de un nombre (punto/espacio)
# y que además queda fea al principio.
_EDGE_JUNK = "_-. "

# Tope del stem. Nada operativo lo necesita tan largo y evita nombres absurdos
# si alguien pega medio contrato en el numero_oc.
_MAX_STEM = 120

_FALLBACK_STEM = "OC"


def _oc_stem(numero_oc: object) -> str:
    """Devuelve el nombre sin extensión, ya prefijado y sanitizado."""
    # Ojo: chequeo explícito de vacío, no `or`. Un numero_oc "0" es falsy como
    # str vacío para `or` y perderíamos el número real (mismo bug que el IVA 0%).
    raw = "" if numero_oc is None else str(numero_oc).strip()
    if not raw:
        return _FALLBACK_STEM

    core = _INVALID_FS_CHARS.sub("-", raw)
    core = _WHITESPACE.sub("_", core)
    core = core.strip(_EDGE_JUNK)
    if not core:
        return _FALLBACK_STEM

    # Si ya trae el prefijo no lo duplicamos: solo lo forzamos a mayúscula.
    stem = f"OC{core[2:]}" if _OC_PREFIX.match(core) else f"OC-{core}"

    return stem[:_MAX_STEM].strip(_EDGE_JUNK) or _FALLBACK_STEM


def _ascii_stem(stem: str) -> str:
    """Versión ASCII del stem para el `filename=` de fallback.

    NFKD + descarte de marcas de combinación: 'Panimávida' → 'Panimavida'.
    Lo que no tenga equivalente ASCII (CJK, emojis) simplemente se cae.
    """
    folded = unicodedata.normalize("NFKD", stem)
    ascii_stem = folded.encode("ascii", "ignore").decode("ascii")
    # El fold puede haber dejado separadores pegados o bordes sucios.
    ascii_stem = _INVALID_FS_CHARS.sub("-", ascii_stem)
    # Re-colapsar espacios DESPUÉS del NFKD: los modificadores espaciadores
    # (´ ¨ ¸ ˘ ˙ ˚ ˛ ˜ ˝ y ~20 más) se descomponen en ESPACIO + marca
    # combinante; la marca se cae con el encode a ASCII pero el espacio
    # sobrevive, y quedaba un 'OC- 123.pdf' con espacio adentro. Se disparaba,
    # por ejemplo, con una tecla muerta mal aplicada al escribir "Panimávida".
    ascii_stem = _WHITESPACE.sub("_", ascii_stem)
    ascii_stem = re.sub(r"-{2,}", "-", ascii_stem).strip(_EDGE_JUNK)
    return ascii_stem or _FALLBACK_STEM


def oc_pdf_filename(numero_oc: object) -> str:
    """Nombre de archivo del PDF de la OC. Es el nombre que ve el usuario.

    >>> oc_pdf_filename("OC-FLUJO-COMPLETO-9901")
    'OC-FLUJO-COMPLETO-9901.pdf'
    >>> oc_pdf_filename("1234")
    'OC-1234.pdf'
    """
    return f"{_oc_stem(numero_oc)}.pdf"


def oc_pdf_content_disposition(
    numero_oc: object, *, disposition: str = "attachment"
) -> str:
    """Valor completo del header Content-Disposition, a prueba de latin-1.

    Emite el ASCII plano en `filename=` (compatibilidad + garantía de que
    Starlette puede codificar el header) y el nombre real UTF-8 en
    `filename*=`, que es el que los navegadores prefieren (RFC 5987/6266).
    """
    stem = _oc_stem(numero_oc)
    ascii_name = f"{_ascii_stem(stem)}.pdf"
    utf8_name = quote(f"{stem}.pdf", safe="")
    return (
        f'{disposition}; filename="{ascii_name}"; '
        f"filename*=UTF-8''{utf8_name}"
    )
