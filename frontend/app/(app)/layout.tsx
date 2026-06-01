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
import { HelpButton } from "@/components/help/HelpButton";
import { PendingFeedbackPrompt } from "@/components/feedback/PendingFeedbackPrompt";
import { WhatsNewBanner } from "@/components/layout/WhatsNewBanner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  // R152ppp — usar getUser() en lugar de getSession() para validar el JWT
  // con el server (más seguro). getSession() solo lee la cookie sin verificar
  // y Supabase loggea warning "Using the user object ... is not secure".
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
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
        sidebar={<AppSidebar email={user.email ?? ""} />}
      >
        {/* V4 fase 2: banner amarillo si admin sin 2FA. Self-managed
            (renderea null si la condición no aplica). */}
        <TwoFactorBanner />
        {/* R152aa — banner "Novedades R152" dismissable (localStorage) */}
        <WhatsNewBanner />
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
      {/* Round 152i: botón flotante de ayuda contextual (bottom-left, desktop).
          Lee la ruta y muestra el instructivo del módulo. 100% aditivo. */}
      <HelpButton />
      {/* R152aa — wrapper global del FeedbackPrompt: lee sessionStorage y
          monta el toast del lado destino tras router.push (p.ej. voucher.crear). */}
      <PendingFeedbackPrompt />
    </RealtimeProvider>
  );
}
