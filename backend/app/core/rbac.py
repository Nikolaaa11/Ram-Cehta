"""Tabla canónica de scopes por rol (Disciplina 3).

Esta es la ÚNICA fuente de verdad para autorización en el backend. Cualquier
chequeo de permisos en endpoints, services o el response de `/auth/me` debe
delegar acá. Si se necesita un nuevo scope: agregarlo a la matriz, asignarlo
al rol que corresponda, y usar `require_scope("...")` en el router.

Roles:
    admin   — Cehta Capital interno full-access; única fuente con permiso de
              borrar proveedores, F29s, gestionar usuarios y leer auditoría.
    finance — Operativo (Nicolas y similares); puede crear/aprobar/marcar
              pagada pero NO anular OCs, ni borrar proveedores/F29, ni leer
              auditoría, ni administrar usuarios.
    viewer  — Read-only para auditoría externa o stakeholders. NO ve audit
              trail ni listado de usuarios (privacy).
"""
from __future__ import annotations

# fmt: off
ROLE_SCOPES: dict[str, frozenset[str]] = {
    "admin": frozenset({
        # Órdenes de Compra
        "oc:read", "oc:create", "oc:update", "oc:approve", "oc:cancel", "oc:mark_paid",
        # Proveedores
        "proveedor:read", "proveedor:create", "proveedor:update", "proveedor:delete",
        # F29
        "f29:read", "f29:create", "f29:update", "f29:delete",
        # Movimientos — V4 fase 5: admin puede crear ajustes manuales
        # (ETL-import sigue siendo el canal primario; manual es excepción).
        "movimiento:read", "movimiento:create",
        # Suscripciones de acciones (FIP CEHTA ESG)
        "suscripcion:read", "suscripcion:create", "suscripcion:delete",
        # Auditoría / Data quality
        "audit:read",
        # Administración de usuarios
        "user:read", "user:write", "user:delete",
        # Integraciones (Dropbox, etc.) — V3
        "integration:read", "integration:write",
        # Trabajadores (HR per empresa) — V3 fase 2
        "trabajador:read", "trabajador:create", "trabajador:update", "trabajador:delete",
        # AI Asistente (V3 fase 3) — admin puede además forzar reindex de la KB.
        "ai:read", "ai:chat", "ai:index",
        # CEO Dashboard (V3 fase 3+4) — vista consolidada del portafolio.
        "ceo:read",
        # Legal Vault (V3 fase 3+4) — bóveda de documentos legales por empresa.
        "legal:read", "legal:create", "legal:update", "legal:delete",
        # Notifications (V3 fase 3+4) — admin maneja Resend y emails.
        "notifications:admin",
        # Avance / Gantt (V3 fase 5) — proyectos, hitos, riesgos por empresa.
        "avance:read", "avance:create", "avance:update", "avance:delete",
        # Calendar + agentes scheduled (V3 fase 5).
        "calendar:read", "calendar:create", "calendar:update", "calendar:delete",
        "calendar:admin",
        # Búsqueda de Fondos (V3 fase 5) — pipeline LP/banco/programa.
        "fondo:read", "fondo:create", "fondo:update", "fondo:delete",
        # AI Document Analyzer (V3 fase 7) — auto-fill de forms desde archivos.
        "document:analyze",
        # Empresas (datos fiscales / contacto) — V3 fase 7. Admin only.
        "empresa:update",
        # Suscripciones — admin puede editar (firmado, fecha_firma, contrato_ref).
        "suscripcion:update",
    }),
    "finance": frozenset({
        "oc:read", "oc:create", "oc:update", "oc:approve", "oc:mark_paid",
        "proveedor:read", "proveedor:create", "proveedor:update",
        "f29:read", "f29:create", "f29:update",
        "movimiento:read", "movimiento:create",
        "suscripcion:read", "suscripcion:create",
        # Finance puede crear y editar trabajadores pero no eliminarlos.
        "trabajador:read", "trabajador:create", "trabajador:update",
        # AI Asistente — chat full pero sin re-indexar.
        "ai:read", "ai:chat",
        # Legal Vault — operativo (subir/editar contratos) pero no eliminar.
        "legal:read", "legal:create", "legal:update",
        # Avance — finance crea y edita pero no elimina proyectos/hitos/riesgos.
        "avance:read", "avance:create", "avance:update",
        # Calendar — finance puede crear y editar eventos.
        "calendar:read", "calendar:create", "calendar:update",
        # Fondos — finance puede crear y editar pero no eliminar.
        "fondo:read", "fondo:create", "fondo:update",
        # AI Document Analyzer — finance también auto-fills (uso primario).
        "document:analyze",
        # Suscripciones — finance puede editar (operativo).
        "suscripcion:update",
    }),
    "viewer": frozenset({
        "oc:read",
        "proveedor:read",
        "f29:read",
        "movimiento:read",
        "suscripcion:read",
        "trabajador:read",
        # AI Asistente — viewer también puede chatear (es la feature estrella V3).
        "ai:read", "ai:chat",
        # Legal Vault — viewer puede consultar documentos pero no modificar.
        "legal:read",
        # Avance / Calendar / Fondos — read-only para reportes y comité.
        "avance:read",
        "calendar:read",
        "fondo:read",
        # AI Document Analyzer — viewer también puede analizar (no muta nada).
        "document:analyze",
        # NO audit:read, NO user:* — privacy / least privilege.
    }),
}
# fmt: on


def scopes_for(role: str) -> frozenset[str]:
    """Devuelve el set congelado de scopes para un rol; vacío si rol desconocido."""
    return ROLE_SCOPES.get(role, frozenset())
