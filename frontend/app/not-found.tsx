/**
 * Custom 404 page — premium con gradient mesh + sparkles + CTAs.
 *
 * Aparece cuando Next.js no encuentra una ruta. Server component.
 */
import Link from "next/link";
import { Compass, Sparkles, ArrowRight, Home } from "lucide-react";

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* Animated gradient mesh */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 gradient-mesh-animated"
      />

      {/* Floating orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[15%] left-[10%] h-72 w-72 rounded-full bg-cehta-green/15 blur-3xl float-slow"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[20%] right-[15%] h-80 w-80 rounded-full bg-amber-300/12 blur-3xl float-slow"
        style={{ animationDelay: "2s" }}
      />

      {/* Sparkles */}
      <Sparkles
        aria-hidden
        className="absolute left-[25%] top-[30%] h-4 w-4 text-amber-400/60 sparkle"
      />
      <Sparkles
        aria-hidden
        className="absolute right-[30%] top-[55%] h-3 w-3 text-cehta-green/50 sparkle"
        style={{ animationDelay: "0.8s" }}
      />
      <Sparkles
        aria-hidden
        className="absolute left-[55%] bottom-[30%] h-4 w-4 text-sf-blue/50 sparkle"
        style={{ animationDelay: "1.6s" }}
      />

      <div className="relative w-full max-w-lg text-center slide-up-fade">
        {/* Big 404 with gradient */}
        <p className="font-display text-[8rem] font-bold leading-none tracking-tighter">
          <span className="text-gradient">404</span>
        </p>

        {/* Compass icon */}
        <div className="relative -mt-4 mb-6 inline-flex items-center justify-center">
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-cehta-green/20 blur-xl"
          />
          <div className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cehta-green via-emerald-600 to-cehta-green-700 shadow-glow-green ring-1 ring-white/30">
            <Compass className="h-7 w-7 text-white animate-spin-slow" strokeWidth={1.5} />
          </div>
        </div>

        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
          Página no encontrada
        </h1>
        <p className="mt-2 max-w-md mx-auto text-sm text-ink-500 dark:text-ink-400">
          La ruta que buscás no existe o fue movida. Te llevamos de vuelta al dashboard.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-cehta-green via-emerald-600 to-cehta-green-700 px-5 py-2.5 text-sm font-medium text-white shadow-glow-green transition-all duration-200 ease-apple hover:-translate-y-0.5 hover:shadow-elevated-lg active:scale-[0.97]"
          >
            <Home className="h-4 w-4" strokeWidth={2} />
            Ir al dashboard
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" strokeWidth={2} />
          </Link>
          <Link
            href="/asistente"
            className="inline-flex items-center gap-2 rounded-xl bg-white/80 backdrop-blur px-5 py-2.5 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-all duration-200 ease-apple hover:bg-white hover:ring-cehta-green/30 hover:text-cehta-green hover:-translate-y-0.5 dark:bg-ink-900/60 dark:text-ink-300 dark:ring-ink-700"
          >
            Preguntarle a Claude
          </Link>
        </div>
      </div>
    </main>
  );
}
