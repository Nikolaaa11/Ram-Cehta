"use client";

/**
 * WelcomeBanner — V5++ ola CA (premium redesign)
 *
 * Banner introductorio que aparece en el dashboard cuando el user:
 *   1. No tiene empresas asignadas (no puede crear vouchers) — banner ROJO con pulse
 *   2. Tiene empresas pero 0 vouchers — banner VERDE con CTA "Crear primero"
 *   3. Tiene vouchers pendientes (drafts o aprobaciones) — banner AMBER con gradient mesh
 *
 * Diseño: gradient mesh background, slide-up-fade entrance, sparkle decoration,
 * hover scale en CTAs, pulse-glow dots para estados críticos.
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Inbox,
  Sparkles,
  X,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useSidebarState } from "@/hooks/use-sidebar-state";
import { cn } from "@/lib/utils";

interface MyEmpresa {
  codigo: string;
  razon_social: string;
  roles: string[];
}

const DISMISS_KEY = "welcome-banner-dismissed-v1";

export function WelcomeBanner() {
  const { session } = useSession();
  const { data: state } = useSidebarState();
  const [empresas, setEmpresas] = useState<MyEmpresa[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    apiClient
      .get<{ empresas: MyEmpresa[] }>("/me/empresas", session)
      .then((resp) => setEmpresas(resp.empresas || []))
      .catch(() => setEmpresas([]))
      .finally(() => setLoaded(true));
  }, [session]);

  const handleDismiss = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(DISMISS_KEY, "1");
    }
    setDismissed(true);
  };

  if (!loaded || dismissed) return null;

  const draftsCount = state?.voucher_drafts_mine ?? 0;
  const pendingCount = state?.voucher_pending_approvals ?? 0;
  const totalPending = draftsCount + pendingCount;

  // Caso 1: Sin empresas → user nuevo sin permisos. Banner crítico con pulse glow.
  if (empresas.length === 0) {
    return (
      <div className="slide-up-fade relative mb-6 overflow-hidden rounded-2xl border border-red-200/60 bg-gradient-to-br from-red-50 via-red-50/80 to-orange-50/60 p-5 shadow-glow-red dark:border-red-900/50 dark:from-red-950/30 dark:via-red-950/20 dark:to-orange-950/20">
        {/* Decoración: blob radial sutil arriba-derecha */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-red-400/20 blur-3xl"
        />
        <div className="relative flex items-start gap-3">
          <div className="relative flex-shrink-0">
            <span className="absolute inset-0 -m-1 rounded-full bg-red-400/30 animate-pulse-ring" />
            <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-100 ring-2 ring-red-200 dark:bg-red-900/40 dark:ring-red-800">
              <AlertCircle className="size-5 text-red-600 dark:text-red-400" strokeWidth={2} />
            </span>
          </div>
          <div className="flex-1 pt-0.5">
            <h3 className="text-base font-semibold text-red-900 dark:text-red-300">
              No tenés empresas asignadas
            </h3>
            <p className="mt-1 text-sm text-red-700 dark:text-red-400">
              No podés crear vouchers ni ver datos. Pedile al admin que te asigne
              roles en al menos una empresa desde{" "}
              <code className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-mono dark:bg-red-900/40">
                /admin/users
              </code>
              .
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Caso 2: Tiene pendientes → priorizar acción. Amber gradient mesh.
  if (totalPending > 0) {
    return (
      <div className="slide-up-fade relative mb-6 overflow-hidden rounded-2xl border border-amber-200/60 bg-gradient-to-br from-amber-50 via-amber-50/80 to-yellow-50/60 p-5 shadow-glow-gold dark:border-amber-900/50 dark:from-amber-950/30 dark:via-amber-950/20 dark:to-yellow-950/20">
        {/* Decoración: blob radial */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-amber-300/25 blur-3xl"
        />
        <div className="relative flex items-start gap-3">
          <div className="relative flex-shrink-0">
            <span className="absolute inset-0 -m-1 rounded-full bg-amber-400/30 pulse-glow-amber" />
            <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 ring-2 ring-amber-200 dark:bg-amber-900/40 dark:ring-amber-800">
              <Inbox className="size-5 text-amber-600 dark:text-amber-400" strokeWidth={2} />
            </span>
          </div>
          <div className="flex-1 pt-0.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-amber-900 dark:text-amber-300">
                Tenés{" "}
                <span className="font-display tabular-nums">{totalPending}</span>{" "}
                {totalPending === 1 ? "voucher" : "vouchers"} que requieren tu acción
              </h3>
              <button
                type="button"
                onClick={handleDismiss}
                className="rounded-md p-1 text-amber-700 transition-colors hover:bg-amber-100/60 hover:text-amber-900 dark:text-amber-400 dark:hover:bg-amber-900/30 dark:hover:text-amber-200"
                aria-label="Descartar"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
              {draftsCount > 0 && (
                <span>
                  {draftsCount} {draftsCount === 1 ? "borrador propio" : "borradores propios"} sin completar
                </span>
              )}
              {draftsCount > 0 && pendingCount > 0 && <span> · </span>}
              {pendingCount > 0 && <span>{pendingCount} esperando tu firma</span>}
            </p>
            <Link
              href={"/mis-pendientes" as Route}
              className={cn(
                "mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-600/90 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all duration-200",
                "hover:bg-amber-600 hover:shadow-glow-gold hover:-translate-y-0.5",
                "dark:bg-amber-500 dark:hover:bg-amber-400",
              )}
            >
              Ver mi bandeja <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Caso 3: Todo al día → banner verde premium con sparkle.
  return (
    <div className="slide-up-fade relative mb-6 overflow-hidden rounded-2xl border border-cehta-green/25 bg-gradient-to-br from-cehta-green/5 via-emerald-50/40 to-teal-50/30 p-5 shadow-card dark:from-cehta-green/15 dark:via-cehta-green/8 dark:to-teal-950/20">
      {/* Decoración: blob radial sutil */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-cehta-green/15 blur-3xl"
      />
      {/* Sparkle floating */}
      <Sparkles
        aria-hidden
        className="absolute right-4 top-4 h-4 w-4 text-amber-400 sparkle"
      />
      <div className="relative flex items-start gap-3">
        <div className="relative flex-shrink-0">
          <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-cehta-green/10 ring-2 ring-cehta-green/30">
            <CheckCircle2 className="size-5 text-cehta-green" strokeWidth={2} />
          </span>
        </div>
        <div className="flex-1 pt-0.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-cehta-green">
              ¡Todo al día!
            </h3>
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-md p-1 text-ink-500 transition-colors hover:bg-ink-100/60 hover:text-ink-900 dark:hover:bg-ink-800"
              aria-label="Descartar"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="mt-1 text-sm text-ink-700 dark:text-ink-300">
            No tenés pendientes. Tus empresas:{" "}
            <span className="font-medium">
              {empresas.slice(0, 6).map((e) => e.codigo).join(" · ")}
              {empresas.length > 6 && ` +${empresas.length - 6}`}
            </span>
            .
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Link
              href={"/vouchers/nuevo" as Route}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all duration-200",
                "hover:bg-cehta-green-600 hover:shadow-glow-green hover:-translate-y-0.5",
              )}
            >
              <Building2 className="size-3.5" />
              Nuevo voucher
            </Link>
            <Link
              href={"/mis-pendientes" as Route}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-3 py-1.5 text-sm font-medium text-cehta-green ring-1 ring-cehta-green/20 transition-all duration-200",
                "hover:bg-white hover:ring-cehta-green/40 hover:-translate-y-0.5",
                "dark:bg-ink-900/60 dark:ring-cehta-green/30 dark:hover:bg-ink-900",
              )}
            >
              <Inbox className="size-3.5" />
              Mis pendientes
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
