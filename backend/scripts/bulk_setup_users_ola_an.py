"""V5++ ola AN — Bulk setup de los 43 usuarios reales + roles + credenciales.

Crea TODOS los usuarios de un saque (no uno por uno desde Supabase Dashboard).

Acciones:
    1. Verifica que CEHTA empresa exista en core.empresas (la crea si falta)
    2. Por cada usuario en USERS_CONFIG:
       a. Genera password único (Cehta-XXXX formato fácil de pronunciar)
       b. POST a Supabase Admin API → crea o ubica user_id
       c. Si app_role='admin' → upsert en core.user_roles
       d. Por cada empresa asignada → INSERT en core.user_company_roles
    3. Genera CSV /app/cehta-credentials-{timestamp}.csv con email+password+empresas+rol
    4. Sube el CSV a Dropbox /Cehta Capital/Internal/ si está configurado
    5. Imprime tabla resumen al stdout para copy-paste fácil

Idempotente:
    - Si user existe en auth.users, lo reusa (Supabase devuelve 422, lo buscamos por email)
    - Si rol ya está asignado, ON CONFLICT DO NOTHING
    - Empresa CEHTA con ON CONFLICT DO NOTHING

SAFETY:
    - NO toca passwords de users que ya existen (Supabase no permite reset sin token)
    - Si querés reset → desde Supabase Dashboard
    - El CSV solo tiene contraseñas de los usuarios NUEVOS (los pre-existentes
      aparecen con password='[YA EXISTÍA - PEDIR RESET]')

Uso:
    fly ssh console -a cehta-backend
    python -m scripts.bulk_setup_users_ola_an

    Verás al final una tabla copy-paste-able + path al CSV.
"""
from __future__ import annotations

import asyncio
import csv
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.config import settings

log = structlog.get_logger(__name__)


# =====================================================================
# Configuración de usuarios (los 43)
# =====================================================================

# Empresas válidas (la 7ma CEHTA se crea si falta)
EMPRESAS_VALIDAS = {"CEHTA", "EVOQUE", "CSL", "REVTECH", "RHO", "TRONGKAI", "DTE"}
TODAS = sorted(EMPRESAS_VALIDAS)


def _u(email: str, empresas: list[str], rol: str, app_role: str | None = None) -> dict:
    """Helper: define un user con sus empresas + rol."""
    return {
        "email": email.strip().lower(),
        "empresas": empresas,
        "rol": rol,  # CONTADOR | GG | DIRECTOR
        "app_role": app_role,  # 'admin' o None (default 'editor')
    }


