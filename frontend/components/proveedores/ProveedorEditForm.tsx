"use client";

/**
 * ProveedorEditForm — formulario de edición de proveedor.
 *
 * Pre-llena con `initialData`, calcula los campos modificados (dirty fields)
 * y envía sólo el diff vía `PATCH /proveedores/{id}`. Maneja 422 (errores
 * por campo) y 409 (RUT duplicado).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { ProveedorRead, ProveedorUpdate } from "@/lib/api/schema";

function isValidRut(rut: string): boolean {
  return /^\d{7,8}-?[\dKk]$/.test(rut.replace(/\./g, ""));
}

type FieldKey = keyof ProveedorUpdate;
type FieldErrors = Partial<Record<FieldKey | "general", string>>;

const FIELDS: Array<{
  name: FieldKey;
  label: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  span2?: boolean;
}> = [
  {
    name: "razon_social",
    label: "Razón social",
    required: true,
    placeholder: "Empresa S.A.",
    span2: true,
  },
  { name: "rut", label: "RUT", placeholder: "12345678-9" },
  { name: "giro", label: "Giro", placeholder: "Servicios de consultoría" },
  { name: "direccion", label: "Dirección", placeholder: "Av. Providencia 123" },
  { name: "ciudad", label: "Ciudad", placeholder: "Santiago" },
  { name: "contacto", label: "Contacto", placeholder: "Nombre del contacto" },
  { name: "telefono", label: "Teléfono", placeholder: "+56 9 1234 5678" },
  {
    name: "email",
    label: "Email",
    type: "email",
    placeholder: "contacto@empresa.cl",
  },
  { name: "banco", label: "Banco", placeholder: "Banco Estado" },
  {
    name: "tipo_cuenta",
    label: "Tipo de cuenta",
    placeholder: "Corriente / Vista / Ahorro",
  },
  {
    name: "numero_cuenta",
    label: "Número de cuenta",
    placeholder: "00123456789",
  },
];

const inputBase =
  "w-full rounded-lg border-0 ring-1 ring-hairline bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 transition-shadow focus:outline-none focus:ring-2 focus:ring-cehta-green";
const inputError = "ring-negative focus:ring-negative";

interface Props {
  initialData: ProveedorRead;
}

export function ProveedorEditForm({ initialData }: Props) {
  const router = useRouter();
  const { session } = useSession();
  const queryClient = useQueryClient();

  const initial = useMemo<Record<FieldKey, string>>(
    () => ({
      razon_social: initialData.razon_social ?? "",
      rut: initialData.rut ?? "",
      giro: initialData.giro ?? "",
      direccion: initialData.direccion ?? "",
      ciudad: initialData.ciudad ?? "",
      contacto: initialData.contacto ?? "",
      telefono: initialData.telefono ?? "",
      email: initialData.email ?? "",
      banco: initialData.banco ?? "",
      tipo_cuenta: initialData.tipo_cuenta ?? "",
      numero_cuenta: initialData.numero_cuenta ?? "",
    }),
    [initialData],
  );

  const [form, setForm] = useState<Record<FieldKey, string>>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function handleChange(name: FieldKey, value: string) {
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name] || errors.general) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        delete next.general;
        return next;
      });
    }
  }

  const dirty = useMemo<ProveedorUpdate>(() => {
    const out: Record<string, string | null> = {};
    (Object.keys(form) as FieldKey[]).forEach((k) => {
      const before = initial[k] ?? "";
      const after = form[k] ?? "";
      if (before !== after) {
        out[k] = after === "" ? null : after;
      }
    });
    return out as ProveedorUpdate;
  }, [form, initial]);

  const isDirty = Object.keys(dirty).length > 0;

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!form.razon_social?.trim()) {
      next.razon_social = "La razón social es obligatoria.";
    }
    if (form.rut && !isValidRut(form.rut)) {
      next.rut = "RUT inválido. Formato esperado: 12345678-9";
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      next.email = "Email inválido.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;
    if (!isDirty) {
      toast.info("Sin cambios para guardar");
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      await apiClient.patch<ProveedorRead>(
        `/proveedores/${initialData.proveedor_id}`,
        dirty,
        session,
      );
      toast.success("Cambios guardados");
      await queryClient.invalidateQueries({ queryKey: ["proveedores"] });
      router.push(`/proveedores/${initialData.proveedor_id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 422) {
          const detail: FieldErrors = {};
          try {
            const parsed = JSON.parse(err.detail);
            if (Array.isArray(parsed)) {
              parsed.forEach((e: { loc: string[]; msg: string }) => {
                const field = e.loc[e.loc.length - 1] as FieldKey;
                detail[field] = e.msg;
              });
            } else {
              detail.general = err.detail;
            }
          } catch {
            detail.general = err.detail;
          }
          setErrors(detail);
          toast.error("Revisá los campos marcados");
        } else if (err.status === 409) {
          setErrors({ rut: "Ya existe un proveedor con ese RUT." });
          toast.error("RUT duplicado");
        } else {
          setErrors({ general: err.detail });
          toast.error(err.detail);
        }
      } else {
        setErrors({ general: "Error inesperado. Intenta nuevamente." });
        toast.error("Error inesperado");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={`/proveedores/${initialData.proveedor_id}`}
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Volver al proveedor
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
          Editar proveedor
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Modificá los campos necesarios. Sólo se enviarán los cambios.
        </p>
      </div>

      {errors.general && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm text-negative">{errors.general}</p>
        </Surface>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <Surface>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {FIELDS.map(({ name, label, required, type, placeholder, span2 }) => (
              <div key={name} className={span2 ? "sm:col-span-2" : ""}>
                <label
                  htmlFor={name}
                  className="mb-1.5 block text-sm font-medium text-ink-700"
                >
                  {label}
                  {required && <span className="ml-0.5 text-negative">*</span>}
                </label>
                <input
                  id={name}
                  type={type ?? "text"}
                  placeholder={placeholder}
                  value={form[name] ?? ""}
                  onChange={(e) => handleChange(name, e.target.value)}
                  className={`${inputBase} ${errors[name] ? inputError : ""}`}
                  aria-invalid={errors[name] ? true : undefined}
                />
                {errors[name] && (
                  <p className="mt-1 text-xs text-negative">{errors[name]}</p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-hairline pt-5">
            <Link
              href={`/proveedores/${initialData.proveedor_id}`}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              disabled={submitting || !isDirty}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {submitting ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </Surface>
      </form>
    </div>
  );
}
