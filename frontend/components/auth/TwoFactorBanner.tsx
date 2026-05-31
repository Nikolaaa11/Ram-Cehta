"use client";

/**
 * TwoFactorBanner — V4 fase 2 (V5++ ola CA premium upgrade).
 *
 * Banner amber con gradient mesh + pulse-glow icon + magnetic CTA.
 *
 * Renderea solo si:
 *   - el usuario logueado tiene `app_role === "admin"`, Y
 *   - todavía no activó 2FA (status.enabled === false).
 */

import Link from "next/link";
import { ShieldAlert, ArrowRight } from "lucide-react";
import { useMe } from "@/hooks/use-me";
import { use2FAStatus } from "@/hooks/use-2fa";

export function TwoFactorBanner() {
  const { data: me } = useMe();
  const { data: status, isLoading } = use2FAStatus();

  // Render nothing si: aún cargando, no es admin, ya activó 2FA.
  if (isLoading) return null;
  if (me?.app_role !== "admin") return null;
  if (status?.enabled) return null;

  return (
    <div
      role="alert"
      className="relative overflow-hidden border-b border-warning/30 bg-gradient-to-r from-warning/5 via-warning/10 to-amber-100/30 px-4 py-3"
    >
      {/* Decorative blob */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-12 h-32 w-32 rounded-full bg-warning/15 blur-3xl"
      />
      <div className="relative mx-auto flex max-w-[1400px] items-center gap-3">
        <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/15 ring-2 ring-warning/30">
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-warning/30 animate-pulse-ring"
          />
          <ShieldAlert
            className="relative h-4 w-4 text-warning"
            strokeWidth={2}
            aria-hidden
          />
        </span>
        <p className="flex-1 text-sm text-ink-900">
          <span className="font-semibold">Como admin, debés activar 2FA.</span>{" "}
          <span className="text-ink-700">
            Algunas acciones críticas (crear usuarios, webhooks, enviar digest)
            requieren autenticación de dos factores.
          </span>
        </p>
        <Link
          href="/2fa/setup"
          className="group inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-br from-warning to-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-glow-gold transition-all duration-200 ease-apple hover:-translate-y-0.5 hover:shadow-elevated-lg active:scale-[0.97]"
        >
          Activar ahora
          <ArrowRight
            className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-1"
            strokeWidth={2}
          />
        </Link>
      </div>
    </div>
  );
}
