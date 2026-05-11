"use client";

/**
 * WelcomeBanner — V5++ ola BD
 *
 * Banner introductorio que aparece en el dashboard cuando el user:
 *   1. No tiene empresas asignadas (no puede crear vouchers) — banner ROJO
 *   2. Tiene empresas pero 0 vouchers — banner VERDE con CTA "Crear primero"
 *   3. Tiene vouchers pendientes (drafts o aprobaciones) — banner AMBER
 *
 * Se oculta si:
 *   - Usuario tiene actividad reciente (vouchers > 0)
 *   - User ya descartó (localStorage flag)
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
  X,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useSidebarState } from "@/hooks/use-sidebar-state";

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

  // Caso 1: Sin empresas → user nuevo sin permisos
  if (empresas.length === 0) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 p-5 mb-6 flex items-start gap-3">
        <AlertCircle className="size-6 text-red-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-base font-semibold text-red-900 dark:text-red-300">
            No tenés empresas asignadas
          </h3>
          <p className="text-sm text-red-700 dark:text-red-400 mt-1">
            No podés crear vouchers ni ver datos. Pedile al admin que te asigne
            roles en al menos una empresa desde{" "}
            <code className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/40 rounded text-xs">
              /admin/users
            </code>
            .
          </p>
        </div>
      </div>
    );
  }

  // Caso 2: Tiene pendientes → priorizar acción
  if (totalPending > 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-5 mb-6 flex items-start gap-3">
        <Inbox className="size-6 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-amber-900 dark:text-amber-300">
              Tenés {totalPending} {totalPending === 1 ? "voucher" : "vouchers"} que requieren tu acción
            </h3>
            <button
              type="button"
              onClick={handleDismiss}
              className="text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
              aria-label="Descartar"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
            {draftsCount > 0 && (
              <span>{draftsCount} {draftsCount === 1 ? "borrador propio" : "borradores propios"} sin completar</span>
            )}
            {draftsCount > 0 && pendingCount > 0 && <span> · </span>}
            {pendingCount > 0 && (
              <span>{pendingCount} esperando tu firma</span>
            )}
          </p>
          <Link
            href={"/mis-pendientes" as Route}
            className="inline-flex items-center gap-1 mt-3 text-sm font-medium text-amber-700 dark:text-amber-300 hover:underline"
          >
            Ver mi bandeja <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  // Caso 3: Todo al día → banner verde con info
  return (
    <div className="rounded-2xl border border-cehta-green/30 bg-cehta-green/5 p-5 mb-6 flex items-start gap-3">
      <CheckCircle2 className="size-6 text-cehta-green flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-cehta-green">
            ¡Todo al día!
          </h3>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-ink-500 hover:text-ink-900"
            aria-label="Descartar"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="text-sm text-ink-700 dark:text-ink-300 mt-1">
          No tenés pendientes. Tus empresas:{" "}
          <span className="font-medium">
            {empresas.map((e) => e.codigo).join(" · ")}
          </span>
          .
        </p>
        <div className="flex items-center gap-3 mt-3">
          <Link
            href={"/vouchers/nuevo" as Route}
            className="inline-flex items-center gap-1 text-sm font-medium text-cehta-green hover:underline"
          >
            <Building2 className="size-3.5" />
            Nuevo voucher
          </Link>
          <Link
            href={"/mis-pendientes" as Route}
            className="inline-flex items-center gap-1 text-sm font-medium text-cehta-green hover:underline"
          >
            <Inbox className="size-3.5" />
            Mis pendientes
          </Link>
        </div>
      </div>
    </div>
  );
}
