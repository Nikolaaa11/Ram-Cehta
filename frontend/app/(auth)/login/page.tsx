"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertCircle, Lock, Mail, Sparkles, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (authError) {
      setError("Credenciales incorrectas. Verifica tu email y contraseña.");
      return;
    }

    router.push("/dashboard");
  }

  const inputBase =
    "h-11 w-full rounded-xl bg-white/80 backdrop-blur px-3 pl-10 text-sm text-ink-900 ring-1 ring-hairline shadow-glass placeholder:text-ink-300 transition-all duration-200 ease-apple focus:outline-none focus:ring-2 focus:ring-cehta-green focus:bg-white focus:shadow-glow-green";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* Animated gradient mesh background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 gradient-mesh-animated"
      />

      {/* Floating decorative orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[10%] left-[15%] h-72 w-72 rounded-full bg-cehta-green/15 blur-3xl float-slow"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[20%] right-[10%] h-64 w-64 rounded-full bg-amber-300/10 blur-3xl float-slow"
        style={{ animationDelay: "1.5s" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[15%] left-[35%] h-80 w-80 rounded-full bg-sf-blue/10 blur-3xl float-slow"
        style={{ animationDelay: "3s" }}
      />

      {/* Floating sparkles */}
      <Sparkles
        aria-hidden
        className="absolute left-[20%] top-[25%] h-3 w-3 text-cehta-green/60 sparkle"
      />
      <Sparkles
        aria-hidden
        className="absolute right-[25%] top-[60%] h-4 w-4 text-amber-400/70 sparkle"
        style={{ animationDelay: "0.6s" }}
      />
      <Sparkles
        aria-hidden
        className="absolute left-[60%] bottom-[20%] h-3 w-3 text-sf-blue/50 sparkle"
        style={{ animationDelay: "1.2s" }}
      />

      <div className="w-full max-w-md slide-up-fade">
        {/* Glass card */}
        <div className="relative overflow-hidden rounded-3xl bg-white/70 backdrop-blur-2xl ring-1 ring-hairline shadow-elevated-lg p-8">
          {/* Top gradient accent */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cehta-green/40 to-transparent"
          />

          {/* Brand */}
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="relative mb-5">
              {/* Pulse ring behind logo */}
              <span
                aria-hidden
                className="absolute inset-0 rounded-2xl bg-cehta-green/20 animate-pulse-ring"
              />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cehta-green via-emerald-600 to-cehta-green-700 shadow-glow-green ring-1 ring-white/30">
                <Image
                  src="/logos/cehta.png"
                  alt="Cehta"
                  width={48}
                  height={48}
                  className="h-12 w-12 object-contain"
                  unoptimized
                  priority
                />
              </div>
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              <span className="text-gradient">Cehta Capital</span>
            </h1>
            <p className="mt-1 text-sm font-medium text-ink-500">
              FIP CEHTA ESG · Plataforma interna
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5 slide-up-fade stagger-1">
              <label
                htmlFor="email"
                className="text-xs uppercase tracking-wider text-ink-500 font-semibold"
              >
                Correo electrónico
              </label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
                  strokeWidth={1.75}
                />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="tu@cehta.cl"
                  className={inputBase}
                />
              </div>
            </div>

            <div className="space-y-1.5 slide-up-fade stagger-2">
              <label
                htmlFor="password"
                className="text-xs uppercase tracking-wider text-ink-500 font-semibold"
              >
                Contraseña
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
                  strokeWidth={1.75}
                />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={inputBase}
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl bg-negative/5 px-4 py-3 ring-1 ring-negative/20 slide-up-fade">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-negative"
                  strokeWidth={2}
                />
                <p className="text-sm text-negative font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={cn(
                "slide-up-fade stagger-3 group relative inline-flex h-11 w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-cehta-green via-emerald-600 to-cehta-green-700 px-4 text-sm font-semibold text-white shadow-glow-green transition-all duration-200 ease-apple",
                "hover:shadow-elevated-lg hover:-translate-y-0.5 active:scale-[0.98]",
                "disabled:opacity-60 disabled:hover:translate-y-0",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Iniciando sesión…
                </>
              ) : (
                <>
                  Iniciar sesión
                  <span className="transition-transform duration-200 group-hover:translate-x-1">
                    →
                  </span>
                </>
              )}
              {/* Shimmer sweep on hover */}
              {!loading && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                />
              )}
            </button>

            <div className="pt-2 text-center slide-up-fade stagger-4">
              <a
                href="mailto:contactocehta@gmail.com?subject=Reset%20password%20Cehta"
                className="text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
              >
                ¿Olvidaste tu password?
              </a>
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-ink-500">
          Acceso privado · Plataforma interna Cehta Capital
        </p>
        <p className="mt-1 text-center text-[10px] text-ink-400">
          🔒 Conexión segura SSL · TLS 1.3
        </p>
      </div>
    </main>
  );
}
