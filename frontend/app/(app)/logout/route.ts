import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /logout — cierra la sesión Supabase y redirige a /login.
 *
 * Se invoca desde un <form action="/logout" method="POST"> en el sidebar.
 * Status 303 fuerza un GET al destino tras el POST (semántica HTTP correcta).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
