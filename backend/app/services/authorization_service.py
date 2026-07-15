from __future__ import annotations

from app.core.security import AuthenticatedUser


class AuthorizationService:
    """Calcula `allowed_actions` por recurso (Disciplina 3).

    El frontend NUNCA decide qué botones mostrar basándose en el rol.
    Pregunta al backend y renderiza exactamente lo que viene en allowed_actions.
    """

    def allowed_actions_for_oc(self, user: AuthenticatedUser, estado: str) -> list[str]:
        # MEGAPROMPT F3 — estados nuevos del flujo de firmas:
        # borrador → en_firma → firmada → enviada_proveedor → facturada.
        actions: list[str] = []
        if user.has_scope("oc:read"):
            actions.append("download_pdf")
        if user.has_scope("oc:approve") and estado == "emitida":
            actions.append("approve")
        if user.has_scope("oc:cancel") and estado in {
            "emitida", "parcial", "borrador", "en_firma",
        }:
            actions.append("cancel")
        if user.has_scope("oc:mark_paid") and estado in {
            "emitida", "firmada", "enviada_proveedor", "facturada",
        }:
            actions.append("mark_paid")
        # Enviar a firma / gestionar firmantes (flujo F3).
        if user.has_scope("oc:update") and estado in {
            "emitida", "borrador", "en_firma",
        }:
            actions.append("send_to_firma")
        return actions
