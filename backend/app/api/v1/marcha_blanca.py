"""Round 128 — Checklist en vivo de pre-marcha-blanca.

  GET /api/v1/admin/marcha-blanca/checklist
    Retorna estado actual de cada criterio bloqueante vs importante vs
    nice-to-have. El frontend /admin/marcha-blanca lo consume.

Criterios divididos en categorías:
  A. Infraestructura       — backend vivo, backups, sin incidentes
  B. Migraciones SQL       — R115, R117, R123, R124, R126 aplicadas
  C. Datos base            — 9 empresas, plan cuentas, proyectos
  D. Credenciales          — Fernet key, SII, Previred
  E. Reglas aprobación     — rules + user-company-roles
  F. Test E2E              — al menos 1 voucher completo cycle
  G. People                — admins con 2FA
  H. Integraciones         — Dropbox, email, etc
  I. Operacional           — monitor cron + auto sync activos
  J. Performance           — pooler, workers, latencia
  K. Avanzado              — Nubox API, etc

Cada check devuelve:
  - id (string slug único)
  - category (A-K)
  - title (descripción humana)
  - severity (BLOCKER | IMPORTANT | NICE_TO_HAVE)
  - status (OK | WARN | FAIL | SKIPPED)
  - detail (mensaje contextual con sugerencia de acción)
  - action_url (opcional, link a la pantalla para resolver)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.core.security import AuthenticatedUser

log = logging.getLogger(__name__)
router = APIRouter()


# =====================================================================
# Schemas
# =====================================================================


class CheckResult(BaseModel):
    id: str
    category: str
    title: str
    severity: Literal["BLOCKER", "IMPORTANT", "NICE_TO_HAVE"]
    status: Literal["OK", "WARN", "FAIL", "SKIPPED"]
    detail: str
    action_url: str | None = None
    action_label: str | None = None


class CategorySummary(BaseModel):
    code: str
    name: str
    total: int
    ok: int
    warn: int
    fail: int
    skipped: int
    progress_pct: float


class MarchaBlancaReport(BaseModel):
    generated_at: datetime
    overall_status: Literal["READY", "ALMOST_READY", "NOT_READY", "NEEDS_ATTENTION"]
    blockers_total: int
    blockers_ok: int
    blockers_fail: int
    important_total: int
    important_ok: int
    important_fail: int
    nice_total: int
    nice_ok: int
    categories: list[CategorySummary]
    checks: list[CheckResult]
    next_action: str


# =====================================================================
# Categorías
# =====================================================================


CATEGORIES = {
    "A": "Infraestructura",
    "B": "Migraciones SQL",
    "C": "Datos base",
    "D": "Credenciales cifradas",
    "E": "Reglas de aprobación",
    "F": "Test E2E voucher cycle",
    "G": "People & accesos",
    "H": "Integraciones externas",
    "I": "Operacional (crons)",
    "J": "Performance",
    "K": "Avanzado",
}


# =====================================================================
# Helpers de check (cada uno devuelve CheckResult)
# =====================================================================


async def _table_exists(db: Any, schema: str, table: str) -> bool:
    row = (
        await db.execute(
            text(
                """
                SELECT EXISTS (SELECT 1 FROM information_schema.tables
                               WHERE table_schema = :s AND table_name = :t)
                """
            ),
            {"s": schema, "t": table},
        )
    ).fetchone()
    return bool(row[0])


async def _column_exists(db: Any, schema: str, table: str, column: str) -> bool:
    row = (
        await db.execute(
            text(
                """
                SELECT EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_schema = :s AND table_name = :t
                                 AND column_name = :c)
                """
            ),
            {"s": schema, "t": table, "c": column},
        )
    ).fetchone()
    return bool(row[0])


async def _count(db: Any, sql: str, params: dict | None = None) -> int:
    try:
        row = (await db.execute(text(sql), params or {})).fetchone()
        return int(row[0] or 0) if row else 0
    except Exception:
        return -1  # tabla no existe / query inválida


# =====================================================================
# Builder de checks
# =====================================================================


async def _build_checks(db: Any, user: AuthenticatedUser) -> list[CheckResult]:
    checks: list[CheckResult] = []

    # ---- A. Infraestructura ----
    # A1: Si esta endpoint responde es porque backend vive → automático OK
    checks.append(CheckResult(
        id="A1_backend_alive",
        category="A", severity="BLOCKER", status="OK",
        title="Backend respondiendo (/health 200)",
        detail="Si estás viendo esto, el backend está vivo y respondiendo.",
    ))

    # A2: Último backup
    last_backup_age_h: int | None = None
    try:
        row = (
            await db.execute(
                text(
                    """
                    SELECT EXTRACT(EPOCH FROM (NOW() - MAX(uploaded_at)))::INT / 3600
                    FROM core.system_backups WHERE status = 'OK'
                    """
                )
            )
        ).fetchone()
        if row and row[0] is not None:
            last_backup_age_h = int(row[0])
    except Exception:
        last_backup_age_h = None

    if last_backup_age_h is None:
        checks.append(CheckResult(
            id="A2_backup_recent", category="A", severity="IMPORTANT",
            status="WARN",
            title="Backup DB reciente",
            detail="No se encuentra backup registrado. Configurar backup_cron en Fly.",
        ))
    elif last_backup_age_h > 72:
        checks.append(CheckResult(
            id="A2_backup_recent", category="A", severity="BLOCKER",
            status="FAIL",
            title="Backup DB reciente",
            detail=f"Último backup hace {last_backup_age_h}h (>72h). Crítico para marcha blanca.",
        ))
    elif last_backup_age_h > 36:
        checks.append(CheckResult(
            id="A2_backup_recent", category="A", severity="IMPORTANT",
            status="WARN",
            title="Backup DB reciente",
            detail=f"Último backup hace {last_backup_age_h}h (>36h umbral warning).",
        ))
    else:
        checks.append(CheckResult(
            id="A2_backup_recent", category="A", severity="IMPORTANT",
            status="OK",
            title="Backup DB reciente",
            detail=f"Último backup hace {last_backup_age_h}h. OK.",
        ))

    # A3: Incidentes críticos abiertos (R126)
    if await _table_exists(db, "core", "system_incidents"):
        critical_open = await _count(
            db,
            "SELECT COUNT(*) FROM core.system_incidents "
            "WHERE status != 'RESOLVED' AND severity = 'CRITICAL'",
        )
        if critical_open > 0:
            checks.append(CheckResult(
                id="A3_no_critical_incidents", category="A",
                severity="BLOCKER", status="FAIL",
                title="Sin incidentes CRITICAL abiertos",
                detail=f"{critical_open} incidentes críticos abiertos. Resolver antes de marcha blanca.",
                action_url="/admin/incidents",
            ))
        else:
            checks.append(CheckResult(
                id="A3_no_critical_incidents", category="A",
                severity="BLOCKER", status="OK",
                title="Sin incidentes CRITICAL abiertos",
                detail="0 incidentes críticos. OK.",
            ))

    # ---- B. Migraciones SQL ----
    migration_tables = [
        ("B1_R115_credenciales",
         "Migración R115 (credenciales cifradas + directorio + inversionistas)",
         "empresa_credenciales",
         "Ejecutar backend/scripts/sql/round115_migration.sql en Supabase Studio"),
        ("B2_R117_sii", "Migración R117 (SII)",
         "sii_documentos",
         "Ejecutar backend/scripts/sql/round117_sii_migration.sql"),
        ("B3_R123_nubox", "Migración R123 (Nubox remuneraciones)",
         "nubox_remuneraciones",
         "Ejecutar backend/scripts/sql/round123_nubox_migration.sql"),
        ("B4_R124_nubox_api", "Migración R124 (Nubox API REST)",
         "nubox_api_credenciales",
         "Ejecutar backend/scripts/sql/round124_nubox_api_migration.sql"),
        ("B5_R126_monitor", "Migración R126 (monitor + auto sync)",
         "system_health_checks",
         "Ejecutar backend/scripts/sql/round126_monitor_migration.sql"),
    ]
    for check_id, title, table, action in migration_tables:
        exists = await _table_exists(db, "core", table)
        checks.append(CheckResult(
            id=check_id, category="B",
            severity="BLOCKER",
            status="OK" if exists else "FAIL",
            title=title,
            detail=(
                f"Tabla core.{table} existe."
                if exists
                else f"Tabla core.{table} NO existe. Acción: {action}"
            ),
        ))

    # ---- C. Datos base ----
    empresas_activas = await _count(
        db, "SELECT COUNT(*) FROM core.empresas WHERE activo = TRUE"
    )
    checks.append(CheckResult(
        id="C1_empresas_activas", category="C",
        severity="BLOCKER",
        status="OK" if empresas_activas >= 9 else "FAIL",
        title="≥9 empresas activas",
        detail=f"{empresas_activas} empresas activas en core.empresas.",
    ))

    # C2: Empresas con datos completos (RUT, web, dirección SII)
    if await _column_exists(db, "core", "empresas", "pagina_web"):
        empresas_completas = await _count(
            db,
            """
            SELECT COUNT(*) FROM core.empresas
            WHERE activo = TRUE
              AND rut IS NOT NULL
              AND pagina_web IS NOT NULL
              AND direccion_sii IS NOT NULL
              AND giro IS NOT NULL
            """,
        )
        checks.append(CheckResult(
            id="C2_empresas_completas", category="C",
            severity="IMPORTANT",
            status="OK" if empresas_completas >= 8 else "WARN",
            title="Empresas con datos completos (web/RUT/dirección SII/giro)",
            detail=(
                f"{empresas_completas}/9 empresas con datos completos. "
                "Si no, correr scripts/seed_empresas_excel_round116.py"
            ),
            action_url="/admin/data",
        ))
    else:
        checks.append(CheckResult(
            id="C2_empresas_completas", category="C",
            severity="IMPORTANT", status="SKIPPED",
            title="Empresas con datos completos",
            detail="Migración R115 no aplicada — no se puede chequear esta columna.",
        ))

    # C3: Plan de cuentas
    plan_cuentas_count = await _count(
        db, "SELECT COUNT(*) FROM core.plan_cuentas"
    )
    checks.append(CheckResult(
        id="C3_plan_cuentas", category="C",
        severity="BLOCKER",
        status="OK" if plan_cuentas_count >= 100 else "FAIL",
        title="Plan de cuentas (≥100)",
        detail=f"{plan_cuentas_count} cuentas. Crítico para asientos contables.",
    ))

    # C4: Areas (centros de costo)
    areas_count = await _count(db, "SELECT COUNT(*) FROM core.areas")
    checks.append(CheckResult(
        id="C4_areas", category="C",
        severity="IMPORTANT",
        status="OK" if areas_count >= 5 else "WARN",
        title="Centros de costo (Areas)",
        detail=f"{areas_count} áreas configuradas.",
    ))

    # C5: Proyectos contables
    proyectos_count = await _count(
        db, "SELECT COUNT(*) FROM core.proyectos_contables"
    )
    checks.append(CheckResult(
        id="C5_proyectos", category="C",
        severity="IMPORTANT",
        status="OK" if proyectos_count >= 30 else "WARN",
        title="Proyectos contables (≥30)",
        detail=f"{proyectos_count} proyectos cargados.",
    ))

    # C6: Subsidio CORFO
    corfo_activo = await _count(
        db,
        "SELECT COUNT(*) FROM core.subsidios "
        "WHERE codigo = 'CORFO-2026-REVTECH-TRONGKAI' AND estado = 'ACTIVO'",
    )
    checks.append(CheckResult(
        id="C6_subsidio_corfo", category="C",
        severity="BLOCKER",
        status="OK" if corfo_activo > 0 else "FAIL",
        title="Subsidio CORFO REVTECH/TRONGKAI activo",
        detail=(
            "Subsidio $3.000.000.000 cargado y activo."
            if corfo_activo > 0
            else "Subsidio CORFO no encontrado o no activo."
        ),
    ))

    # C7-C8: Directorio + Inversionistas
    if await _table_exists(db, "core", "directorio_miembros"):
        dir_count = await _count(
            db,
            "SELECT COUNT(*) FROM core.directorio_miembros WHERE activo = TRUE",
        )
        checks.append(CheckResult(
            id="C7_directorio", category="C",
            severity="IMPORTANT",
            status="OK" if dir_count >= 5 else "WARN",
            title="Directorio formal (≥5 miembros)",
            detail=f"{dir_count} miembros activos.",
            action_url="/admin/data",
        ))
    if await _table_exists(db, "core", "inversionistas_aportantes"):
        inv_count = await _count(
            db,
            "SELECT COUNT(*) FROM core.inversionistas_aportantes WHERE activo = TRUE",
        )
        checks.append(CheckResult(
            id="C8_inversionistas", category="C",
            severity="IMPORTANT",
            status="OK" if inv_count >= 5 else "WARN",
            title="Inversionistas/Aportantes (≥5)",
            detail=f"{inv_count} aportantes activos.",
            action_url="/admin/data",
        ))

    # ---- D. Credenciales ----
    # D1: Fernet key — chequear que credentials_service responde OK
    try:
        from app.services.credentials_service import health_check as cred_health
        h = cred_health()
        if h.get("configured") and h.get("round_trip_ok"):
            checks.append(CheckResult(
                id="D1_fernet_key", category="D", severity="BLOCKER", status="OK",
                title="CREDENTIALS_FERNET_KEY configurada",
                detail="Cifrado funcionando OK.",
            ))
        else:
            checks.append(CheckResult(
                id="D1_fernet_key", category="D", severity="BLOCKER", status="FAIL",
                title="CREDENTIALS_FERNET_KEY configurada",
                detail=(
                    "Sin Fernet key. Las credenciales SII/Previred/Nubox no pueden "
                    "cifrarse. Setear: fly secrets set CREDENTIALS_FERNET_KEY=..."
                ),
            ))
    except Exception as exc:  # noqa: BLE001
        checks.append(CheckResult(
            id="D1_fernet_key", category="D", severity="BLOCKER", status="FAIL",
            title="CREDENTIALS_FERNET_KEY configurada",
            detail=f"Error verificando: {exc}",
        ))

    # D2: Credenciales SII cargadas
    if await _table_exists(db, "core", "empresa_credenciales"):
        sii_count = await _count(
            db,
            "SELECT COUNT(DISTINCT empresa_codigo) FROM core.empresa_credenciales "
            "WHERE sistema = 'sii'",
        )
        sii_ok = await _count(
            db,
            "SELECT COUNT(*) FROM core.empresa_credenciales "
            "WHERE sistema = 'sii' AND COALESCE(ultima_validacion_ok, FALSE) = TRUE",
        )
        if sii_count == 0:
            severity_d2 = "BLOCKER"
            status_d2 = "FAIL"
            detail = "Sin credenciales SII. Correr seed_empresas_excel_round116.py"
        elif sii_ok == 0:
            severity_d2 = "BLOCKER"
            status_d2 = "WARN"
            detail = (
                f"{sii_count} credenciales SII cargadas pero NINGUNA validada. "
                "Probar login desde /admin/sii antes de marcha blanca."
            )
        elif sii_ok < 3:
            severity_d2 = "IMPORTANT"
            status_d2 = "WARN"
            detail = (
                f"{sii_count} cargadas, solo {sii_ok} validadas OK. "
                "Recomendado validar ≥3 antes de marcha blanca."
            )
        else:
            severity_d2 = "BLOCKER"
            status_d2 = "OK"
            detail = f"{sii_count} cargadas, {sii_ok} validadas OK."
        checks.append(CheckResult(
            id="D2_sii_creds", category="D", severity=severity_d2, status=status_d2,
            title="Credenciales SII por empresa", detail=detail,
            action_url="/admin/sii",
        ))

        # D3: Previred
        prev_count = await _count(
            db,
            "SELECT COUNT(DISTINCT empresa_codigo) FROM core.empresa_credenciales "
            "WHERE sistema = 'previred'",
        )
        checks.append(CheckResult(
            id="D3_previred_creds", category="D",
            severity="IMPORTANT",
            status="OK" if prev_count >= 5 else "WARN",
            title="Credenciales Previred (≥5 empresas)",
            detail=f"{prev_count} empresas con credencial Previred.",
        ))

    # ---- E. Aprobaciones ----
    rules_count = await _count(
        db, "SELECT COUNT(*) FROM core.approval_rules WHERE active = TRUE"
    )
    checks.append(CheckResult(
        id="E1_approval_rules", category="E",
        severity="BLOCKER",
        status="OK" if rules_count >= 10 else "FAIL",
        title="Approval rules activas (≥10)",
        detail=(
            f"{rules_count} rules activas. "
            "Necesarias para que voucher PENDING avance a APPROVED."
        ),
    ))

    # E2: User-company-roles asignados
    roles_count = await _count(
        db,
        "SELECT COUNT(*) FROM core.user_company_roles WHERE active = TRUE",
    )
    checks.append(CheckResult(
        id="E2_user_roles", category="E",
        severity="BLOCKER",
        status="OK" if roles_count >= 5 else "FAIL",
        title="User-company-roles asignados",
        detail=f"{roles_count} roles activos. Necesario para flujo de aprobación.",
        action_url="/admin/users",
    ))

    # ---- F. Test E2E ----
    voucher_full_cycle = await _count(
        db,
        """
        SELECT COUNT(*) FROM core.vouchers
        WHERE status IN ('EXECUTED', 'SYNCED', 'RECONCILED', 'CLOSED')
        """,
    )
    checks.append(CheckResult(
        id="F1_voucher_e2e", category="F",
        severity="BLOCKER",
        status="OK" if voucher_full_cycle >= 1 else "WARN",
        title="Al menos 1 voucher completó el cycle E2E",
        detail=(
            f"{voucher_full_cycle} vouchers llegaron a EXECUTED+. "
            "Recomendado hacer al menos 1 voucher de prueba con caja chica."
            if voucher_full_cycle == 0
            else f"{voucher_full_cycle} vouchers completados. OK."
        ),
        action_url="/vouchers/nuevo",
    ))

    # ---- G. People & 2FA ----
    admin_with_2fa = await _count(
        db,
        """
        SELECT COUNT(DISTINCT u.id)
        FROM auth.users u
        JOIN core.user_roles ur ON ur.user_id = u.id
        WHERE ur.role = 'admin'
          AND EXISTS (SELECT 1 FROM core.user_2fa_totp t
                      WHERE t.user_id = u.id AND t.activated_at IS NOT NULL)
        """,
    )
    checks.append(CheckResult(
        id="G1_admin_2fa", category="G",
        severity="BLOCKER",
        status="OK" if admin_with_2fa >= 1 else "FAIL",
        title="Al menos 1 admin con 2FA activo",
        detail=(
            f"{admin_with_2fa} admin(s) con 2FA. "
            "Disciplinas FE/BE exigen 2FA para acciones críticas."
            if admin_with_2fa >= 1
            else "0 admin con 2FA. Activar 2FA en /me/2fa antes de marcha blanca."
        ),
        action_url="/me/2fa",
    ))

    # ---- H. Integraciones ----
    # H1: Dropbox conectado
    dropbox_ok = await _count(
        db,
        "SELECT COUNT(*) FROM core.integration_tokens "
        "WHERE provider = 'dropbox' AND active = TRUE",
    )
    checks.append(CheckResult(
        id="H1_dropbox", category="H",
        severity="IMPORTANT",
        status="OK" if dropbox_ok > 0 else "WARN",
        title="Dropbox conectado",
        detail=(
            "Dropbox tiene token activo." if dropbox_ok > 0
            else "Sin token Dropbox — adjuntos no funcionan. /admin/integraciones"
        ),
        action_url="/admin/integraciones",
    ))

    # ---- I. Operacional (R126 crons) ----
    if await _table_exists(db, "core", "system_health_checks"):
        recent_health = await _count(
            db,
            "SELECT COUNT(*) FROM core.system_health_checks "
            "WHERE checked_at > NOW() - INTERVAL '15 minutes'",
        )
        if recent_health > 0:
            checks.append(CheckResult(
                id="I1_monitor_cron", category="I",
                severity="IMPORTANT", status="OK",
                title="Monitor cron corriendo (R126)",
                detail=f"{recent_health} health checks en últimos 15 min.",
            ))
        else:
            checks.append(CheckResult(
                id="I1_monitor_cron", category="I",
                severity="IMPORTANT", status="WARN",
                title="Monitor cron corriendo (R126)",
                detail=(
                    "Migración R126 aplicada pero ningún health check reciente. "
                    "Configurar schedule en machine: "
                    "fly machine update <id> --schedule '*/10 * * * *'"
                ),
            ))
    else:
        checks.append(CheckResult(
            id="I1_monitor_cron", category="I",
            severity="IMPORTANT", status="SKIPPED",
            title="Monitor cron corriendo (R126)",
            detail="Migración R126 no aplicada.",
        ))

    # ---- J. Performance ----
    # J1: Pool mode
    try:
        from app.core.database import _is_transaction_pooler
        if _is_transaction_pooler:
            checks.append(CheckResult(
                id="J1_pool_mode", category="J",
                severity="NICE_TO_HAVE", status="OK",
                title="Transaction pooler activo (post-incident R109)",
                detail="DATABASE_URL apunta a port 6543. 3-5x throughput vs session.",
            ))
        else:
            checks.append(CheckResult(
                id="J1_pool_mode", category="J",
                severity="IMPORTANT", status="WARN",
                title="Migración a transaction pooler",
                detail=(
                    "Pool en session mode (limitado a 15 conn Supabase Free). "
                    "Ver docs/PERFORMANCE_OPTIMIZATION.md §1."
                ),
            ))
    except Exception:
        pass

    # ---- K. Avanzado ----
    if await _table_exists(db, "core", "nubox_api_credenciales"):
        nubox_api_count = await _count(
            db, "SELECT COUNT(*) FROM core.nubox_api_credenciales"
        )
        checks.append(CheckResult(
            id="K1_nubox_api", category="K",
            severity="NICE_TO_HAVE",
            status="OK" if nubox_api_count > 0 else "SKIPPED",
            title="Credenciales Nubox API REST (Round 124)",
            detail=(
                f"{nubox_api_count} empresas con Nubox API."
                if nubox_api_count > 0
                else "Sin credenciales. Solicitar a soporte@nubox.com."
            ),
        ))

    return checks


# =====================================================================
# Endpoint principal
# =====================================================================


@router.get("/checklist", response_model=MarchaBlancaReport)
async def marcha_blanca_checklist(
    user: CurrentUser, db: DBSession,
) -> MarchaBlancaReport:
    """Estado en vivo de pre-marcha-blanca."""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo admins ven el checklist de marcha blanca",
        )

    checks = await _build_checks(db, user)

    # Agregar por categoría
    by_cat: dict[str, dict[str, int]] = {}
    for c in checks:
        cat = by_cat.setdefault(
            c.category,
            {"total": 0, "OK": 0, "WARN": 0, "FAIL": 0, "SKIPPED": 0},
        )
        cat["total"] += 1
        cat[c.status] += 1

    categories: list[CategorySummary] = []
    for code, name in CATEGORIES.items():
        stats = by_cat.get(code, {"total": 0, "OK": 0, "WARN": 0, "FAIL": 0, "SKIPPED": 0})
        if stats["total"] == 0:
            continue
        # progress = (OK + WARN/2) / total
        progress = (stats["OK"] + stats["WARN"] * 0.5) / stats["total"]
        categories.append(CategorySummary(
            code=code, name=name,
            total=stats["total"],
            ok=stats["OK"], warn=stats["WARN"],
            fail=stats["FAIL"], skipped=stats["SKIPPED"],
            progress_pct=round(progress * 100, 1),
        ))

    blockers = [c for c in checks if c.severity == "BLOCKER"]
    importants = [c for c in checks if c.severity == "IMPORTANT"]
    nices = [c for c in checks if c.severity == "NICE_TO_HAVE"]

    blockers_ok = sum(1 for c in blockers if c.status == "OK")
    blockers_fail = sum(1 for c in blockers if c.status == "FAIL")
    importants_ok = sum(1 for c in importants if c.status == "OK")
    importants_fail = sum(1 for c in importants if c.status == "FAIL")
    nices_ok = sum(1 for c in nices if c.status == "OK")

    # Estado global
    if blockers_fail > 0:
        overall = "NOT_READY"
        next_action = (
            f"Resolver {blockers_fail} bloqueante(s). El primero: "
            + (
                next(c.title for c in blockers if c.status == "FAIL")
            )
        )
    elif sum(1 for c in blockers if c.status == "WARN") > 0:
        overall = "ALMOST_READY"
        next_action = (
            "Sin bloqueantes FAIL, pero hay WARN. Validar antes de operar."
        )
    elif importants_fail > 0:
        overall = "NEEDS_ATTENTION"
        next_action = (
            f"Listo para marcha blanca, pero {importants_fail} item(s) "
            "importante(s) requieren atención en semana 1."
        )
    else:
        overall = "READY"
        next_action = (
            "Todos los bloqueantes OK. Listo para marcha blanca. "
            "Hacer 1 voucher real con caja chica para validar end-to-end."
        )

    return MarchaBlancaReport(
        generated_at=datetime.now(timezone.utc),
        overall_status=overall,
        blockers_total=len(blockers),
        blockers_ok=blockers_ok,
        blockers_fail=blockers_fail,
        important_total=len(importants),
        important_ok=importants_ok,
        important_fail=importants_fail,
        nice_total=len(nices),
        nice_ok=nices_ok,
        categories=categories,
        checks=checks,
        next_action=next_action,
    )
