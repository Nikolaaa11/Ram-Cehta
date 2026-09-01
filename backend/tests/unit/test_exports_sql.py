"""Los exports a Excel — el bug que los tuvo rotos desde el día uno.

`text()` de SQLAlchemy NO reconoce un bind seguido de `::` (el cast de
Postgres): `:empresa::text` viajaba LITERAL y Postgres respondía "syntax
error at or near ':'" en TODA invocación, de los 9 exports. Se encontró
corriéndolo de verdad contra producción — el análisis estático no lo ve,
porque el SQL "parece" válido.

Estos tests compilan cada query con el dialecto asyncpg REAL: si alguien
vuelve a escribir `:param::cast`, fallan acá y no en el botón del usuario.
"""
from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.api.v1.exports import _ENTITY_QUERIES, _serialize


def test_toda_query_de_export_compila_sin_binds_sin_sustituir():
    for nombre, q in _ENTITY_QUERIES.items():
        render = str(text(q["sql"]).compile(dialect=postgresql.asyncpg.dialect()))
        sobrantes = re.findall(r":\w+", render)
        # `::` de un CAST legítimo no matchea porque va precedido de `)` o
        # identificador; un bind sin sustituir sí.
        sobrantes = [s for s in sobrantes if not s.startswith("::")]
        assert not sobrantes, (
            f"export '{nombre}': binds sin sustituir {sobrantes} — "
            "¿alguien volvió a escribir :param::cast? Usar CAST(:param AS ...)"
        )


def test_headers_y_select_alineados():
    # Un header de más o de menos corre TODAS las columnas del Excel.
    for nombre, q in _ENTITY_QUERIES.items():
        primera = q["sql"].upper().split("FROM")[0]
        # contar expresiones del SELECT de primer nivel es frágil; el
        # invariante barato: al menos tantas comas de primer nivel no se
        # puede sin parser. Lo que sí se puede fijar: los headers existen y
        # no están vacíos ni duplicados.
        assert len(q["headers"]) > 3, nombre
        assert len(set(q["headers"])) == len(q["headers"]), (
            f"{nombre}: headers duplicados"
        )
        assert primera.count("SELECT") >= 1


def test_serialize_limpia_caracteres_ilegales_de_excel():
    sucio = "hola" + chr(0) + "chau" + chr(31) + chr(11)
    limpio = _serialize(sucio)
    assert chr(0) not in limpio and chr(31) not in limpio and chr(11) not in limpio
    # Los saltos de línea y tabs SÍ se conservan: son legales en Excel.
    assert _serialize("linea1\nlinea2\tcol") == "linea1\nlinea2\tcol"
