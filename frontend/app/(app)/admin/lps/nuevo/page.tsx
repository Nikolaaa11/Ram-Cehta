"use client";

/**
 * /admin/lps/nuevo — Form para crear un nuevo LP.
 *
 * Campos: nombre + apellido + email + teléfono + empresa + rol +
 * estado + perfil + intereses (multi-select) + aporte total/actual +
 * empresas invertidas + relationship_owner + notas.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Save, Loader2, Users } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { apiClient, ApiError } from "@/lib/api/client";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import type { EstadoLp, LpCreate, LpRead, PerfilInversor } from "@/lib/api/schema";

export default function NuevoLpPage() {
  const router = useRouter();
  const { session } = useSession();
  const { data: empresas = [] } = useCatalogoEmpresas();

  const [form, setForm] = useState<LpCreate>({
    nombre: "",
    apellido: "",
    email: "",
    telefono: "",
    empresa: "",
    rol: "",
    estado: "pipeline",
    perfil_inversor: null,
    intereses: [],
    relationship_owner: "",
    aporte_total: null,
    aporte_actual: null,
    empresas_invertidas: [],
    notas: "",
    primer_contacto: new Date().toISOString().slice(0, 10),
  });

  // Detección de duplicados por email — query opcional
  const emailToCheck = form.email?.trim().toLowerCase() ?? "";
  const { data: existingLps } = useApiQuery<LpRead[]>(
    ["lps", "by-email-check", emailToCheck],
    "/lps",
    emailToCheck.length > 3 && emailToCheck.includes("@"),
  );
  const duplicate = existingLps?.find(
    (lp) => (lp.email ?? "").toLowerCase() === emailToCheck,
  );

  const mutation = useMutation({
    mutationFn: () => {
      // Limpiar campos vacíos string a null para Pydantic
      const payload: LpCreate = {
        ...form,
        nombre: form.nombre.trim(),
        apellido: form.apellido?.trim() || null,
        email: form.email?.trim() || null,
        telefono: form.telefono?.trim() || null,
        empresa: form.empresa?.trim() || null,
        rol: form.rol?.trim() || null,
        relationship_owner: form.relationship_owner?.trim() || null,
        notas: form.notas?.trim() || null,
        intereses: form.intereses ?? [],
        empresas_invertidas: form.empresas_invertidas ?? [],
      };
      return apiClient.post<LpRead>("/lps", payload, session);
    },
    onSuccess: (data) => {
      toast.success(`LP creado: ${data.nombre}`);
      router.push(`/admin/lps/${data.lp_id}` as never);
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError
          ? `[${err.status}] ${err.detail}`
          : err instanceof Error
          ? err.message
          : "Error creando LP";
      toast.error(msg, { duration: 10_000 });
    },
  });

  const toggleInteres = (i: string) => {
    const current = form.intereses ?? [];
    if (current.includes(i)) {
      setForm({ ...form, intereses: current.filter((x) => x !== i) });
    } else {
      setForm({ ...form, intereses: [...current, i] });
    }
  };

  const toggleEmpresa = (cod: string) => {
    const current = form.empresas_invertidas ?? [];
    if (current.includes(cod)) {
      setForm({
        ...form,
        empresas_invertidas: current.filter((x) => x !== cod),
      });
    } else {
      setForm({ ...form, empresas_invertidas: [...current, cod] });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href={"/admin/lps" as never}
        className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-700"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        Volver al listado
      </Link>

      <Surface>
        <Surface.Header divider>
          <Surface.Title>
            <span className="inline-flex items-center gap-2">
              <Users className="h-5 w-5 text-cehta-green" strokeWidth={1.75} />
              Nuevo LP
            </span>
          </Surface.Title>
          <Surface.Subtitle>
            Registrá un inversionista (potencial o activo) para luego poder
            generarle informes personalizados con AI.
          </Surface.Subtitle>
        </Surface.Header>
        <Surface.Body>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.nombre.trim()) {
                toast.error("El nombre es obligatorio");
                return;
              }
              mutation.mutate();
            }}
            className="space-y-6"
          >
            {/* Identidad */}
            <Section title="Identidad">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Nombre"
                  required
                  value={form.nombre}
                  onChange={(v) => setForm({ ...form, nombre: v })}
                  placeholder="Sebastián"
                />
                <Field
                  label="Apellido"
                  value={form.apellido ?? ""}
                  onChange={(v) => setForm({ ...form, apellido: v })}
                  placeholder="Pérez"
                />
                <Field
                  label="Email"
                  type="email"
                  value={form.email ?? ""}
                  onChange={(v) => setForm({ ...form, email: v })}
                  placeholder="sebastian@familyoffice.cl"
                  warning={
                    duplicate
                      ? `Ya existe un LP con este email: ${duplicate.nombre} ${duplicate.apellido ?? ""}`
                      : null
                  }
                />
                <Field
                  label="Teléfono"
                  value={form.telefono ?? ""}
                  onChange={(v) => setForm({ ...form, telefono: v })}
                  placeholder="+56 9 1234 5678"
                />
                <Field
                  label="Empresa / Family Office"
                  value={form.empresa ?? ""}
                  onChange={(v) => setForm({ ...form, empresa: v })}
                  placeholder="Pérez Family Office"
                />
                <Field
                  label="Rol"
                  value={form.rol ?? ""}
                  onChange={(v) => setForm({ ...form, rol: v })}
                  placeholder="Gerente Inversiones"
                />
              </div>
            </Section>

            {/* Estado y perfil */}
            <Section title="Estado en pipeline">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-700">
                    Estado
                  </label>
                  <select
                    value={form.estado}
                    onChange={(e) =>
                      setForm({ ...form, estado: e.target.value as EstadoLp })
                    }
                    className="w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  >
                    <option value="pipeline">Pipeline (potencial)</option>
                    <option value="cualificado">Cualificado (interés concreto)</option>
                    <option value="activo">Activo (ya invierte)</option>
                    <option value="inactivo">Inactivo</option>
                    <option value="declinado">Declinado</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-700">
                    Perfil inversor
                  </label>
                  <select
                    value={form.perfil_inversor ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        perfil_inversor: (e.target.value || null) as
                          | PerfilInversor
                          | null,
                      })
                    }
                    className="w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  >
                    <option value="">Sin clasificar</option>
                    <option value="conservador">Conservador</option>
                    <option value="moderado">Moderado</option>
                    <option value="agresivo">Agresivo</option>
                    <option value="esg_focused">ESG-focused</option>
                  </select>
                </div>
                <Field
                  label="Primer contacto"
                  type="date"
                  value={form.primer_contacto ?? ""}
                  onChange={(v) => setForm({ ...form, primer_contacto: v })}
                />
                <Field
                  label="Relationship Manager (email)"
                  value={form.relationship_owner ?? ""}
                  onChange={(v) => setForm({ ...form, relationship_owner: v })}
                  placeholder="guido@cehtacapital.cl"
                />
              </div>
            </Section>

            {/* Intereses temáticos */}
            <Section title="Intereses (afecta personalización del informe AI)">
              <div className="flex flex-wrap gap-2">
                {[
                  "renovables",
                  "minería responsable",
                  "agro-tech",
                  "BESS",
                  "ESG",
                  "fintech",
                  "real estate",
                  "venture capital",
                ].map((i) => {
                  const selected = form.intereses?.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleInteres(i)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        selected
                          ? "border-cehta-green bg-cehta-green/10 text-cehta-green"
                          : "border-hairline text-ink-600 hover:bg-ink-50",
                      )}
                    >
                      {i}
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* Capital */}
            <Section title="Capital">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Aporte total comprometido (CLP)"
                  type="number"
                  value={String(form.aporte_total ?? "")}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      aporte_total: v ? Number(v) : null,
                    })
                  }
                  placeholder="500000000"
                />
                <Field
                  label="Aporte ya integrado (CLP)"
                  type="number"
                  value={String(form.aporte_actual ?? "")}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      aporte_actual: v ? Number(v) : null,
                    })
                  }
                  placeholder="300000000"
                />
              </div>

              {/* Empresas en cartera */}
              <div className="mt-4">
                <label className="mb-2 block text-xs font-medium text-ink-700">
                  Empresas en cartera del LP
                </label>
                <div className="flex flex-wrap gap-2">
                  {empresas.map((e) => {
                    const selected = form.empresas_invertidas?.includes(
                      e.codigo,
                    );
                    return (
                      <button
                        key={e.codigo}
                        type="button"
                        onClick={() => toggleEmpresa(e.codigo)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-medium font-mono transition-colors",
                          selected
                            ? "border-cehta-green bg-cehta-green/10 text-cehta-green"
                            : "border-hairline text-ink-600 hover:bg-ink-50",
                        )}
                      >
                        {e.codigo}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Section>

            {/* Notas */}
            <Section title="Notas internas">
              <textarea
                value={form.notas ?? ""}
                onChange={(e) => setForm({ ...form, notas: e.target.value })}
                rows={3}
                placeholder="Conoce a Guido desde 2024. Le interesa BESS. Próximo follow-up en mayo…"
                className="w-full rounded-xl border-0 bg-white px-4 py-3 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </Section>

            {/* Submit */}
            <div className="flex items-center justify-end gap-2 border-t border-hairline pt-5">
              <Link
                href={"/admin/lps" as never}
                className="rounded-xl px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100/40"
              >
                Cancelar
              </Link>
              <button
                type="submit"
                disabled={mutation.isPending || !form.nombre.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                    Guardando…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" strokeWidth={2} />
                    Crear LP
                  </>
                )}
              </button>
            </div>
          </form>
        </Surface.Body>
      </Surface>
    </div>
  );
}

// ─── Sub-componentes ───────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="border-t border-hairline pt-5">
      <legend className="-mt-7 bg-white pr-2 text-xs font-medium uppercase tracking-wider text-ink-500">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  type = "text",
  required,
  value,
  onChange,
  placeholder,
  warning,
}: {
  label: string;
  type?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  warning?: string | null;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-700">
        {label}
        {required && <span className="ml-0.5 text-negative">*</span>}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 transition-all focus:outline-none focus:ring-2 focus:ring-cehta-green",
          warning ? "ring-warning/40" : "ring-hairline",
        )}
      />
      {warning && (
        <p className="mt-1 text-[11px] text-warning">⚠️ {warning}</p>
      )}
    </div>
  );
}
