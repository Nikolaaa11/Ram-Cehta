"""Etapa M — Comments por voucher (discusion operativa).

Endpoints:
  GET    /vouchers/{id}/comments         — lista todos los comments del voucher
  POST   /vouchers/{id}/comments         — agrega comment (autor = current user)
  PATCH  /vouchers/{id}/comments/{cid}   — editar body o marcar resolved
  DELETE /vouchers/{id}/comments/{cid}   — borrar (solo el autor)

Permisos:
  - Read: cualquier user con scope en la empresa del voucher
  - Write: idem (no requiere legal:write — un contador puede comentar)
  - Edit/Delete: solo el autor del comment
  - Mark resolved: cualquier user con scope (no solo el autor) — la
    resolucion es decision del equipo, no del que tipea
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.core.security import AuthenticatedUser
from app.models.voucher import Voucher
from app.services.audit_service import audit_log
from app.services.empresa_scope_service import assert_empresa_access

router = APIRouter()


class CommentRead(BaseModel):
    comment_id: int
    voucher_id: int
    user_id: str
    user_email: str
    body: str
    resolved: bool
    created_at: datetime
    updated_at: datetime
    can_edit: bool  # true si current user es el autor


class CommentCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class CommentPatchRequest(BaseModel):
    body: str | None = Field(default=None, max_length=2000)
    resolved: bool | None = None


@router.get("/vouchers/{voucher_id}/comments")
async def list_voucher_comments(
    user: CurrentUser,
    db: DBSession,
    voucher_id: int,
) -> list[CommentRead]:
    """Lista comments del voucher en orden cronologico DESC (mas reciente primero)."""
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, voucher.empresa_codigo)

    rows = (
        await db.execute(
            text(
                """
                SELECT comment_id, voucher_id, user_id::text, user_email,
                       body, resolved, created_at, updated_at
                FROM core.voucher_comments
                WHERE voucher_id = :vid
                ORDER BY created_at DESC
                """
            ),
            {"vid": voucher_id},
        )
    ).mappings().all()

    current_uid = str(user.sub)
    return [
        CommentRead(
            comment_id=r["comment_id"],
            voucher_id=r["voucher_id"],
            user_id=r["user_id"],
            user_email=r["user_email"],
            body=r["body"],
            resolved=r["resolved"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
            can_edit=r["user_id"] == current_uid,
        )
        for r in rows
    ]


@router.post(
    "/vouchers/{voucher_id}/comments",
    status_code=status.HTTP_201_CREATED,
)
async def create_voucher_comment(
    user: CurrentUser,
    db: DBSession,
    voucher_id: int,
    body: CommentCreateRequest,
) -> CommentRead:
    """Agrega comment al voucher. Cualquier user con scope a la empresa puede."""
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, voucher.empresa_codigo)

    email = getattr(user, "email", None) or f"user-{user.sub[:8]}"

    row = (
        await db.execute(
            text(
                """
                INSERT INTO core.voucher_comments (
                    voucher_id, user_id, user_email, body
                ) VALUES (
                    :vid, CAST(:uid AS uuid), :email, :body
                )
                RETURNING comment_id, voucher_id, user_id::text, user_email,
                          body, resolved, created_at, updated_at
                """
            ),
            {
                "vid": voucher_id,
                "uid": str(user.sub),
                "email": email,
                "body": body.body.strip(),
            },
        )
    ).mappings().first()
    await db.commit()

    if row is None:  # pragma: no cover
        raise HTTPException(
            status_code=500, detail="Error al crear comment"
        )

    # Audit log soft (no rompe si falla)
    try:
        await audit_log(
            db, None, user,
            action="comment_create",
            entity_type="voucher",
            entity_id=str(voucher_id),
            entity_label=voucher.codigo,
            summary=(
                f"Comment en voucher {voucher.codigo}: "
                f"{body.body.strip()[:80]}"
            ),
            before=None,
            after={"comment_id": row["comment_id"], "body": body.body.strip()},
        )
    except Exception:
        pass

    return CommentRead(
        comment_id=row["comment_id"],
        voucher_id=row["voucher_id"],
        user_id=row["user_id"],
        user_email=row["user_email"],
        body=row["body"],
        resolved=row["resolved"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        can_edit=True,
    )


@router.patch("/vouchers/{voucher_id}/comments/{comment_id}")
async def patch_voucher_comment(
    user: CurrentUser,
    db: DBSession,
    voucher_id: int,
    comment_id: int,
    body: CommentPatchRequest,
) -> CommentRead:
    """Editar body (solo autor) o marcar resolved (cualquier con scope).

    Si solo se manda resolved=true/false, no requiere ser el autor.
    Si se manda body distinto, debe ser autor.
    """
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, voucher.empresa_codigo)

    existing = (
        await db.execute(
            text(
                """
                SELECT comment_id, voucher_id, user_id::text, user_email,
                       body, resolved
                FROM core.voucher_comments
                WHERE comment_id = :cid AND voucher_id = :vid
                """
            ),
            {"cid": comment_id, "vid": voucher_id},
        )
    ).mappings().first()
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Comment no encontrado"
        )

    is_author = existing["user_id"] == str(user.sub)

    new_body = existing["body"]
    if body.body is not None and body.body.strip() != existing["body"]:
        if not is_author:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo el autor del comment puede editar el texto",
            )
        if len(body.body.strip()) < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El comment no puede quedar vacio",
            )
        new_body = body.body.strip()

    new_resolved = existing["resolved"]
    if body.resolved is not None:
        new_resolved = body.resolved

    updated = (
        await db.execute(
            text(
                """
                UPDATE core.voucher_comments
                SET body = :body,
                    resolved = :resolved,
                    updated_at = now()
                WHERE comment_id = :cid AND voucher_id = :vid
                RETURNING comment_id, voucher_id, user_id::text, user_email,
                          body, resolved, created_at, updated_at
                """
            ),
            {
                "body": new_body,
                "resolved": new_resolved,
                "cid": comment_id,
                "vid": voucher_id,
            },
        )
    ).mappings().first()
    await db.commit()

    if updated is None:  # pragma: no cover
        raise HTTPException(status_code=500, detail="Error al actualizar")

    return CommentRead(
        comment_id=updated["comment_id"],
        voucher_id=updated["voucher_id"],
        user_id=updated["user_id"],
        user_email=updated["user_email"],
        body=updated["body"],
        resolved=updated["resolved"],
        created_at=updated["created_at"],
        updated_at=updated["updated_at"],
        can_edit=is_author,
    )


@router.delete(
    "/vouchers/{voucher_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_voucher_comment(
    user: CurrentUser,
    db: DBSession,
    voucher_id: int,
    comment_id: int,
) -> Response:
    """Borra el comment. Solo el autor puede."""
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, voucher.empresa_codigo)

    existing = (
        await db.execute(
            text(
                """
                SELECT user_id::text AS user_id
                FROM core.voucher_comments
                WHERE comment_id = :cid AND voucher_id = :vid
                """
            ),
            {"cid": comment_id, "vid": voucher_id},
        )
    ).first()
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Comment no encontrado"
        )
    if existing[0] != str(user.sub):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el autor puede borrar su comment",
        )

    await db.execute(
        text(
            "DELETE FROM core.voucher_comments WHERE comment_id = :cid"
        ),
        {"cid": comment_id},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
