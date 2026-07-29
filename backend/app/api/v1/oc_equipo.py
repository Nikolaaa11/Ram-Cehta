"""MEGAPROMPT OC · Equipo firmante por empresa (`core.empresa_equipo`).

Endpoints (montados SIN prefix — los paths completos viven acá, patrón
oc_cuotas/empresa_oc_branding):

    GET    /empresas/{codigo}/equipo                → catálogo completo
    POST   /empresas/{codigo}/equipo                → alta de una persona
    PATCH  /empresas/{codigo}/equipo/{miembro_id}   → edición parcial
    DELETE /empresas/{codigo}/equipo/{miembro_id}   → baja (ver docstring)
    PUT    /empresas/{codigo}/equipo/orden          → reordenar el set

Por qué existe esta tabla: los firmantes vivían en dos columnas JSONB de
`core.empresas` (oc_firmantes para el PDF v2, firmantes_extra para el v1 y
los "sugeridos") sin ID estable, desincronizadas entre sí. Sin ID no hay
forma de hacer el toggle por click que pidió el operador. Acá cada persona
tiene `miembro_id`; un trigger AFTER INSERT/UPDATE/DELETE re-arma esas dos
columnas JSONB desde los miembros activos+es_default, así que NUNCA hay que
escribirlas a mano desde el backend.

Gating: scope oc:read / oc:update + `assert_empresa_access` en los cinco
endpoints. El scope certifica "puede operar OCs"; el assert certifica "puede
operar ESTA empresa" — sin el segundo, un usuario de FIP_CEHTA cambiaría los
firmantes de RHO y se auto-habilitaría para firmar sus OCs.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.schemas.oc_equipo import (
    EquipoOrdenRequest,
    MiembroCreate,
    MiembroRead,
    MiembroUpdate,
)
from app.services.audit_service import audit_log
from app.services.empresa_scope_service import assert_empresa_access

router = APIRouter()

# Columnas que un PATCH puede tocar. El schema ya es extra="forbid", pero el
# SET se arma con interpolación de nombres — el whitelist evita que un futuro
# campo del schema se convierta sin querer en un identificador SQL libre.
_COLUMNAS_PATCH: frozenset[str] = frozenset(
    {"nombre", "cargo", "email", "rut", "es_default", "activo"}
)

# `tiene_cuenta` sale del mismo SELECT del listado (nada de un query por
# miembro). LATERAL + LIMIT 1 en vez de un JOIN plano porque auth.users solo
# tiene UNIQUE PARCIAL sobre email (los usuarios SSO quedan fuera del índice):
# un email duplicado ahí multiplicaría filas del catálogo.
_SELECT_MIEMBROS = """
    SELECT m.miembro_id, m.empresa_codigo, m.nombre, m.cargo, m.email,
           m.rut, m.orden, m.es_default, m.activo,
           (u.id IS NOT NULL) AS tiene_cuenta
    FROM core.empresa_equipo m
    LEFT JOIN LATERAL (
        SELECT au.id
        FROM auth.users au
        WHERE m.email IS NOT NULL AND lower(au.email) = lower(m.email)
        LIMIT 1
    ) u ON TRUE
    WHERE m.empresa_codigo = :codigo
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _listar_miembros(db: AsyncSession, codigo: str) -> list[MiembroRead]:
    rows = (
        await db.execute(
            text(_SELECT_MIEMBROS + " ORDER BY m.orden, m.miembro_id"),
            {"codigo": codigo},
        )
    ).mappings().all()
    return [MiembroRead.model_validate(dict(r)) for r in rows]


