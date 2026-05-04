"""Endpoints CRUD para `core.lp_documents` (V5).

Vault de documentos por LP (Limited Partner / inversionista del FIP):
contratos de suscripción, KYC, DDQ, side letters, recibos de aporte,
W-8/W-9, pasaportes, poderes notariales, etc.

A diferencia de `policies_fondo` (que son del fondo y no se borran,
se derogan), estos docs SÍ se pueden borrar físicamente — son por
LP y el GP puede limpiar el vault si lo decide.

Auth:
- read: cualquier usuario autenticado
- create / update / delete: scope `legal:write` (mismo que documentos
  legales y políticas del fondo)

Ruteo: el router se monta sin prefix porque las URLs llevan `{lp_id}`
embebido (`/lps/{lp_id}/documents`). Match con el patrón de
`informes_lp` que también routea `/lps/...`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select

from app.api.deps import CurrentUser, DBSession, require_scope
from app.models.lp import Lp
from app.models.lp_document import LpDocument
from app.schemas.lp_document import (
    LpDocumentCreate,
    LpDocumentEstado,
    LpDocumentRead,
    LpDocumentTipo,
    LpDocumentUpdate,
)
from app.services.webhook_dispatcher import publish_event

router = APIRouter()


def _to_read(doc: LpDocument) -> LpDocumentRead:
    """Convierte modelo SA → schema Pydantic.

    Necesario porque la columna `metadata` en SA está mapeada como
    `metadata_` (reservado por Base.metadata), pero el schema expone
    `metadata` plano. `model_validate(doc, from_attributes=True)` no
    encontraría el atributo `metadata`.
    """
    return LpDocumentRead.model_validate(
        {
            "lp_doc_id": doc.lp_doc_id,
            "lp_id": doc.lp_id,
            "tipo": doc.tipo,
            "nombre": doc.nombre,
            "fecha_firma": doc.fecha_firma,
            "fecha_vigencia_hasta": doc.fecha_vigencia_hasta,
            "monto_clp": doc.monto_clp,
            "dropbox_path": doc.dropbox_path,
            "hash_sha256": doc.hash_sha256,
            "estado": doc.estado,
            "metadata": doc.metadata_ or {},
            "uploaded_by": doc.uploaded_by,
            "created_at": doc.created_at,
            "updated_at": doc.updated_at,
        }
    )


async def _get_lp_or_404(db, lp_id: int) -> Lp:
    lp = await db.get(Lp, lp_id)
    if lp is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="LP no encontrado",
        )
    return lp


async def _get_doc_or_404(db, lp_id: int, lp_doc_id: int) -> LpDocument:
    doc = await db.get(LpDocument, lp_doc_id)
    if doc is None or doc.lp_id != lp_id:
        # 404 si no existe O si pertenece a otro LP — no leakear info
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Documento no encontrado",
        )
    return doc


@router.get(
    "/lps/{lp_id}/documents",
    response_model=list[LpDocumentRead],
)
async def list_lp_documents(
    user: CurrentUser,
    db: DBSession,
    lp_id: int,
    tipo: LpDocumentTipo | None = Query(default=None),
    estado: LpDocumentEstado | None = Query(default=None),
) -> list[LpDocumentRead]:
    """Lista documentos del LP. Default: todos, ordenados por
    `created_at` DESC (último subido primero).
    """
    await _get_lp_or_404(db, lp_id)
    stmt = select(LpDocument).where(LpDocument.lp_id == lp_id)
    if tipo is not None:
        stmt = stmt.where(LpDocument.tipo == tipo)
    if estado is not None:
        stmt = stmt.where(LpDocument.estado == estado)
    stmt = stmt.order_by(LpDocument.created_at.desc())
    result = await db.execute(stmt)
    return [_to_read(d) for d in result.scalars().all()]


@router.get(
    "/lps/{lp_id}/documents/{lp_doc_id}",
    response_model=LpDocumentRead,
)
async def get_lp_document(
    user: CurrentUser,
    db: DBSession,
    lp_id: int,
    lp_doc_id: int,
) -> LpDocumentRead:
    await _get_lp_or_404(db, lp_id)
    doc = await _get_doc_or_404(db, lp_id, lp_doc_id)
    return _to_read(doc)


@router.post(
    "/lps/{lp_id}/documents",
    response_model=LpDocumentRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_lp_document(
    user: CurrentUser,
    db: DBSession,
    lp_id: int,
    body: LpDocumentCreate,
) -> LpDocumentRead:
    await _get_lp_or_404(db, lp_id)
    doc = LpDocument(
        lp_id=lp_id,
        tipo=body.tipo,
        nombre=body.nombre,
        fecha_firma=body.fecha_firma,
        fecha_vigencia_hasta=body.fecha_vigencia_hasta,
        monto_clp=body.monto_clp,
        dropbox_path=body.dropbox_path,
        hash_sha256=body.hash_sha256,
        estado=body.estado,
        metadata_=body.metadata,
        uploaded_by=body.uploaded_by,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    # Webhook: lp_document.created — alta de doc en vault del LP.
    await publish_event(
        db,
        "lp_document.created",
        {
            "lp_doc_id": doc.lp_doc_id,
            "lp_id": doc.lp_id,
            "tipo": doc.tipo,
            "nombre": doc.nombre,
            "fecha_firma": str(doc.fecha_firma) if doc.fecha_firma else None,
            "fecha_vigencia_hasta": str(doc.fecha_vigencia_hasta)
            if doc.fecha_vigencia_hasta
            else None,
            "monto_clp": float(doc.monto_clp) if doc.monto_clp else None,
            "estado": doc.estado,
            "created_by": str(user.sub) if hasattr(user, "sub") else None,
        },
    )
    return _to_read(doc)


@router.patch(
    "/lps/{lp_id}/documents/{lp_doc_id}",
    response_model=LpDocumentRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def update_lp_document(
    user: CurrentUser,
    db: DBSession,
    lp_id: int,
    lp_doc_id: int,
    body: LpDocumentUpdate,
) -> LpDocumentRead:
    await _get_lp_or_404(db, lp_id)
    doc = await _get_doc_or_404(db, lp_id, lp_doc_id)
    update_data = body.model_dump(exclude_unset=True)
    if "metadata" in update_data:
        update_data["metadata_"] = update_data.pop("metadata")
    for k, v in update_data.items():
        setattr(doc, k, v)
    await db.commit()
    await db.refresh(doc)
    return _to_read(doc)


@router.delete(
    "/lps/{lp_id}/documents/{lp_doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def delete_lp_document(
    user: CurrentUser,
    db: DBSession,
    lp_id: int,
    lp_doc_id: int,
) -> Response:
    """Borrado físico — los docs LP se pueden eliminar (a diferencia
    de las políticas del fondo, que solo se derogan).
    """
    await _get_lp_or_404(db, lp_id)
    doc = await _get_doc_or_404(db, lp_id, lp_doc_id)
    await db.delete(doc)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
