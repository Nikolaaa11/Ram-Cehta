import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /admin/dropbox-connect
 *
 * Bridge para conectar Dropbox sin necesidad de manipular tokens manualmente.
 *
 * Flow:
 *   1. Lee la sesión del usuario logueado (cookie Supabase server-side).
 *   2. Llama al backend `/api/v1/dropbox/connect` con Bearer auth.
 *   3. Redirige al `authorize_url` que devuelve el backend (sitio Dropbox).
 *   4. Después de autorizar, Dropbox vuelve al backend `/dropbox/callback`
 *      que persiste tokens y redirige de vuelta a `/admin?dropbox_connected=1`.
 *
 * Acceso: cualquier usuario logueado. El backend valida que sea admin
 * con `require_scope("integration:write")`.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const apiBase =
    process.env.NEXT_PUBLIC_API_URL ?? "https://cehta-backend.fly.dev/api/v1";

  let connectResponse: Response;
  try {
    connectResponse = await fetch(`${apiBase}/dropbox/connect`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "No se pudo contactar el backend",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  if (!connectResponse.ok) {
    let detail: unknown = await connectResponse.text();
    try {
      detail = JSON.parse(detail as string);
    } catch {
      // keep raw text
    }
    return NextResponse.json(
      {
        error: `Backend devolvió ${connectResponse.status}`,
        detail,
        hint:
          connectResponse.status === 403
            ? "Solo usuarios admin pueden conectar Dropbox. Verificá tu rol con SQL en Supabase."
            : connectResponse.status === 503
              ? "DROPBOX_CLIENT_ID/SECRET no están seteados en Fly. Correr `flyctl secrets set DROPBOX_CLIENT_ID=...`"
              : "Revisar logs del backend con `flyctl logs --app cehta-backend`.",
      },
      { status: connectResponse.status },
    );
  }

  const payload = (await connectResponse.json()) as { authorize_url?: string };
  if (!payload.authorize_url) {
    return NextResponse.json(
      { error: "Respuesta inválida del backend", payload },
      { status: 502 },
    );
  }

  return NextResponse.redirect(payload.authorize_url);
}
