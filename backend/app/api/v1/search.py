"""Búsqueda global (Cmd+K palette).

Un solo endpoint `GET /search?q=...` recorre 7 tablas con ILIKE en columnas
clave y devuelve hits agrupados por entidad. Diseñado para latencia <150ms en
datasets internos (decenas de miles de filas máx).

Decisiones:
- ILIKE + índices btree existentes (no full-text). Datasets pequeños, no vale
  la pena montar `pg_trgm` o `tsvector` todavía.
- 5 hits por entidad como techo (`LIMIT 5`). El palette muestra 35 resultados
  máximo total, y el usuario refina escribiendo más.
- Sólo lectura — sin scope especial. Cualquier usuario autenticado puede
  buscar; el frontend filtra entidades a las que no tiene acceso de lectura
  por scope visual (no es defensa de seguridad — los endpoints CRUD ya
  enforcen scope).
- Query mínima: 2 chars. Devolvemos 200 con `total=0` en queries cortas para
  no abusar del backend en cada keystroke.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.schemas.search import SearchEntityType, SearchHit, SearchResponse

router = APIRouter()

_MIN_QUERY_LEN = 2
_PER_ENTITY_LIMIT = 5


def _hit(entity_type: SearchEntityType, **kwargs: object) -> SearchHit:
    return SearchHit(entity_type=entity_type, **kwargs)  # type: ignore[arg-type]


@router.get("", response_model=SearchResponse)
async def global_search(
    user: CurrentUser,
    db: DBSession,
    q: Annotated[str, Query(min_length=0, max_length=200)] = "",
) -> SearchResponse:
    """Cmd+K. Recibe `q` y devuelve hits agrupados por entidad.

    Si `q` < 2 chars devolvemos respuesta vacía pero válida (200), para que el
    frontend pueda llamar en cada keystroke sin manejar errores especiales.
    """
    q_clean = q.strip()
    if len(q_clean) < _MIN_QUERY_LEN:
        return SearchResponse(query=q_clean, total=0, by_entity={})

    pattern = f"%{q_clean}%"
    by_entity: dict[SearchEntityType, list[SearchHit]] = {}

    # ── Empresas ──────────────────────────────────────────────────────────────
    rows = (
        await db.execute(
            text(
                """
                SELECT codigo, razon_social, rut
                FROM core.empresas
                WHERE activo = true
                  AND (codigo ILIKE :p OR razon_social ILIKE :p OR rut ILIKE :p)
                ORDER BY codigo
                LIMIT :lim
                """
            ),
            {"p": pattern, "lim": _PER_ENTITY_LIMIT},
        )
    ).fetchall()
    if rows:
        by_entity["empresa"] = [
            _hit(
                "empresa",
                entity_id=r[0],
                title=r[1] or r[0],
                subtitle=f"RUT {r[2]}" if r[2] else r[0],
                badge=r[0],
                link=f"/empresa/{r[0]}",
            )
            for r in rows
        ]

    # ── OCs ───────────────────────────────────────────────────────────────────
    rows = (
        await db.execute(
            text(
                """
                SELECT oc.oc_id, oc.numero_oc, oc.empresa_codigo, oc.estado,
                       oc.total, oc.moneda, p.razon_social
                FROM core.ordenes_compra oc
                LEFT JOIN core.proveedores p ON p.proveedor_id = oc.proveedor_id
                WHERE oc.numero_oc ILIKE :p
                   OR oc.empresa_codigo ILIKE :p
                   OR p.razon_social ILIKE :p
                ORDER BY oc.fecha_emision DESC NULLS LAST
                LIMIT :lim
                """
            ),
            {"p": pattern, "lim": _PER_ENTITY_LIMIT},
        )
    ).fetchall()
    if rows:
        by_entity["orden_compra"] = [
            _hit(
                "orden_compra",
                entity_id=str(r[0]),
                title=f"OC {r[1]} — {r[2]}",
                subtitle=(
                    f"{r[6]} · {r[5]} {int(r[4]):,}".replace(",", ".")
                    if r[4] and r[6]
                    else r[6] or "—"
                ),
                badge=r[3],
                link=f"/ordenes-compra/{r[0]}",
            )
            for r in rows
        ]

    # ── Proveedores ───────────────────────────────────────────────────────────
    rows = (
        await db.execute(
            text(
                """
                SELECT proveedor_id, razon_social, rut, giro
                FROM core.proveedores
                WHERE razon_social ILIKE :p OR rut ILIKE :p OR giro ILIKE :p
                ORDER BY razon_social
                LIMIT :lim
                """
            ),
            {"p": pattern, "lim": _PER_ENTITY_LIMIT},
        )
    ).fetchall()
    if rows:
        by_entity["proveedor"] = [
            _hit(
                "proveedor",
                entity_id=str(r[0]),
                title=r[1],
                subtitle=f"RUT {r[2]}" + (f" · {r[3]}" if r[3] else ""),
                link=f"/proveedores?focus={r[0]}",
            )
            for r in rows
        ]

    # ── F29 ───────────────────────────────────────────────────────────────────
    rows = (
        await db.execute(
            text(
                """
                SELECT f29_id, empresa_codigo, periodo_tributario, estado,
                       monto_a_pagar, fecha_vencimiento
                FROM core.f29_obligaciones
                WHERE empresa_codigo ILIKE :p
                   OR periodo_tributario ILIKE :p
                   OR CAST(monto_a_pagar AS TEXT) ILIKE :p
                ORDER BY fecha_vencimiento DESC NULLS LAST
                LIMIT :lim
                """
            ),
            {"p": pattern, "lim": _PER_ENTITY_LIMIT},
        )
    ).fetchall()
    if rows:
        by_entity["f29"] = [
            _hit(
                "f29",
                entity_id=str(r[0]),
                title=f"F29 {r[1]} · {r[2]}",
                subtitle=(
                    f"vence {r[5].isoformat()}" if r[5] else "sin vencimiento"
                ),
                badge=r[3],
                link=f"/f29?focus={r[0]}",
            )
            for r in rows
        ]

    # ── Trabajadores ──────────────────────────────────────────────────────────
    rows = (
        await db.execute(
            text(
                """
                SELECT trabajador_id, empresa_codigo, nombre_completo, rut, cargo
                FROM core.trabajadores
                WHERE nombre_completo ILIKE :p OR rut ILIKE :p OR cargo ILIKE :p
                ORDER BY nombre_completo
                LIMIT :lim
                """
            ),
            {"p": pattern, "lim": _PER_ENTITY_LIMIT},
        )
    ).fetchall()
    if rows:
        by_entity["trabajador"] = [
            _hit(
                "trabajador",
                entity_id=str(r[0]),
                title=r[2],
                subtitle=f"{r[1]} · {r[4] or 'sin cargo'} · RUT {r[3]}",
                badge=r[1],
                link=f"/empresa/{r[1]}/trabajadores?focus={r[0]}",
            )
            for r in rows
        ]

    # ── Documentos legales ────────────────────────────────────────────────────
    rows = (
        await db.execute(
            text(
                """
                SELECT documento_id, empresa_codigo, nombre, categoria,
                       contraparte
                FROM core.legal_documents
                WHERE nombre ILIKE :p
                   OR contraparte ILIKE :p
                   OR descripcion ILIKE :p
                ORDER BY uploaded_at DESC
                LIMIT :lim
                """
            ),
            {"p": pattern, "lim": _PER_ENTITY_LIMIT},
        )
    ).fetchall()
    if rows:
        by_entity["legal_document"] = [
            _hit(
                "legal_document",
                entity_id=str(r[0]),
                title=r[2],
                subtitle=f"{r[1]} · {r[4] or 'sin contraparte'}",
                badge=r[3],
                link=f"/empresa/{r[1]}/legal/{r[0]}",
            )
            for r in rows
        ]

    # ── Fondos ────────────────────────────────────────────────────────────────
    rows = (
        await db.execute(
            text(
                """
                SELECT fondo_id, nombre, tipo, pais, region
                FROM core.fondos
                WHERE nombre ILIKE :p
                   OR tipo ILIKE :p
                   OR pais ILIKE :p
                   OR region ILIKE :p
                   OR thesis ILIKE :p
                ORDER BY nombre
                LIMIT :lim
                """
            ),
            {"p": pattern, "lim": _PER_ENTITY_LIMIT},
        )
    ).fetchall()
    if rows:
        by_entity["fondo"] = [
            _hit(
                "fondo",
                entity_id=str(r[0]),
                title=r[1],
                subtitle=(
                    " · ".join(
                        s for s in (r[2], r[3], r[4]) if s
                    )
                    or "—"
                ),
                link=f"/fondos/{r[0]}",
            )
            for r in rows
        ]

    total = sum(len(v) for v in by_entity.values())
    return SearchResponse(query=q_clean, total=total, by_entity=by_entity)
