import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // R152SSSSSS — agregado `html` (y txt/pdf) a las exclusiones: las guías
  // estáticas en /public (GUIA_USUARIO.html, etc.) son públicas y no deben
  // pasar por el redirect a /login. El App Router no usa URLs .html para
  // páginas, así que esto solo afecta a archivos estáticos de /public.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html|txt|pdf)$).*)",
  ],
};
