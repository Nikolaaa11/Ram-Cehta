/**
 * Server-only API helpers — solo importar desde Server Components.
 * Nunca importar desde "use client" components.
 */
import { createClient } from "@/lib/supabase/server";
import { apiClient } from "@/lib/api/client";

export async function serverApiGet<T>(path: string): Promise<T> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return apiClient.get<T>(path, session);
}