async def _get_miembro_or_404(
    db: AsyncSession, codigo: str, miembro_id: int
) -> MiembroRead:
    row = (
        await db.execute(
            text(_SELECT_MIEMBROS + " AND m.miembro_id = :mid"),
            {"codigo": codigo, "mid": miembro_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"El miembro {miembro_id} no existe en el equipo de {codigo}",
        )
    return MiembroRead.model_validate(dict(row))


async def _assert_empresa_existe(db: AsyncSession, codigo: str) -> None:
    """404 explícito antes de que la FK tire un IntegrityError ilegible."""
    existe = await db.scalar(
        text("SELECT 1 FROM core.empresas WHERE codigo = :c"), {"c": codigo}
    )
    if not existe:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa {codigo} no encontrada",
        )


def _normalizar_email(email: Any) -> str | None:
    """Guardamos lowercase+trim: todo el flujo de firma resuelve por
    lower(email) contra auth.users y contra oc_firmas.firmante_email."""
    limpio = str(email or "").strip().lower()
    return limpio or None


async def _resolve_user_id(db: AsyncSession, email: str | None) -> str | None:
    """user_id de auth.users para ese email, o None si todavía no tiene cuenta.

    Es informativo (el flujo de firma re-resuelve por email), pero tenerlo
    poblado permite mandar la notificación in-app sin re-buscar.
    """
    if not email:
        return None
    uid = await db.scalar(
        text("SELECT id::text FROM auth.users WHERE lower(email) = :e LIMIT 1"),
        {"e": email},
    )
    return str(uid) if uid else None


def _detalle_conflicto(codigo: str, email: str | None, nombre: str) -> str:
    """Mensaje del 409 según cuál de los dos índices únicos saltó."""
    if email:
        return (
            f"Ya hay alguien con el email {email} en el equipo de {codigo}. "
            f"Editá esa persona en vez de duplicarla."
        )
    return (
        f"Ya hay alguien llamado '{nombre}' sin email en el equipo de "
        f"{codigo}. Editá esa persona o cargale un email para diferenciarla."
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/empresas/{codigo}/equipo", response_model=list[MiembroRead])
async def listar_equipo(
    codigo: str,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:read"))],
    db: DBSession,
) -> list[MiembroRead]:
    """Catálogo de personas que pueden firmar OCs de esta empresa.

    Devuelve activos e inactivos — la UI muestra los inactivos apagados para
    que el operador pueda reactivarlos sin volver a cargarlos.
    """
    await assert_empresa_access(user, db, codigo)
    return await _listar_miembros(db, codigo)


@router.post(
    "/empresas/{codigo}/equipo",
    response_model=MiembroRead,
    status_code=status.HTTP_201_CREATED,
)
async def crear_miembro(
    codigo: str,
    body: MiembroCreate,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
) -> MiembroRead:
    """Agrega una persona al equipo firmante de la empresa.

    Queda al final del orden (MAX(orden)+1, calculado dentro del mismo INSERT
    para no dejar ventana de carrera entre dos altas simultáneas).

    Si el email matchea un usuario de la plataforma se puebla `user_id`; si no,
    la persona igual se carga (firma manuscrita en el PDF) y el listado la
    devuelve con `tiene_cuenta=false` para que la UI lo avise.
    """
    await assert_empresa_access(user, db, codigo)
    await _assert_empresa_existe(db, codigo)

    email = _normalizar_email(body.email)
    nombre = body.nombre.strip()

    try:
        miembro_id = await db.scalar(
            text(
                """INSERT INTO core.empresa_equipo (
                       empresa_codigo, nombre, cargo, email, rut,
                       orden, es_default, activo, user_id
                   ) VALUES (
                       :codigo, :nombre, :cargo, :email, :rut,
                       COALESCE((SELECT MAX(orden) FROM core.empresa_equipo
                                 WHERE empresa_codigo = :codigo), 0) + 1,
                       :es_default, TRUE, CAST(:uid AS UUID)
                   )
                   RETURNING miembro_id"""
            ),
            {
                "codigo": codigo,
                "nombre": nombre,
                "cargo": (body.cargo or "").strip() or None,
                "email": email,
                "rut": (body.rut or "").strip() or None,
                "es_default": body.es_default,
                "uid": await _resolve_user_id(db, email),
            },
        )
    except IntegrityError as exc:
        # Los dos índices únicos parciales de la tabla. Sin este catch el
        # operador ve un 500 opaco cuando repite a alguien del equipo.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_detalle_conflicto(codigo, email, nombre),
        ) from exc

    await audit_log(
        db,
        None,
        user,
        action="empresa_equipo.creado",
        entity_type="empresa_equipo",
        entity_id=str(miembro_id),
        entity_label=f"{codigo} · {nombre}",
        summary=f"{nombre} agregado al equipo firmante de {codigo}",
        after={
            "nombre": nombre,
            "cargo": body.cargo,
            "email": email,
            "es_default": body.es_default,
        },
    )
    await db.commit()
    return await _get_miembro_or_404(db, codigo, int(miembro_id))


@router.patch(
    "/empresas/{codigo}/equipo/{miembro_id:int}", response_model=MiembroRead
)
async def actualizar_miembro(
    codigo: str,
    miembro_id: int,
    body: MiembroUpdate,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
) -> MiembroRead:
    """Edición parcial. Solo cambian los campos presentes en el body.

    Mandar `email: null` limpia el email (y el `user_id` asociado); cambiarlo
    re-resuelve la cuenta contra auth.users — si no re-resolviéramos, el
    miembro quedaría apuntando al usuario viejo y las notificaciones de firma
    irían a la persona equivocada.
    """
    await assert_empresa_access(user, db, codigo)
    antes = await _get_miembro_or_404(db, codigo, miembro_id)

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return antes
    if "nombre" in fields:
        nombre = (fields["nombre"] or "").strip()
        if len(nombre) < 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="El nombre es obligatorio (mínimo 2 caracteres).",
            )
        fields["nombre"] = nombre

    set_clauses: list[str] = []
    params: dict[str, Any] = {"codigo": codigo, "mid": miembro_id}
    for k, v in fields.items():
        if k not in _COLUMNAS_PATCH:
            continue
        if k == "email":
            email = _normalizar_email(v)
            set_clauses.append("email = :email")
            params["email"] = email
            set_clauses.append("user_id = CAST(:uid AS UUID)")
            params["uid"] = await _resolve_user_id(db, email)
        elif k in {"cargo", "rut"}:
            set_clauses.append(f"{k} = :{k}")
            params[k] = (str(v).strip() or None) if v is not None else None
        else:
            set_clauses.append(f"{k} = :{k}")
            params[k] = v

    if not set_clauses:  # defensivo: body con solo campos no-columna
        return antes

    sql = (
        "UPDATE core.empresa_equipo SET "
        + ", ".join(set_clauses)
        + ", updated_at = NOW() "
        + "WHERE miembro_id = :mid AND empresa_codigo = :codigo"
    )
    try:
        result = await db.execute(text(sql), params)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_detalle_conflicto(
                codigo, params.get("email"), fields.get("nombre", antes.nombre)
            ),
        ) from exc
    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"El miembro {miembro_id} no existe en el equipo de {codigo}",
        )

    await audit_log(
        db,
        None,
        user,
        action="empresa_equipo.actualizado",
        entity_type="empresa_equipo",
        entity_id=str(miembro_id),
        entity_label=f"{codigo} · {antes.nombre}",
        summary=f"Miembro {antes.nombre} del equipo de {codigo} editado",
        before={k: getattr(antes, k, None) for k in fields if k in _COLUMNAS_PATCH},
        # params tiene los valores YA normalizados (email en minúsculas, etc.):
        # el audit debe reflejar lo que quedó en la BD, no lo que llegó crudo.
        after={
            k: params.get(k, v)
            for k, v in fields.items()
            if k in _COLUMNAS_PATCH
        },
    )
    await db.commit()
    return await _get_miembro_or_404(db, codigo, miembro_id)


