"use client";

/**
 * R152www · /admin/oc-branding
 *
 * Editar logo + colores + GG + firmantes RHO de cada empresa, de modo
 * que el PDF de OC quede branded por empresa.
 *
 * Una página simple: dropdown empresa → form con todos los campos →
 * guardar. Sin tablas para no complicar.
 */

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Image as ImageIcon,
  UserCheck,
  Users,
  Save,
  Plus,
  X,
  Palette,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";

interface Firmante {
  nombre: string;
  cargo?: string;
  email?: string;
  rut?: string;
}

interface Branding {
  codigo: string;
  razon_social: string;
  logo_dropbox_path: string | null;
  oc_color_primario: string | null;
  gerente_general_nombre: string | null;
  gerente_general_cargo: string | null;
  gerente_general_email: string | null;
  oc_firma_colectiva: boolean;
  firmantes_extra: Firmante[];
  cantidad_firmantes: number;
  // R152IIII
  emails_oc_cc: string[];
  auto_send_oc_emails: boolean;
}

const EMPRESAS = [
  "AFIS", "FIP_CEHTA", "CENERGY", "EVOQUE", "CSL",
  "TRONGKAI", "RHO", "REVTECH", "DTE",
];

export default function OcBrandingPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [empresaCodigo, setEmpresaCodigo] = useState("AFIS");

  const branding = useQuery<Branding>({
    queryKey: ["oc-branding", empresaCodigo],
    queryFn: () =>
      apiClient.get<Branding>(
        `/admin/empresas/${empresaCodigo}/oc-branding`,
        session,
      ),
    enabled: !!session,
    staleTime: 30_000,
  });

  // Form state
  const [logoPath, setLogoPath] = useState("");
  const [color, setColor] = useState("#236C4F");
  const [ggNombre, setGgNombre] = useState("");
  const [ggCargo, setGgCargo] = useState("");
  const [ggEmail, setGgEmail] = useState("");
  const [firmaColectiva, setFirmaColectiva] = useState(false);
  const [firmantes, setFirmantes] = useState<Firmante[]>([]);
  // R152IIII — Emails CC + auto-send
  const [emailsCc, setEmailsCc] = useState<string[]>([]);
  const [autoSend, setAutoSend] = useState(true);

  // Sync form cuando cambia empresa o llegan datos
  useEffect(() => {
    if (!branding.data) return;
    setLogoPath(branding.data.logo_dropbox_path ?? "");
    setColor(branding.data.oc_color_primario ?? "#236C4F");
    setGgNombre(branding.data.gerente_general_nombre ?? "");
    setGgCargo(branding.data.gerente_general_cargo ?? "");
    setGgEmail(branding.data.gerente_general_email ?? "");
    setFirmaColectiva(branding.data.oc_firma_colectiva);
    setFirmantes(branding.data.firmantes_extra ?? []);
    setEmailsCc(branding.data.emails_oc_cc ?? []);
    setAutoSend(branding.data.auto_send_oc_emails ?? true);
  }, [branding.data]);

  const saveMut = useMutation({
    mutationFn: async () =>
      apiClient.patch<Branding>(
        `/admin/empresas/${empresaCodigo}/oc-branding`,
        {
          logo_dropbox_path: logoPath || null,
          oc_color_primario: color,
          gerente_general_nombre: ggNombre || null,
          gerente_general_cargo: ggCargo || null,
          gerente_general_email: ggEmail || null,
          oc_firma_colectiva: firmaColectiva,
          firmantes_extra: firmantes,
          // R152IIII
          emails_oc_cc: emailsCc,
          auto_send_oc_emails: autoSend,
        },
        session,
      ),
    onSuccess: () => {
      toast.success(`Branding de ${empresaCodigo} guardado`);
      qc.invalidateQueries({ queryKey: ["oc-branding", empresaCodigo] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.detail : "Error guardando");
    },
  });

  const addFirmante = () =>
    setFirmantes([...firmantes, { nombre: "", cargo: "" }]);
  const removeFirmante = (i: number) =>
    setFirmantes(firmantes.filter((_, idx) => idx !== i));
  const updateFirmante = (i: number, f: Partial<Firmante>) =>
    setFirmantes(
      firmantes.map((x, idx) => (idx === i ? { ...x, ...f } : x)),
    );

  return (
    <div className="mx-auto max-w-3xl px-6 lg:px-10 pt-8 pb-24 space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
          R152www · MEJORAS IA.docx #4
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
          Branding OC por empresa
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Cada OC se imprime con el logo y la firma del Gerente General de la
          empresa emisora. RHO tiene firma colectiva (todos los integrantes
          firman).
        </p>
      </div>

      {/* Selector */}
      <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
        <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 mb-2">
          <Building2 className="inline h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
          Empresa
        </label>
        <select
          value={empresaCodigo}
          onChange={(e) => setEmpresaCodigo(e.target.value)}
          className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          {EMPRESAS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {branding.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          {/* Logo + color */}
          <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card space-y-4">
            <h2 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-cehta-green" strokeWidth={1.5} />
              Logo y color
            </h2>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 mb-1">
                URL del logo (HTTPS o path Dropbox)
              </label>
              <input
                type="text"
                value={logoPath}
                onChange={(e) => setLogoPath(e.target.value)}
                placeholder={`https://cehta-capital.vercel.app/logos/${empresaCodigo.toLowerCase()}.png`}
                className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm font-mono ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
              <p className="mt-1 text-xs text-ink-500">
                Acepta dos formatos:
                <br />
                1. <strong>URL HTTPS</strong> (recomendado) — ej.{" "}
                <code className="text-[10px]">/logos/{empresaCodigo.toLowerCase()}.png</code> en{" "}
                <code className="text-[10px]">frontend/public/</code>.
                <br />
                2. <strong>Path Dropbox</strong> — ej.{" "}
                <code className="text-[10px]">/Cehta Capital/01-Empresas/{empresaCodigo}/00-Branding/logo.png</code>.
              </p>
              {/* R152BBBB — Preview del logo actual */}
              {logoPath && (logoPath.startsWith("http://") || logoPath.startsWith("https://")) && (
                <div className="mt-3 inline-flex items-center gap-3 rounded-xl border border-hairline bg-white p-3">
                  <img
                    src={logoPath}
                    alt={`Logo ${empresaCodigo}`}
                    className="h-16 w-auto max-w-[200px] object-contain"
                    onError={(e) => {
                      const target = e.currentTarget;
                      target.style.display = "none";
                      target.parentElement!.querySelector(".logo-error")!.classList.remove("hidden");
                    }}
                  />
                  <span className="logo-error hidden text-xs text-red-600">
                    ✗ URL inválida o imagen no carga
                  </span>
                  <div className="text-xs text-ink-500">
                    <div className="font-medium text-ink-900">Preview en vivo</div>
                    <div>Se mostrará en el PDF de cada OC de {empresaCodigo}.</div>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 mb-1">
                <Palette className="inline h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
                Color primario (HEX)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-16 rounded-lg border border-hairline cursor-pointer"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  pattern="^#?[0-9A-Fa-f]{6}$"
                  className="w-32 rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm font-mono ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </div>
            </div>
          </section>

          {/* Gerente general */}
          <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card space-y-4">
            <h2 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-cehta-green" strokeWidth={1.5} />
              Gerente General (firmante principal)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Nombre completo">
                <input
                  type="text"
                  value={ggNombre}
                  onChange={(e) => setGgNombre(e.target.value)}
                  className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </Field>
              <Field label="Cargo">
                <input
                  type="text"
                  value={ggCargo}
                  onChange={(e) => setGgCargo(e.target.value)}
                  placeholder="Gerente General"
                  className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </Field>
              <Field label="Email (opcional)">
                <input
                  type="email"
                  value={ggEmail}
                  onChange={(e) => setGgEmail(e.target.value)}
                  className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </Field>
            </div>
          </section>

          {/* Firma colectiva (RHO) */}
          <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
                  <Users className="h-5 w-5 text-cehta-green" strokeWidth={1.5} />
                  Firma colectiva
                </h2>
                <p className="text-xs text-ink-500 mt-1">
                  Cuando es TRUE, el PDF muestra <strong>todos</strong> los
                  firmantes de abajo en vez del GG. Caso de uso: RHO (todos los
                  integrantes firman cada OC).
                </p>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={firmaColectiva}
                  onChange={(e) => setFirmaColectiva(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="relative w-11 h-6 bg-ink-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-ink-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cehta-green"></div>
              </label>
            </div>

            {firmaColectiva && (
              <div className="space-y-3">
                {firmantes.map((f, i) => (
                  <div key={i} className="rounded-xl bg-ink-50/40 p-3 ring-1 ring-hairline space-y-2 relative">
                    <button
                      type="button"
                      onClick={() => removeFirmante(i)}
                      className="absolute top-2 right-2 text-ink-400 hover:text-red-600"
                    >
                      <X className="h-4 w-4" strokeWidth={2} />
                    </button>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Nombre"
                        value={f.nombre}
                        onChange={(e) => updateFirmante(i, { nombre: e.target.value })}
                        className="rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                      />
                      <input
                        type="text"
                        placeholder="Cargo"
                        value={f.cargo ?? ""}
                        onChange={(e) => updateFirmante(i, { cargo: e.target.value })}
                        className="rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                      />
                      <input
                        type="email"
                        placeholder="Email (opcional)"
                        value={f.email ?? ""}
                        onChange={(e) => updateFirmante(i, { email: e.target.value })}
                        className="rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                      />
                      <input
                        type="text"
                        placeholder="RUT (opcional)"
                        value={f.rut ?? ""}
                        onChange={(e) => updateFirmante(i, { rut: e.target.value })}
                        className="rounded-lg border-0 bg-white px-3 py-2 text-sm font-mono ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addFirmante}
                  className="inline-flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-100"
                >
                  <Plus className="h-4 w-4" strokeWidth={2} />
                  Agregar firmante
                </button>
              </div>
            )}
          </section>

          {/* R152JJJJ — Destinatarios emails OC */}
          <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-cehta-green" strokeWidth={1.5} />
                  Destinatarios emails OC
                </h2>
                <p className="text-xs text-ink-500 mt-1">
                  Cuando se crea una OC para esta empresa (auto desde email o manual),
                  el sistema manda el PDF al <strong>TO</strong> y <strong>CC</strong>.
                </p>
              </div>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSend}
                  onChange={(e) => setAutoSend(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="relative w-11 h-6 bg-ink-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-ink-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cehta-green"></div>
                <span className="ml-2 text-xs text-ink-600">Auto-enviar</span>
              </label>
            </div>

            {/* TO — info readonly + warning */}
            <div className="rounded-xl bg-ink-50/40 p-3 ring-1 ring-hairline">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 mb-1">
                TO · Destinatario principal (firmante)
              </div>
              {firmaColectiva ? (
                <div>
                  <div className="text-sm text-ink-900">
                    {firmantes.filter((f) => (f.email ?? "").trim()).length} email
                    {firmantes.filter((f) => (f.email ?? "").trim()).length === 1
                      ? ""
                      : "s"}{" "}
                    desde firmantes (firma colectiva RHO)
                  </div>
                  <div className="mt-1 text-xs text-ink-500 truncate">
                    {firmantes
                      .filter((f) => (f.email ?? "").trim())
                      .map((f) => f.email)
                      .join(", ") || "⚠ Ningún firmante tiene email — cargá arriba"}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-ink-900 font-mono">
                  {ggEmail || (
                    <span className="text-red-600 font-sans">
                      ⚠ Falta email del GG — cargalo arriba en "Gerente General"
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* CC — editor chips */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 mb-2">
                CC · Encargados / asistentes
              </label>
              <div className="flex flex-wrap gap-2">
                {emailsCc.map((email, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-full bg-cehta-green/10 px-3 py-1 text-xs text-ink-900 ring-1 ring-cehta-green/30"
                  >
                    <span className="font-mono">{email}</span>
                    <button
                      onClick={() =>
                        setEmailsCc(emailsCc.filter((_, idx) => idx !== i))
                      }
                      className="text-ink-500 hover:text-red-600"
                      aria-label={`Eliminar ${email}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <CcEmailInput
                  onAdd={(email) => {
                    if (!emailsCc.includes(email)) {
                      setEmailsCc([...emailsCc, email]);
                    }
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-ink-500">
                Enter para agregar. Ej: asistente del GG, contador externo,
                Nicolás para tracking.
              </p>
            </div>

            {!autoSend && (
              <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 p-3 text-xs text-amber-800">
                ⚠ Auto-envío desactivado: las OCs auto-creadas para esta empresa
                quedan SIN enviar. El operador tiene que mandarlas manualmente
                desde el detalle de cada OC.
              </div>
            )}
          </section>

          {/* Save */}
          <div className="sticky bottom-4 flex justify-end">
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-6 py-3 text-sm font-semibold text-white shadow-card hover:bg-cehta-green/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" strokeWidth={2} />
              {saveMut.isPending ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

// R152JJJJ — Input chip-style para agregar emails CC al toque
function CcEmailInput({ onAdd }: { onAdd: (email: string) => void }) {
  const [val, setVal] = useState("");
  const valid = /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(val.trim());

  const submit = () => {
    if (valid) {
      onAdd(val.trim());
      setVal("");
    }
  };

  return (
    <input
      type="email"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          submit();
        }
      }}
      onBlur={() => {
        if (valid) submit();
      }}
      placeholder="agregar email + Enter"
      className={`rounded-full bg-white px-3 py-1 text-xs font-mono ring-1 ring-hairline focus:outline-none focus:ring-2 ${
        val && !valid
          ? "ring-red-300 text-red-700"
          : "focus:ring-cehta-green text-ink-700"
      }`}
      style={{ minWidth: 200 }}
    />
  );
}
