"use client";

/**
 * /2fa — página de gestión del 2FA del usuario logueado.
 *
 * - Si no está activo: muestra CTA para ir a /2fa/setup.
 * - Si está activo: muestra estado, contador de backup codes restantes,
 *   y botones para regenerar backup codes o desactivar (con código).
 *
 * Apple polish: feedback inmediato, tipografía limpia, sin saltos.
 */

import { useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  RefreshCw,
  PowerOff,
  Loader2,
  Copy,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import {
  use2FAStatus,
  useDisable,
  useRegenerateBackupCodes,
} from "@/hooks/use-2fa";

export default function TwoFactorPage() {
  const statusQ = use2FAStatus();
  const regenMut = useRegenerateBackupCodes();
  const disableMut = useDisable();

  const [showRegen, setShowRegen] = useState<string[] | null>(null);
  const [allCopied, setAllCopied] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [disableCode, setDisableCode] = useState("");

  if (statusQ.isLoading) {
    return (
      <div className="mx-auto max-w-[720px] space-y-4 py-8">
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }

  const enabled = statusQ.data?.enabled ?? false;
  const enabledAt = statusQ.data?.enabled_at;
  const remaining = statusQ.data?.backup_codes_remaining ?? 0;

  const handleRegen = async () => {
    if (
      !window.confirm(
        "Regenerar los 10 backup codes? Los anteriores quedarán inservibles.",
      )
    ) {
      return;
    }
    try {
      const result = await regenMut.mutateAsync();
      setShowRegen(result.backup_codes);
      toast.success("Backup codes regenerados");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al regenerar");
    }
  };

  const handleCopyAll = async () => {
    if (!showRegen) return;
    await navigator.clipboard.writeText(showRegen.join("\n"));
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
  };

  const handleDisable = async () => {
    if (disableCode.length < 6) {
      toast.error("Ingresá un código válido (6 dígitos o backup XXXX-XXXX)");
      return;
    }
    try {
      await disableMut.mutateAsync({ code: disableCode });
      toast.success("2FA desactivado");
      setShowDisable(false);
      setDisableCode("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Código inválido");
    }
  };

  return (
    <div className="mx-auto max-w-[720px] space-y-6 py-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
          Configuración 2FA
        </h1>
        <p className="text-sm text-ink-500">
          Autenticación en 2 pasos basada en TOTP (Google Authenticator,
          1Password, Authy, Bitwarden).
        </p>
      </div>

      {!enabled ? (
        <Surface>
          <div className="flex flex-col items-center text-center">
            <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-warning/10">
              <ShieldAlert
                className="h-6 w-6 text-warning"
                strokeWidth={1.5}
              />
            </span>
            <p className="text-base font-semibold text-ink-900">
              2FA no activado
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              Activá 2FA para sumar una capa de seguridad extra a tu cuenta.
            </p>
            <Link
              href="/2fa/setup"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cehta-green px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-150 ease-apple hover:bg-cehta-green-700"
            >
              Activar 2FA
            </Link>
          </div>
        </Surface>
      ) : (
        <>
          {/* Status card */}
          <Surface className="border border-positive/30 bg-positive/5 ring-1 ring-positive/20">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-positive/15">
                <ShieldCheck
                  className="h-5 w-5 text-positive"
                  strokeWidth={1.75}
                />
              </span>
              <div className="flex-1">
                <p className="text-base font-semibold text-ink-900">
                  2FA activado
                </p>
                <p className="text-sm text-ink-500">
                  {enabledAt
                    ? `Desde ${new Date(enabledAt).toLocaleDateString("es-CL", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}`
                    : "Configurado"}
                </p>
              </div>
            </div>
          </Surface>

          {/* Backup codes */}
          <Surface>
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-ink-100/60">
                  <KeyRound
                    className="h-5 w-5 text-ink-700"
                    strokeWidth={1.5}
                  />
                </span>
                <div>
                  <p className="text-base font-semibold text-ink-900">
                    Backup codes
                  </p>
                  <p className="text-sm text-ink-500">
                    {remaining} de 10 disponibles
                    {remaining <= 3 && remaining > 0 && (
                      <span className="ml-1 text-warning">
                        — pocos restantes
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRegen}
                disabled={regenMut.isPending}
                className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-60"
              >
                {regenMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                ) : (
                  <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
                )}
                Regenerar
              </button>
            </div>

            {showRegen && (
              <div className="mt-5 rounded-xl border border-warning/30 bg-warning/5 p-4">
                <p className="mb-3 text-sm font-medium text-ink-900">
                  Nuevos backup codes — copialos ahora, no se vuelven a
                  mostrar
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {showRegen.map((c) => (
                    <code
                      key={c}
                      className="rounded-lg bg-white px-3 py-2 text-center font-mono text-sm tracking-wider text-ink-900 ring-1 ring-hairline"
                    >
                      {c}
                    </code>
                  ))}
                </div>
                <div className="mt-3 flex justify-between">
                  <button
                    type="button"
                    onClick={handleCopyAll}
                    className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
                  >
                    {allCopied ? (
                      <Check
                        className="h-3.5 w-3.5 text-positive"
                        strokeWidth={2}
                      />
                    ) : (
                      <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                    {allCopied ? "Copiados" : "Copiar todos"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRegen(null)}
                    className="text-xs text-ink-500 underline hover:text-ink-700"
                  >
                    Ya los guardé
                  </button>
                </div>
              </div>
            )}
          </Surface>

          {/* Disable */}
          <Surface>
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-negative/10">
                  <PowerOff
                    className="h-5 w-5 text-negative"
                    strokeWidth={1.5}
                  />
                </span>
                <div>
                  <p className="text-base font-semibold text-ink-900">
                    Desactivar 2FA
                  </p>
                  <p className="text-sm text-ink-500">
                    Bajás el nivel de seguridad de tu cuenta. Vas a necesitar
                    un código TOTP o backup para confirmar.
                  </p>
                </div>
              </div>
              {!showDisable && (
                <button
                  type="button"
                  onClick={() => setShowDisable(true)}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-negative/30 bg-white px-3 py-2 text-sm font-medium text-negative hover:bg-negative/5"
                >
                  Desactivar
                </button>
              )}
            </div>

            {showDisable && (
              <div className="mt-5 space-y-3 rounded-xl border border-hairline bg-ink-50/30 p-4">
                <label
                  htmlFor="disable-code"
                  className="block text-xs font-medium uppercase tracking-wider text-ink-500"
                >
                  Código TOTP (6 dígitos) o backup (XXXX-XXXX)
                </label>
                <input
                  id="disable-code"
                  type="text"
                  value={disableCode}
                  onChange={(e) =>
                    setDisableCode(e.target.value.toUpperCase())
                  }
                  placeholder="123456"
                  className="w-full rounded-xl border-0 bg-white px-3 py-2 font-mono text-sm tracking-wider text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDisable(false);
                      setDisableCode("");
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleDisable}
                    disabled={disableMut.isPending}
                    className="inline-flex items-center gap-2 rounded-xl bg-negative px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-negative/90 disabled:opacity-60"
                  >
                    {disableMut.isPending && (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        strokeWidth={2}
                      />
                    )}
                    Confirmar desactivación
                  </button>
                </div>
              </div>
            )}
          </Surface>
        </>
      )}
    </div>
  );
}
