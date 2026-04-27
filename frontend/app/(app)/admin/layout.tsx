/**
 * Admin gate (server component).
 *
 * Disciplina 3 — excepción documentada:
 *   Comprobamos `me.app_role === "admin"` directamente para decidir si
 *   renderizamos el árbol /admin/* o redirigimos a /dashboard. Esto es
 *   legítimo aquí porque:
 *     1) Es UI rendering (UX), no autorización de negocio.
 *     2) El backend valida cada endpoint con `require_scope` aparte.
 *     3) Esconder UI a no-admins evita exponer formularios sensibles.
 *
 *   Para acciones específicas dentro del panel (ej. eliminar un usuario), la
 *   gating fina se hace con `me.allowed_actions.includes("user:delete")` en el
 *   componente correspondiente.
 */
import { redirect } from "next/navigation";
import { serverApiGet } from "@/lib/api/server";
import type { UserMe } from "@/lib/api/schema";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let me: UserMe | null = null;
  try {
    me = await serverApiGet<UserMe>("/auth/me");
  } catch {
    redirect("/dashboard");
  }

  if (me?.app_role !== "admin") {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
