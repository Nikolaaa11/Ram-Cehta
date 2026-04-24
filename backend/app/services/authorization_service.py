from __future__ import annotations

from app.core.security import AuthenticatedUser


class AuthorizationService:
    """Calcula `allowed_actions` por recurso (Disciplina 3).

    El frontend NUNCA decide qué botones mostrar basándose en el rol.
    Pregunta al backend y renderiza exactamente lo que viene en allowed_actions.
    """

    def allowed_actions_for_oc(self, user: AuthenticatedUser, estado: str) -> list[str]:
        actions: list[str] = []
        if user.has_scope("oc:read"):
            actions.append("download_pdf")
        if user.has_scope("oc:approve") and estado == "emitida":
            actions.append("approve")
        if user.has_scope("oc:cancel") and estado in {"emitida", "parcial"}:
            actions.append("cancel")
        if user.has_scope("oc:mark_paid") and estado == "emitida":
            actions.append("mark_paid")
        return actions