USERS_CONFIG: list[dict] = [
    # =========================================================
    # ADMIN GLOBAL — acceso total + Director (firma final)
    # =========================================================
    _u("contactocehta@gmail.com",      TODAS, "DIRECTOR", app_role="admin"),
    _u("grietta@cehtacapital.com",     TODAS, "DIRECTOR", app_role="admin"),

    # =========================================================
    # CEHTA — 6 usuarios CONTADOR
    # =========================================================
    _u("contacto@cehtacapital.com",    ["CEHTA"], "CONTADOR"),
    _u("esaez@cehtacapital.com",       ["CEHTA"], "CONTADOR"),
    _u("afernandez@cehtacapital.com",  ["CEHTA"], "CONTADOR"),
    _u("nrietta@cehtacapital.com",     ["CEHTA"], "CONTADOR"),
    _u("jpvelasco@cehtacapital.com",   ["CEHTA"], "CONTADOR"),
    _u("emendez@cehtacapital.com",     ["CEHTA"], "CONTADOR"),

    # =========================================================
    # EVOQUE — 1 aprobador (GG) + 7 contadores
    # =========================================================
    _u("jiprieto@evoquenergy.com",     ["EVOQUE"], "GG"),  # APROBADOR
    _u("contacto@evoquenergy.com",     ["EVOQUE"], "CONTADOR"),
    _u("jprieto@evoquenergy.com",      ["EVOQUE"], "CONTADOR"),
    _u("tarias@evoquenergy.com",       ["EVOQUE"], "CONTADOR"),
    _u("plillo@evoquenergy.com",       ["EVOQUE"], "CONTADOR"),
    _u("currutila@evoquenergy.com",    ["EVOQUE"], "CONTADOR"),
    _u("patricia.lillo@evoquenergy.com", ["EVOQUE"], "CONTADOR"),
    _u("fzuniga@evoquenergy.com",      ["EVOQUE"], "CONTADOR"),

    # =========================================================
    # REVTECH — 1 aprobador + 6 contadores
    # =========================================================
    _u("camilo@revtech.cl",            ["REVTECH"], "GG"),  # APROBADOR
    _u("alejandro@revtech.cl",         ["REVTECH"], "CONTADOR"),
    _u("claudia@revtech.cl",           ["REVTECH"], "CONTADOR"),
    _u("contabilidad@revtech.cl",      ["REVTECH"], "CONTADOR"),
    _u("contacto@revtech.cl",          ["REVTECH"], "CONTADOR"),
    _u("milton.binimelis@revtech.cl",  ["REVTECH"], "CONTADOR"),
    _u("nicolas@revtech.cl",           ["REVTECH"], "CONTADOR"),

    # =========================================================
    # CSL — 1 aprobador + 5 contadores
    # =========================================================
    _u("jgonzalez@climatesmartleasing.com", ["CSL"], "GG"),  # APROBADOR
    _u("josevarela@climatesmartleasing.com", ["CSL"], "CONTADOR"),
    _u("contacto@climatesmartleasing.com",   ["CSL"], "CONTADOR"),
    _u("egon.n@climatesmartleasing.com",     ["CSL"], "CONTADOR"),
    _u("mgrez@climatesmartleasing.com",      ["CSL"], "CONTADOR"),
    _u("ventas@climatesmartleasing.com",     ["CSL"], "CONTADOR"),

    # =========================================================
    # RHO — 1 aprobador + 5 contadores
    # =========================================================
    _u("j.alvarez@rhoingenieria.cl",         ["RHO"], "GG"),  # APROBADOR
    _u("denisse.escobar@rhoingenieria.cl",   ["RHO"], "CONTADOR"),
    _u("javiera.vargas@rhoingenieria.cl",    ["RHO"], "CONTADOR"),
    _u("fernanda.tapia@rhoingenieria.cl",    ["RHO"], "CONTADOR"),
    _u("victoria.alvarez@rhoingenieria.cl",  ["RHO"], "CONTADOR"),
    _u("bryan.escobedo@rhoingenieria.cl",    ["RHO"], "CONTADOR"),

    # =========================================================
    # TRONGKAI — 1 aprobador + 3 contadores
    # =========================================================
    _u("jocuevas@trongkai.com",        ["TRONGKAI"], "GG"),  # APROBADOR
    _u("jaime@trongkai.com",           ["TRONGKAI"], "CONTADOR"),
    _u("claudia@trongkai.com",         ["TRONGKAI"], "CONTADOR"),
    _u("carlos@trongkai.com",          ["TRONGKAI"], "CONTADOR"),

    # =========================================================
    # DTE — 1 aprobador + 3 contadores
    # =========================================================
    _u("czuniga@dteconsulting.cl",     ["DTE"], "GG"),  # APROBADOR
    _u("fzuniga@dteconsulting.cl",     ["DTE"], "CONTADOR"),
    _u("ncaro@dteconsulting.cl",       ["DTE"], "CONTADOR"),
    _u("asalgado@dteconsulting.cl",    ["DTE"], "CONTADOR"),
]


# =====================================================================
# Helpers
# =====================================================================


def generate_password(email: str) -> str:
    """Genera password única, legible. Pattern: Cehta-{ShortName}-{4digits}.

    Ejemplo:
        jiprieto@evoquenergy.com → Cehta-Jiprie-4823
        contactocehta@gmail.com  → Cehta-Contac-9012
    """
    short = email.split("@")[0][:6].capitalize()
    short = "".join(c for c in short if c.isalnum())
    digits = "".join(secrets.choice("0123456789") for _ in range(4))
    return f"Cehta-{short}-{digits}"


