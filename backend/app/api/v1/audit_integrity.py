"""V5++ ola BS — Audit integrity endpoint.

Verifica salud estructural del sistema multi-tenant:
  - Users sin rol asignado (huérfanos)
  - Empresas sin reglas de aprobación
  - Vouchers con empresa inactiva
  - Approval rules inconsistentes
  - Gaps en la bitácora

Útil para admin para detectar problemas operativos antes de que alguien
los reporte. Acceso: solo admin (audit:read scope).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.api.deps import DBSession, require_scope
from app.core.security import AuthenticatedUser

router = APIRouter()


@router.get("/integrity")
async def audit_integrity(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
) -> dict:
    """V5++ ola BS: chequeo de integridad del sistema multi-tenant.

    Devuelve un report con:
        - users_total
        - users_sin_rol      (potencial issue)
        - users_admin        (debería ser 1-2)
        - empresas_total
        - empresas_sin_reglas    (no pueden aprobar vouchers)
        - empresas_sin_users     (nadie puede operar)
        - vouchers_orphan        (empresa inactiva)
        - audit_entries_total    (cantidad de eventos registrados)
        - audit_last_24h         (actividad reciente)
        - issues                 (lista de problemas detectados con severidad)
    """
    issues: list[dict] = []

    # 1. Users
    users_total = await db.scalar(
        text("SELECT COUNT(*) FROM auth.users")
    ) or 0
    users_admin = await db.scalar(
        text(
            """
            SELECT COUNT(*) FROM core.user_roles
            WHERE app_role = 'admin'
            """
        )
    ) or 0
    users_sin_rol = await db.scalar(
        text(
            """
            SELECT COUNT(*) FROM auth.users u
            WHERE NOT EXISTS (
                SELECT 1 FROM core.user_company_roles ucr
                WHERE ucr.user_id::TEXT = u.id::TEXT AND ucr.active = TRUE
            )
            AND NOT EXISTS (
                SELECT 1 FROM core.user_roles ur
                WHERE ur.user_id::TEXT = u.id::TEXT
                  AND ur.app_role = 'admin'
            )
            """
        )
    ) or 0
    if users_sin_rol > 0:
        issues.append({
            "severity": "warning",
            "category": "users",
            "count": users_sin_rol,
            "message": (
                f"{users_sin_rol} usuarios sin rol asignado en ninguna empresa. "
                f"No pueden operar — asignar roles en /admin/users."
            ),
        })

    # 2. Empresas
    empresas_total = await db.scalar(
        text("SELECT COUNT(*) FROM core.empresas WHERE activo = TRUE")
    ) or 0
    empresas_sin_reglas = (await db.execute(
        text(
            """
            SELECT e.codigo, e.razon_social
            FROM core.empresas e
            WHERE e.activo = TRUE
              AND NOT EXISTS (
                  SELECT 1 FROM core.approval_rules ar
                  WHERE ar.empresa_codigo = e.codigo AND ar.active = TRUE
              )
            """
        )
    )).mappings().all()
    if empresas_sin_reglas:
        issues.append({
            "severity": "critical",
            "category": "approval_rules",
            "count": len(empresas_sin_reglas),
            "empresas": [dict(r) for r in empresas_sin_reglas],
            "message": (
                f"{len(empresas_sin_reglas)} empresas SIN reglas de aprobación. "
                f"Los vouchers PENDING en esas empresas no se pueden firmar. "
                f"Configurar en /admin/reglas-aprobacion."
            ),
        })

    empresas_sin_users = (await db.execute(
        text(
            """
            SELECT e.codigo, e.razon_social
            FROM core.empresas e
            WHERE e.activo = TRUE
              AND NOT EXISTS (
                  SELECT 1 FROM core.user_company_roles ucr
                  WHERE ucr.empresa_codigo = e.codigo AND ucr.active = TRUE
              )
            """
        )
    )).mappings().all()
    if empresas_sin_users:
        issues.append({
            "severity": "warning",
            "category": "empresa_sin_users",
            "count": len(empresas_sin_users),
            "empresas": [dict(r) for r in empresas_sin_users],
            "message": (
                f"{len(empresas_sin_users)} empresas activas SIN usuarios asignados. "
                f"Nadie puede crear ni operar vouchers ahí."
            ),
        })

    # 3. Vouchers
    vouchers_total = await db.scalar(
        text("SELECT COUNT(*) FROM core.vouchers")
    ) or 0
    vouchers_orphan = await db.scalar(
        text(
            """
            SELECT COUNT(*) FROM core.vouchers v
            LEFT JOIN core.empresas e ON e.codigo = v.empresa_codigo
            WHERE e.activo = FALSE OR e.codigo IS NULL
            """
        )
    ) or 0
    if vouchers_orphan > 0:
        issues.append({
            "severity": "warning",
            "category": "vouchers_orphan",
            "count": vouchers_orphan,
            "message": (
                f"{vouchers_orphan} vouchers ligados a empresas inactivas/inexistentes. "
                f"Revisar y reactivar empresa o anular vouchers."
            ),
        })

    # 4. Audit log activity
    audit_total = await db.scalar(
        text("SELECT COUNT(*) FROM audit.action_log")
    ) or 0
    audit_last_24h = await db.scalar(
        text(
            """
            SELECT COUNT(*) FROM audit.action_log
            WHERE created_at > now() - INTERVAL '24 hours'
            """
        )
    ) or 0
    http_mutations_24h = await db.scalar(
        text(
            """
            SELECT COUNT(*) FROM audit.http_mutations
            WHERE timestamp > now() - INTERVAL '24 hours'
            """
        )
    ) or 0
    if audit_total == 0:
        issues.append({
            "severity": "info",
            "category": "audit_empty",
            "message": "Bitácora vacía — no hay registros aún. Es normal en sistemas nuevos.",
        })

    # 5. Users en multiples empresas (info útil, no problema)
    users_multiempresa = await db.scalar(
        text(
            """
            SELECT COUNT(*) FROM (
                SELECT user_id
                FROM core.user_company_roles
                WHERE active = TRUE
                GROUP BY user_id
                HAVING COUNT(DISTINCT empresa_codigo) > 1
            ) m
            """
        )
    ) or 0

    # 6. Reglas duplicadas (mismo empresa+tipo+rango)
    reglas_dup = (await db.execute(
        text(
            """
            SELECT empresa_codigo, COUNT(*) as n
            FROM core.approval_rules
            WHERE active = TRUE
            GROUP BY empresa_codigo, voucher_tipo, min_amount, max_amount,
                     balance_treatment
            HAVING COUNT(*) > 1
            """
        )
    )).mappings().all()
    if reglas_dup:
        issues.append({
            "severity": "warning",
            "category": "approval_rules_duplicate",
            "count": len(reglas_dup),
            "message": (
                f"Reglas de aprobación duplicadas en {len(reglas_dup)} casos. "
                f"Puede causar comportamiento ambiguo."
            ),
        })

    # 7. Estado general
    has_critical = any(i["severity"] == "critical" for i in issues)
    has_warning = any(i["severity"] == "warning" for i in issues)
    overall_status = (
        "critical" if has_critical
        else "warning" if has_warning
        else "ok"
    )

    return {
        "status": overall_status,
        "summary": {
            "users_total": users_total,
            "users_admin": users_admin,
            "users_sin_rol": users_sin_rol,
            "users_multiempresa": users_multiempresa,
            "empresas_total": empresas_total,
            "empresas_sin_reglas": len(empresas_sin_reglas),
            "empresas_sin_users": len(empresas_sin_users),
            "vouchers_total": vouchers_total,
            "vouchers_orphan": vouchers_orphan,
            "audit_entries_total": audit_total,
            "audit_actions_last_24h": audit_last_24h,
            "http_mutations_last_24h": http_mutations_24h,
        },
        "issues": issues,
    }