@router.delete(
    "/empresas/{codigo}/equipo/{miembro_id:int}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        200: {
            "description": (
                "El miembro ya firmó alguna OC: no se borra, se desactiva. "
                "El body explica qué pasó para que la UI lo muestre."
            )
        }
    },
)
async def eliminar_miembro(
    codigo: str,
    miembro_id: int,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
) -> Response:
    """Saca a una persona del equipo. Borrado real, con UNA excepción.

    La tabla es un catálogo (no tiene histórico contable colgando), así que
    por defecto se borra de verdad: si el operador cargó a alguien por error,
    quiere que desaparezca de la lista, no un cementerio de inactivos.

    EXCEPCIÓN — si esa persona figura en alguna `core.oc_firmas` con
    status='FIRMADA' de una OC de esta misma empresa, NO se borra: se marca
    `activo=false` y el endpoint devuelve 200 explicando por qué. Motivo:
    preservar la trazabilidad de quién firmó. Aunque `oc_firmas` guarda
    nombre/cargo/email denormalizados y sobreviviría al DELETE, dejar el
    miembro vivo mantiene el vínculo con la persona real del catálogo (misma
    fila, mismo miembro_id) para auditorías y para el PDF re-generado.

    Un miembro inactivo no aparece en las plantillas ni en el JSONB que
    sincroniza el trigger, así que a efectos operativos queda igual de fuera.
    """
    await assert_empresa_access(user, db, codigo)
    miembro = await _get_miembro_or_404(db, codigo, miembro_id)

    # El match sale de la fila del miembro (email + user_id ya guardados), no
    # de parámetros: así el criterio es uno solo y no depende de qué mandó el
    # cliente. Si el miembro no tiene email ni user_id, las comparaciones dan
    # NULL y el count queda en 0 — correcto, esa persona nunca pudo firmar.
    firmadas = (
        await db.scalar(
            text(
                """SELECT count(*)
                   FROM core.oc_firmas f
                   JOIN core.ordenes_compra oc ON oc.oc_id = f.oc_id
                   JOIN core.empresa_equipo m
                     ON m.miembro_id = :mid AND m.empresa_codigo = :codigo
                   WHERE f.status = 'FIRMADA'
                     AND oc.empresa_codigo = :codigo
                     AND (
                         lower(f.firmante_email) = lower(m.email)
                         OR f.firmante_user_id = m.user_id
                     )"""
            ),
            {"mid": miembro_id, "codigo": codigo},
        )
        or 0
    )

    if int(firmadas) > 0:
        await db.execute(
            text(
                """UPDATE core.empresa_equipo
                   SET activo = FALSE, updated_at = NOW()
                   WHERE miembro_id = :mid AND empresa_codigo = :codigo"""
            ),
            {"mid": miembro_id, "codigo": codigo},
        )
        detalle = (
            f"{miembro.nombre} ya firmó {int(firmadas)} "
            f"OC{'s' if int(firmadas) != 1 else ''} de {codigo}, así que no se "
            f"borra: quedó DESACTIVADO. No va a aparecer más en los firmantes "
            f"sugeridos, pero se conserva el registro de lo que firmó."
        )
        await audit_log(
            db,
            None,
            user,
            action="empresa_equipo.desactivado",
            entity_type="empresa_equipo",
            entity_id=str(miembro_id),
            entity_label=f"{codigo} · {miembro.nombre}",
            summary=detalle,
            before={"activo": True},
            after={"activo": False, "firmas_firmadas": int(firmadas)},
        )
        await db.commit()
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "miembro_id": miembro_id,
                "eliminado": False,
                "desactivado": True,
                "firmas_firmadas": int(firmadas),
                "detail": detalle,
            },
        )

    await db.execute(
        text(
            """DELETE FROM core.empresa_equipo
               WHERE miembro_id = :mid AND empresa_codigo = :codigo"""
        ),
        {"mid": miembro_id, "codigo": codigo},
    )
    await audit_log(
        db,
        None,
        user,
        action="empresa_equipo.eliminado",
        entity_type="empresa_equipo",
        entity_id=str(miembro_id),
        entity_label=f"{codigo} · {miembro.nombre}",
        summary=f"{miembro.nombre} eliminado del equipo firmante de {codigo}",
        before={
            "nombre": miembro.nombre,
            "cargo": miembro.cargo,
            "email": miembro.email,
            "es_default": miembro.es_default,
        },
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/empresas/{codigo}/equipo/orden", response_model=list[MiembroRead])
async def reordenar_equipo(
    codigo: str,
    body: EquipoOrdenRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
) -> list[MiembroRead]:
    """Reasigna `orden` = posición+1 según la lista recibida.

    El orden importa: es el que se imprime en el PDF (columna de firmas) y el
    que define el orden de invitación. Se resuelve en UN solo UPDATE con
    UNNEST ... WITH ORDINALITY — con 5-6 miembros un UPDATE por fila también
    andaría, pero cada UPDATE dispara el trigger que re-arma los JSONB de
    `core.empresas`, así que multiplicarlos multiplica escrituras.
    """
    await assert_empresa_access(user, db, codigo)

    ids = body.miembro_ids
    if len(set(ids)) != len(ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La lista de orden tiene miembros repetidos.",
        )

    # Validación en LOTE: que todos los ids sean de ESTA empresa. Sin esto,
    # el UPDATE filtra por empresa_codigo y los ajenos se ignorarían en
    # silencio — el operador vería un orden que no se guardó.
    propios = {
        r[0]
        for r in (
            await db.execute(
                text(
                    """SELECT miembro_id FROM core.empresa_equipo
                       WHERE empresa_codigo = :codigo
                         AND miembro_id = ANY(:ids)"""
                ),
                {"codigo": codigo, "ids": ids},
            )
        ).all()
    }
    ajenos = [i for i in ids if i not in propios]
    if ajenos:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Estos miembros no son del equipo de {codigo}: {ajenos}. "
                f"Recargá la pantalla y volvé a ordenar."
            ),
        )

    await db.execute(
        text(
            """UPDATE core.empresa_equipo m
               SET orden = t.pos::int, updated_at = NOW()
               FROM unnest(CAST(:ids AS BIGINT[])) WITH ORDINALITY AS t(id, pos)
               WHERE m.miembro_id = t.id AND m.empresa_codigo = :codigo"""
        ),
        {"ids": ids, "codigo": codigo},
    )
    await audit_log(
        db,
        None,
        user,
        action="empresa_equipo.reordenado",
        entity_type="empresa_equipo",
        entity_id=codigo,
        entity_label=codigo,
        summary=f"Orden de firmantes de {codigo} actualizado ({len(ids)} miembros)",
        after={"orden": ids},
    )
    await db.commit()
    return await _listar_miembros(db, codigo)