async def find_user_id_by_email(session: AsyncSession, email: str) -> str | None:
    result = await session.execute(
        text("SELECT id FROM auth.users WHERE email = :email LIMIT 1"),
        {"email": email},
    )
    row = result.first()
    return str(row[0]) if row else None


async def supabase_create_user(
    client: httpx.AsyncClient, email: str, password: str
) -> tuple[str | None, bool]:
    """Crea user en Supabase Auth via Admin API.

    Returns: (user_id, was_newly_created). Si el usuario ya existía, devuelve
    (existing_id, False) y NO modifica su password.
    """
    url = f"{str(settings.supabase_url).rstrip('/')}/auth/v1/admin/users"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,  # skip email verification flow
    }
    try:
        resp = await client.post(url, headers=headers, json=payload, timeout=20)
    except Exception as exc:  # noqa: BLE001
        print(f"  ❌ NETWORK ERROR para {email}: {exc}")
        return None, False

    if resp.status_code in (200, 201):
        data = resp.json()
        return data.get("id"), True

    # 422 = user already exists
    if resp.status_code == 422:
        body = resp.text.lower()
        if "already" in body or "registered" in body or "duplicate" in body:
            return None, False  # caller buscará por email en DB

    print(f"  ❌ Supabase {resp.status_code} para {email}: {resp.text[:200]}")
    return None, False


async def ensure_empresa_cehta(session: AsyncSession) -> None:
    """Crea empresa CEHTA si no existe (la 7ma)."""
    exists = await session.scalar(
        text("SELECT 1 FROM core.empresas WHERE codigo = 'CEHTA'")
    )
    if exists:
        print("✓ Empresa CEHTA ya existe")
        return
    print("→ Creando empresa CEHTA (Cehta Capital — AFIS)...")
    await session.execute(
        text(
            """
            INSERT INTO core.empresas (codigo, razon_social, rut, activo, direccion, ciudad)
            VALUES (
                'CEHTA',
                'AFIS — Administradora de Fondos de la Industria Sostenible S.A.',
                '77.423.556-6',
                TRUE,
                'Av. del Parque 4680-A of. 302',
                'Huechuraba'
            )
            ON CONFLICT (codigo) DO NOTHING
            """
        )
    )
    await session.commit()


async def assign_app_role(
    session: AsyncSession, user_id: str, app_role: str
) -> None:
    """Upsert en core.user_roles (global app_role para admin)."""
    await session.execute(
        text(
            """
            INSERT INTO core.user_roles (user_id, app_role)
            VALUES (:uid, :role)
            ON CONFLICT (user_id) DO UPDATE SET app_role = EXCLUDED.app_role,
                                                 updated_at = now()
            """
        ),
        {"uid": user_id, "role": app_role},
    )


async def assign_company_role(
    session: AsyncSession,
    user_id: str,
    empresa_codigo: str,
    role: str,
    email: str,
) -> bool:
    """Insert en core.user_company_roles. Idempotent.

    Returns True si insertó nueva fila, False si ya existía.
    """
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
        {
            "uid": user_id,
            "emp": empresa_codigo,
            "role": role,
            "notas": f"Bulk setup Ola AN — {email} — {datetime.now(timezone.utc).isoformat()}",
        },
    )
    return result.first() is not None


# =====================================================================
# Main
# =====================================================================


