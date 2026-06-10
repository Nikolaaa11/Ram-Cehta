/**
 * R152BBBBBB — Helper unificado para manejo de sesión expirada.
 *
 * Antes el mensaje "Sesión expirada" se repetía en 9 archivos distintos, y
 * NINGUNO desloggeaba al user — solo mostraba el toast y el user quedaba
 * en pantalla sin sesión, viendo cada acción fallar con el mismo toast
 * hasta que cerraba el browser. Bug latente real.
 *
 * Uso típico:
 *   import { handleSessionExpired } from "@/lib/api/session-handling";
 *   import { ApiError } from "@/lib/api/client";
 *
 *   try {
 *     await apiClient.post(...);
 *   } catch (err) {
 *     if (err instanceof ApiError && err.status === 401) {
 *       handleSessionExpired();
 *       return;
 *     }
 *     // otros errores
 *   }
 */
import { toast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

let _alreadyHandling = false;

/**
 * Maneja sesión expirada de forma idempotente:
 *  1. Toast claro al user
 *  2. Sign-out de Supabase para limpiar la sesión local
 *  3. Redirige a /login después de 1.5s (para que vea el toast)
 *
 * Es idempotente — si 5 requests fallan en paralelo con 401, solo el
 * primero ejecuta el flow. Los siguientes son no-op.
 */
export function handleSessionExpired(): void {
  if (_alreadyHandling) return;
  _alreadyHandling = true;

  toast.error(
    "Tu sesión expiró. Te redirijo al login...",
    { duration: 1500 },
  );

  // Sign out best-effort + redirect.
  (async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // ignore — el redirect igual va.
    }
    setTimeout(() => {
      if (typeof window !== "undefined") {
        const returnTo = encodeURIComponent(window.location.pathname);
        window.location.href = `/login?next=${returnTo}`;
      }
    }, 1500);
  })();
}
