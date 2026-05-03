import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPaletteProvider } from "@/components/search/CommandPaletteProvider";
import { MobileLayoutShell } from "@/components/layout/MobileLayoutShell";
import { RealtimeProvider } from "@/components/realtime/RealtimeProvider";
import { TwoFactorBanner } from "@/components/auth/TwoFactorBanner";
import { TourTrigger } from "@/components/onboarding/TourTrigger";
import { QuickActionsFab } from "@/components/layout/QuickActionsFab";
import { GlobalShortcutsHelp } from "@/components/layout/GlobalShortcutsHelp";
import { GlobalNavShortcuts } from "@/components/layout/GlobalNavShortcuts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  // El auth check es server-side; el shell responsive es client (drawer toggle).
  // En desktop (md+) el comportamiento es idéntico al original — sidebar al lado
  // del main. En mobile (<md) el sidebar se oculta detrás de un hamburger.
  // RealtimeProvider monta el hook SSE una sola vez para que TanStack Query
  // se invalide en tiempo real ante eventos del backend (notifs, audit, etl).
  return (
    <RealtimeProvider>
      <MobileLayoutShell
        sidebar={<AppSidebar email={session.user.email ?? ""} />}
      >
        {/* V4 fase 2: banner amarillo si admin sin 2FA. Self-managed
            (renderea null si la condición no aplica). */}
        <TwoFactorBanner />
        {children}
      </MobileLayoutShell>
      <CommandPaletteProvider />
      {/* V4 fase 4: tour de onboarding. Auto-disparo en first login;
          self-managed (renderea null si el user ya completó). */}
      <TourTrigger />
      {/* V4 fase 7.14: FAB con quick actions globales (mobile-friendly) */}
      <QuickActionsFab />
      {/* V4 fase 7.14: Overlay de shortcuts globales (tecla `?`) */}
      <GlobalShortcutsHelp />
      {/* V4 fase 7.14: Atajos de navegación globales (g + d/c/e/r/a/p) */}
      <GlobalNavShortcuts />
    </RealtimeProvider>
  );
}