async def main() -> int:
    print("=" * 70)
    print("Ola AN — Bulk setup de 43 usuarios + roles + credenciales")
    print("=" * 70)

    engine = create_async_engine(settings.database_url, pool_pre_ping=True)

    credentials: list[dict] = []
    stats = {
        "created": 0,
        "existed": 0,
        "errors": 0,
        "roles_assigned": 0,
        "roles_existed": 0,
    }

    async with httpx.AsyncClient() as http:
        async with AsyncSession(engine) as session:
            # 1. CEHTA empresa
            await ensure_empresa_cehta(session)

            print(f"\n→ Procesando {len(USERS_CONFIG)} usuarios...\n")

            for i, u in enumerate(USERS_CONFIG, 1):
                email = u["email"]
                password = generate_password(email)

                # 2. Crear o buscar user en Supabase
                user_id, was_created = await supabase_create_user(
                    http, email, password
                )

                if not user_id:
                    # No se creó (porque ya existe). Buscar por email.
                    user_id = await find_user_id_by_email(session, email)
                    if user_id:
                        stats["existed"] += 1
                        password_display = "[YA EXISTÍA - reset desde Supabase Dashboard]"
                    else:
                        stats["errors"] += 1
                        print(f"  [{i}/{len(USERS_CONFIG)}] ❌ {email} — no se pudo crear ni encontrar")
                        continue
                else:
                    stats["created"] += 1
                    password_display = password
                    print(f"  [{i}/{len(USERS_CONFIG)}] ✓ {email}  (NUEVO)")

                # 3. app_role si es admin
                if u.get("app_role"):
                    await assign_app_role(session, user_id, u["app_role"])

                # 4. Asignar roles por empresa
                for emp in u["empresas"]:
                    if emp not in EMPRESAS_VALIDAS:
                        print(f"  ⚠ Empresa '{emp}' no válida — skip")
                        continue
                    inserted = await assign_company_role(
                        session, user_id, emp, u["rol"], email
                    )
                    if inserted:
                        stats["roles_assigned"] += 1
                    else:
                        stats["roles_existed"] += 1

                credentials.append(
                    {
                        "email": email,
                        "password": password_display,
                        "empresas": ",".join(u["empresas"]),
                        "rol_por_empresa": u["rol"],
                        "app_role": u.get("app_role") or "editor",
                        "user_id": user_id,
                    }
                )

            await session.commit()

    # 5. Escribir CSV
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    csv_path = Path(f"/app/cehta-credentials-{timestamp}.csv")
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "email", "password", "empresas",
                "rol_por_empresa", "app_role", "user_id"
            ],
        )
        writer.writeheader()
        writer.writerows(credentials)

    # 6. Upload a Dropbox si está configurado
    dropbox_path = None
    try:
        from app.services.dropbox_service import DropboxService, DropboxNotConfigured

        dbx = DropboxService()
        with csv_path.open("rb") as f:
            content = f.read()
        remote = f"/Cehta Capital/Internal/cehta-credentials-{timestamp}.csv"
        dbx.upload_file(remote, content)
        dropbox_path = remote
        print(f"\n📤 Subido a Dropbox: {dropbox_path}")
    except Exception as exc:  # noqa: BLE001
        print(f"\n⚠ No se subió a Dropbox: {exc}")

    # 7. Resumen + tabla
    print("\n" + "=" * 70)
    print("RESUMEN")
    print("=" * 70)
    print(f"  Usuarios NUEVOS creados:    {stats['created']}")
    print(f"  Usuarios ya existían:        {stats['existed']}")
    print(f"  Errores:                     {stats['errors']}")
    print(f"  Roles asignados nuevos:      {stats['roles_assigned']}")
    print(f"  Roles ya existían:           {stats['roles_existed']}")
    print(f"\n  CSV local:    {csv_path}")
    if dropbox_path:
        print(f"  Dropbox:      {dropbox_path}")

    # Tabla compacta copy-paste
    print("\n" + "=" * 70)
    print("CREDENCIALES (COPIAR ESTA TABLA Y GUARDAR EN LUGAR SEGURO):")
    print("=" * 70)
    print(f"\n{'EMAIL':<42} {'PASSWORD':<28} {'EMPRESAS':<30} {'ROL':<10}")
    print("-" * 120)
    for c in credentials:
        emps = c["empresas"][:28]
        print(
            f"{c['email']:<42} {c['password']:<28} {emps:<30} {c['rol_por_empresa']:<10}"
        )
    print()

    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
