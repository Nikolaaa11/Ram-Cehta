"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Lock, Mail, Sparkles } from "lucide-react";
import { Surface } from "@/components/ui/surface";
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
    "h-10 w-full rounded-xl bg-white px-3 pl-10 text-sm text-ink-900 ring-1 ring-hairline shadow-glass placeholder:text-ink-300 transition-shadow focus:outline-none focus:ring-2 focus:ring-cehta-green";

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted p-6">
      <div className="w-full max-w-md">
        <Surface variant="elevated" className="p-8">
          {/* Brand */}
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-cehta-green shadow-glass">
              <Sparkles className="h-6 w-6 text-white" strokeWidth={1.5} />
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
              Cehta Capital
            </h1>
            <p className="mt-1 text-sm text-ink-500">FIP CEHTA ESG</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="text-xs uppercase tracking-wide text-ink-500 font-medium"
              >
                Correo electrónico
              </label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300"
                  strokeWidth={1.5}
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

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="text-xs uppercase tracking-wide text-ink-500 font-medium"
              >
                Contraseña
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300"
                  strokeWidth={1.5}
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
              <div className="flex items-start gap-2 rounded-xl bg-negative/5 px-4 py-3 ring-1 ring-negative/20">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-negative"
                  strokeWidth={1.5}
                />
                <p className="text-sm text-negative">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={cn(
                "inline-flex h-10 w-full items-center justify-center rounded-xl bg-cehta-green px-4 text-sm font-medium text-white transition-colors",
                "hover:bg-cehta-green-700 disabled:opacity-60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
              )}
            >
              {loading ? "Iniciando sesión…" : "Iniciar sesión"}
            </button>

            <div className="pt-1 text-center">
              <a
                href="#"
                className="text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
              >
                ¿Olvidaste tu password?
              </a>
            </div>
          </form>
        </Surface>

        <p className="mt-6 text-center text-xs text-ink-500">
          Acceso privado · Plataforma interna Cehta Capital
        </p>
      </div>
    </main>
  );
}
