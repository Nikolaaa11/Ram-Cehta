import { createServerClient } from "@supabase/ssr";

type CookieItem = { name: string; value: string; options?: Record<string, unknown> };
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet: CookieItem[]) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              cookieStore.set(name, value, options as any)
            );
          } catch {
            // Server Components no pueden setear cookies; el middleware ya refrescó la sesión.
          }
        },
      },
    }
  );
}

// Alias for backwards compatibility
export const createSupabaseServerClient = createClient;

