"use client";

/**
 * Wizard de configuración de 2FA — V4 fase 2.
 *
 * 3 pasos:
 *   1. Explicación + botón "Empezar" → llama enroll → guarda secret/qr/codes en estado.
 *   2. QR + secret manual + botón "Ya escaneé".
 *   3. Input de 6 dígitos → verify → muestra backup codes una sola vez.
 *
 * Apple polish: transiciones suaves, foco automático, contadores
 * de progreso, sin saltos de layout.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  Smartphone,
  KeyRound,
  CheckCircle2,
  Copy,
  Check,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import { useEnroll, useVerify } from "@/hooks/use-2fa";
import type { TwoFactorEnrollResponse } from "@/lib/api/schema";

type Step = 1 | 2 | 3 | 4;

export default function TwoFactorSetupPage() {
  const router = useRouter();
  const enrollMut = useEnroll();
  const verifyMut = useVerify();

  const [step, setStep] = useState<Step>(1);
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollResponse | null>(
    null,
  );
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [secretCopied, setSecretCopied] = useState(false);
  const [allCodesCopied, setAllCodesCopied] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-focus al entrar al step 3.
  useEffect(() => {
    if (step === 3) {
      inputsRef.current[0]?.focus();
    }
  }, [step]);

  const handleEmpezar = async () => {
    try {
      const result = await enrollMut.mutateAsync();
      setEnrollment(result);
      setStep(2);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al iniciar enrollment",
      );
    }
  };

  const handleDigitChange = (idx: number, value: string) => {
    const v = value.replace(/\D/g, "").slice(-1); // solo último dígito
    const next = [...digits];
    next[idx] = v;
    setDigits(next);
    if (v && idx < 5) {
      inputsRef.current[idx + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (
    idx: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      setDigits(text.split(""));
      inputsRef.current[5]?.focus();
    }
  };

  const handleVerificar = async () => {
    const code = digits.join("");
    if (code.length !== 6) {
      toast.error("Ingresá los 6 dígitos");
      return;
    }
    try {
      await verifyMut.mutateAsync({ code });
      setStep(4);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Código inválido — probá de nuevo",
      );
      setDigits(["", "", "", "", "", ""]);
      inputsRef.current[0]?.focus();
    }
  };

  const copySecret = async () => {
    if (!enrollment) return;
    await navigator.clipboard.writeText(enrollment.secret);
    setSecretCopied(true);
    setTimeout(() => setSecretCopied(false), 2000);
  };

  const copyAllCodes = async () => {
    if (!enrollment) return;
    await navigator.clipboard.writeText(enrollment.backup_codes.join("\n"));
    setAllCodesCopied(true);
    setTimeout(() => setAllCodesCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-[640px] space-y-6 py-8">
      {/* Stepper */}
      <ol className="flex items-center justify-between gap-2 px-1">
        {[1, 2, 3, 4].map((n) => {
          const active = step >= n;
          const labels = ["Inicio", "Escanear", "Verificar", "Listo"];
          return (
            <li
              key={n}
              className="flex flex-1 items-center gap-2"
              aria-current={step === n ? "step" : undefined}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200 ease-apple ${
                  active
                    ? "bg-cehta-green text-white"
                    : "bg-ink-100 text-ink-400"
                }`}
              >
                {step > n ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                ) : (
                  n
                )}
              </span>
              <span
                className={`hidden text-xs font-medium md:inline ${
                  active ? "text-ink-900" : "text-ink-400"
                }`}
              >
                {labels[n - 1]}
              </span>
              {n < 4 && (
                <span
                  className={`mx-1 h-px flex-1 transition-colors duration-200 ease-apple ${
                    step > n ? "bg-cehta-green" : "bg-hairline"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Step 1 */}
      {step === 1 && (
        <Surface>
          <div className="flex flex-col items-center text-center">
            <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-cehta-green/10">
              <ShieldCheck
                className="h-7 w-7 text-cehta-green"
                strokeWidth={1.5}
              />
            </span>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
              Configurar autenticación en 2 pasos
            </h1>
            <p className="mt-2 max-w-md text-sm text-ink-500">
              Sumá una capa extra de seguridad: además de tu contraseña, vas a
              ingresar un código de 6 dígitos generado por una app
              autenticadora.
            </p>
          </div>
          <div className="mt-6 space-y-3 rounded-xl bg-ink-50/40 p-4 text-sm text-ink-700">
            <div className="flex gap-3">
              <Smartphone
                className="mt-0.5 h-4 w-4 shrink-0 text-ink-500"
                strokeWidth={1.5}
              />
              <p>
                Necesitás una app:{" "}
                <span className="font-medium">
                  Google Authenticator, 1Password, Authy o Bitwarden
                </span>
                .
              </p>
            </div>
            <div className="flex gap-3">
              <KeyRound
                className="mt-0.5 h-4 w-4 shrink-0 text-ink-500"
                strokeWidth={1.5}
              />
              <p>
                Vas a recibir{" "}
                <span className="font-medium">10 backup codes</span> para
                emergencias (cuando perdés el celular).
              </p>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={handleEmpezar}
              disabled={enrollMut.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-150 ease-apple hover:bg-cehta-green-700 disabled:opacity-60"
            >
              {enrollMut.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              )}
              Empezar
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </Surface>
      )}

      {/* Step 2 */}
      {step === 2 && enrollment && (
        <Surface>
          <Surface.Header>
            <Surface.Title>Escaneá el código QR</Surface.Title>
            <Surface.Subtitle>
              Abrí tu app autenticadora y escaneá esta imagen.
            </Surface.Subtitle>
          </Surface.Header>
          <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="rounded-2xl border border-hairline bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={enrollment.qr_url}
                alt="QR para escanear con tu app autenticadora"
                width={240}
                height={240}
                className="block"
              />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-ink-500">
                  Si no podés escanear, ingresá manualmente
                </p>
                <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-hairline bg-white p-2.5">
                  <code className="flex-1 break-all font-mono text-xs text-ink-900">
                    {enrollment.secret}
                  </code>
                  <button
                    type="button"
                    onClick={copySecret}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-hairline bg-white text-ink-700 hover:bg-ink-50"
                  >
                    {secretCopied ? (
                      <Check
                        className="h-3.5 w-3.5 text-positive"
                        strokeWidth={2}
                      />
                    ) : (
                      <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
              </div>
              <p className="text-xs text-ink-500">
                Tu app va a mostrar un código de 6 dígitos que se actualiza
                cada 30 segundos.
              </p>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-150 ease-apple hover:bg-cehta-green-700"
            >
              Ya escaneé el código
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </Surface>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <Surface>
          <Surface.Header>
            <Surface.Title>Ingresá el código de 6 dígitos</Surface.Title>
            <Surface.Subtitle>
              Mirá tu app autenticadora y tipeá el número que aparece para
              Cehta Capital.
            </Surface.Subtitle>
          </Surface.Header>
          <div className="mt-6 flex justify-center gap-2">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputsRef.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleDigitKeyDown(i, e)}
                onPaste={handlePaste}
                aria-label={`Dígito ${i + 1}`}
                className="h-14 w-12 rounded-xl border-0 bg-white text-center font-mono text-2xl font-semibold tabular-nums text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            ))}
          </div>
          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="text-sm text-ink-500 underline hover:text-ink-700"
            >
              Volver al QR
            </button>
            <button
              type="button"
              onClick={handleVerificar}
              disabled={
                verifyMut.isPending || digits.some((d) => d === "")
              }
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-150 ease-apple hover:bg-cehta-green-700 disabled:opacity-60"
            >
              {verifyMut.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              )}
              Verificar
            </button>
          </div>
        </Surface>
      )}

      {/* Step 4 */}
      {step === 4 && enrollment && (
        <Surface className="border border-positive/30 bg-positive/5 ring-1 ring-positive/20">
          <div className="flex flex-col items-center text-center">
            <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-positive/15">
              <CheckCircle2
                className="h-6 w-6 text-positive"
                strokeWidth={1.75}
              />
            </span>
            <h2 className="font-display text-xl font-semibold tracking-tight text-ink-900">
              2FA activado
            </h2>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              Guardá tus 10 backup codes ahora — no se vuelven a mostrar.
              Usalos si perdés acceso al autenticador.
            </p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl border border-hairline bg-white p-4 sm:grid-cols-2">
            {enrollment.backup_codes.map((c) => (
              <code
                key={c}
                className="rounded-lg bg-ink-50/40 px-3 py-2 text-center font-mono text-sm tracking-wider text-ink-900"
              >
                {c}
              </code>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={copyAllCodes}
              className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
            >
              {allCodesCopied ? (
                <Check
                  className="h-4 w-4 text-positive"
                  strokeWidth={2}
                />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={1.75} />
              )}
              {allCodesCopied ? "Copiados" : "Copiar todos"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-150 ease-apple hover:bg-cehta-green-700"
            >
              Listo
            </button>
          </div>
        </Surface>
      )}
    </div>
  );
}
