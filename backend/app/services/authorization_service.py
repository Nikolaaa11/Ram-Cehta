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
        # `en_firma` y `parcial` entran el 2026-09-21. Antes quedaban fuera y
        # una OC ya pagada al proveedor no se podía registrar como pagada:
        #  · en_firma — pasa cuando un firmante nunca firmó en la plataforma
        #    (TECMAVIDA: tres OC trabadas así). El endpoint exige un MOTIVO
        #    si quedan firmas pendientes y lo deja en la auditoría; las
        #    firmas no se tocan (se registra que faltaron, no se inventan).
        #  · parcial — una OC con pago parcial NUNCA podía cerrarse: marcar
        #    parcial era un callejón sin salida.
        if user.has_scope("oc:mark_paid") and estado in {
            "emitida", "en_firma", "firmada", "enviada_proveedor",
            "facturada", "parcial",
        }:
            actions.append("mark_paid")
        # Enviar a firma / gestionar firmantes (flujo F3).
        if user.has_scope("oc:update") and estado in {
            "emitida", "borrador", "en_firma",
        }:
            actions.append("send_to_firma")
        return actions
