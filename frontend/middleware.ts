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
  // R152TTTTTT — agregados json/js/xlsx/ico/webmanifest/woff: el navegador
  // pide /manifest.json SIN cookies (fetch no-credentials del spec de PWA),
  // así que el redirect 307→/login rompía la instalación como app y el
  // atajo "Foto voucher" incluso con sesión iniciada. Ídem /sw.js (service
  // worker) y los templates .xlsx de /public.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html|txt|pdf|json|js|xlsx|ico|webmanifest|woff2?|map)$).*)",
  ],
};
