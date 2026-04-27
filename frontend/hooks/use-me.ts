"use client";

/**
 * useMe — fuente única de verdad sobre el usuario y sus permisos en el cliente
 * (Disciplina 3).
 *
 * Reemplaza cualquier lectura directa de `session.user.user_metadata.app_role`
 * (que es editable en el cliente y no se valida server-side). El backend
 * computa `allowed_actions` desde `app.core.rbac.ROLE_SCOPES` y las expone
 * vía `GET /auth/me`.
 */
import { useApiQuery } from "./use-api-query";
import type { UserMe } from "@/lib/api/schema";

export const useMe = () => useApiQuery<UserMe>(["me"], "/auth/me");
