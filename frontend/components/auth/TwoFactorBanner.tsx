"use client";

/**
 * TwoFactorBanner — V4 fase 2.
 *
 * Renderea un banner amarillo SOLO si:
 *   - el usuario logueado tiene `app_role === "admin"`, Y
 *   - todavía no activó 2FA (status.enabled === false).
 *
 * Si cualquier condición falla, retorna null (no rendera nada).
 *
 * Diseño: el banner empuja el contenido hacia abajo en el layout,
 * con tipografía clara y un CTA directo a `/2fa/setup`. Apple polish:
 * borde suave, padding generoso, transición de hover en el CTA.
 *
 * Soft-rollout: el banner es UI hint puro — el enforcement real está en
 * 4 endpoints high-impact del backend (`current_admin_with_2fa`).
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
      className="border-b border-warning/30 bg-warning/10 px-4 py-2.5"
    >
      <div className="mx-auto flex max-w-[1400px] items-center gap-3">
        <ShieldAlert
          className="h-4 w-4 shrink-0 text-warning"
          strokeWidth={1.75}
          aria-hidden
        />
        <p className="flex-1 text-sm text-ink-900">
          <span className="font-medium">Como admin, debes activar 2FA.</span>{" "}
          <span className="text-ink-700">
            Algunas acciones críticas (crear usuarios, webhooks, enviar digest)
            requieren autenticación de dos factores.
          </span>
        </p>
        <Link
          href="/2fa/setup"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors duration-150 ease-apple hover:bg-warning/90"
        >
          Activar ahora
          <ArrowRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}
