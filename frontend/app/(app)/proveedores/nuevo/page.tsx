"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { ProveedorCreate } from "@/lib/api/schema";

// Chilean RUT: 7+ digits optionally followed by a verification digit (0-9 or K/k)
function isValidRut(rut: string): boolean {
  return /^\d{7,8}-?[\dKk]$/.test(rut.replace(/\./g, ""));
}

type FieldErrors = Partial<Record<keyof ProveedorCreate | "general", string>>;

const FIELDS: Array<{
  name: keyof ProveedorCreate;
  label: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
}> = [
  {
    name: "razon_social",
    label: "Razón social",
    required: true,
    placeholder: "Empresa S.A.",
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

export default function NuevoProveedorPage() {
  const router = useRouter();
  const { session } = useSession();

  const [form, setForm] = useState<Partial<ProveedorCreate>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function handleChange(name: keyof ProveedorCreate, value: string) {
    setForm((prev) => ({ ...prev, [name]: value || undefined }));
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }

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

    setSubmitting(true);
    setErrors({});

    try {
      await apiClient.post("/proveedores", form, session);
      router.push("/proveedores");
    } catch (err) {
      if (err instanceof ApiError) {
        // Handle FastAPI 422 validation errors
        if (err.status === 422) {
          const detail: FieldErrors = {};
          try {
            const parsed = JSON.parse(err.detail);
            if (Array.isArray(parsed)) {
              parsed.forEach((e: { loc: string[]; msg: string }) => {
                const field = e.loc[e.loc.length - 1] as keyof ProveedorCreate;
                detail[field] = e.msg;
              });
            } else {
              detail.general = err.detail;
            }
          } catch {
            detail.general = err.detail;
          }
          setErrors(detail);
        } else {
          setErrors({ general: err.detail });
        }
      } else {
        setErrors({ general: "Error inesperado. Intenta nuevamente." });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/proveedores"
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Volver a proveedores
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
          Nuevo proveedor
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Completa los datos del proveedor.
        </p>
      </div>

      {/* General error banner */}
      {errors.general && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm text-negative">{errors.general}</p>
        </Surface>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} noValidate>
        <Surface>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {FIELDS.map(({ name, label, required, type, placeholder }) => (
              <div
                key={name}
                className={name === "razon_social" ? "sm:col-span-2" : ""}
              >
                <label
                  htmlFor={name}
                  className="mb-1.5 block text-sm font-medium text-ink-700"
                >
                  {label}
                  {required && (
                    <span className="ml-0.5 text-negative">*</span>
                  )}
                </label>
                <input
                  id={name}
                  type={type ?? "text"}
                  placeholder={placeholder}
                  value={(form[name] as string) ?? ""}
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

          {/* Actions */}
          <div className="mt-6 flex justify-end gap-3 border-t border-hairline pt-5">
            <button
              type="button"
              onClick={() => router.push("/proveedores")}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {submitting ? "Guardando…" : "Guardar proveedor"}
            </button>
          </div>
        </Surface>
      </form>
    </div>
  );
}
