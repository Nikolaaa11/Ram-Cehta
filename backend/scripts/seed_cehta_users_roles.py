"""V5++ ola AC — Seed de asignación de roles por empresa para Cehta.

USO:
    Ejecutar UNA SOLA VEZ después de:
      1. Crear los 8 usuarios en Supabase Auth (ver tabla maestra en docs)
      2. Aplicar migración 0048 (alembic upgrade head)

    fly ssh console -a cehta-backend
    python -m scripts.seed_cehta_users_roles

QUÉ HACE:
    - Busca por email en auth.users los 8 usuarios (6 contadores + líder + Guido)
    - Asigna roles en core.user_company_roles:
        * Contador-{empresa} → CONTADOR @ su empresa
        * contactocehta@gmail.com → GG @ todas las 6 empresas
        * grietta@cehtacapital.com → DIRECTOR @ todas las 6 empresas
    - Idempotente: si ya existe la asignación, no la duplica

SAFETY:
    - NO modifica passwords, emails, ni borra users
    - Si un email no existe en auth.users, lo loggea y sigue (no rompe)
    - Si la empresa no existe en core.empresas, lo loggea y sigue
"""
from __future__ import annotations

import asyncio
import sys

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession

from app.core.config import settings

log = structlog.get_logger(__name__)


# Mapping email → (rol, empresas a asignar)
SEED_USERS: list[tuple[str, str, list[str]]] = [
    # Contadores (1 por empresa) — solo crean+submit, NO firman
    ("contador-evoque@cehtacapital.com",    "CONTADOR", ["EVOQUE"]),
    ("contador-csl@cehtacapital.com",       "CONTADOR", ["CSL"]),
    ("contador-revtech@cehtacapital.com",   "CONTADOR", ["REVTECH"]),
    ("contador-trongkai@cehtacapital.com",  "CONTADOR", ["TRONGKAI"]),
    ("contador-dte@cehtacapital.com",       "CONTADOR", ["DTE"]),
    ("contador-rho@cehtacapital.com",       "CONTADOR", ["RHO"]),

    # Líder único (mientras no haya 6 reales) — firma 1er paso en todas
    ("contactocehta@gmail.com", "GG",
        ["EVOQUE", "CSL", "REVTECH", "TRONGKAI", "DTE", "RHO"]),

    # Guido — firma final en todas
    ("grietta@cehtacapital.com", "DIRECTOR",
        ["EVOQUE", "CSL", "REVTECH", "TRONGKAI", "DTE", "RHO"]),
]


async def find_user_id_by_email(session: AsyncSession, email: str) -> str | None:
    """Busca user_id en auth.users por email (Supabase)."""
    result = await session.execute(
        text("SELECT id FROM auth.users WHERE email = :email LIMIT 1"),
        {"email": email},
    )
    row = result.first()
    return str(row[0]) if row else None


async def empresa_exists(session: AsyncSession, codigo: str) -> bool:
    """Verifica que la empresa exista y esté activa."""
    result = await session.scalar(
        text(
            "SELECT 1 FROM core.empresas WHERE codigo = :c AND activo = TRUE"
        ),
        {"c": codigo},
    )
    return result is not None


async def assign_role(
    session: AsyncSession,
    user_id: str,
    empresa_codigo: str,
    role: str,
    notas: str,
) -> bool:
    """Inserta en user_company_roles. Idempotente. Devuelve True si insertó."""
    result = await session.execute(
        text(
            """
            INSERT INTO core.user_company_roles
                (user_id, empresa_codigo, role, active, notas)
            VALUES (:uid, :emp, :role, TRUE, :notas)
            ON CONFLICT (user_id, empresa_codigo, role) DO NOTHING
            RETURNING user_id
            """
        ),
        {"uid": user_id, "emp": empresa_codigo, "role": role, "notas": notas},
    )
    inserted = result.first() is not None
    return inserted


async def main() -> int:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)

    seeded = 0
    skipped = 0
    errors = 0

    async with AsyncSession(engine) as session:
        for email, role, empresas in SEED_USERS:
            user_id = await find_user_id_by_email(session, email)
            if not user_id:
                log.warning(
                    "user_not_found_skipping",
                    email=email,
                    hint="crear en Supabase Auth primero",
                )
                errors += 1
                continue

            for empresa_codigo in empresas:
                if not await empresa_exists(session, empresa_codigo):
                    log.warning(
                        "empresa_not_found_skipping",
                        codigo=empresa_codigo,
                    )
                    errors += 1
                    continue

                inserted = await assign_role(
                    session,
                    user_id=user_id,
                    empresa_codigo=empresa_codigo,
                    role=role,
                    notas=(
                        f"Seed Ola AC — {role} para {empresa_codigo}. "
                        f"Email: {email}"
                    ),
                )
                if inserted:
                    seeded += 1
                    log.info(
                        "role_assigned",
                        email=email,
                        empresa=empresa_codigo,
                        role=role,
                    )
                else:
                    skipped += 1
                    log.debug(
                        "role_already_exists",
                        email=email,
                        empresa=empresa_codigo,
                        role=role,
                    )

        await session.commit()

    log.info(
        "seed_done",
        seeded=seeded,
        skipped_existing=skipped,
        errors=errors,
    )
    print(
        f"\n✅ Seed completo:\n"
        f"   - {seeded} asignaciones nuevas\n"
        f"   - {skipped} ya existían (idempotente)\n"
        f"   - {errors} errores (usuario o empresa no encontrada)\n"
    )

    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
