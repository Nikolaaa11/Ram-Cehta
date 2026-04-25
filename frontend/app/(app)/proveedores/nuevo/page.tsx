"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { ProveedorCreate } from "@/lib/api/types";

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
  { name: "razon_social", label: "Razón social", required: true, placeholder: "Empresa S.A." },
  { name: "rut", label: "RUT", placeholder: "12345678-9" },
  { name: "giro", label: "Giro", placeholder: "Servicios de consultoría" },
  { name: "direccion", label: "Dirección", placeholder: "Av. Providencia 123" },
  { name: "ciudad", label: "Ciudad", placeholder: "Santiago" },
  { name: "contacto", label: "Contacto", placeholder: "Nombre del contacto" },
  { name: "telefono", label: "Teléfono", placeholder: "+56 9 1234 5678" },
  { name: "email", label: "Email", type: "email", placeholder: "contacto@empresa.cl" },
  { name: "banco", label: "Banco", placeholder: "Banco Estado" },
  { name: "tipo_cuenta", label: "Tipo de cuenta", placeholder: "Corriente / Vista / Ahorro" },
  { name: "numero_cuenta", label: "Número de cuenta", placeholder: "00123456789" },
];

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
          className="mb-1 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
        >
          ← Volver a proveedores
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Nuevo proveedor</h1>
        <p className="mt-1 text-sm text-gray-500">Completa los datos del proveedor.</p>
      </div>

      {/* General error banner */}
      {errors.general && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errors.general}
        </div>
      )}

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {FIELDS.map(({ name, label, required, type, placeholder }) => (
            <div key={name} className={name === "razon_social" ? "sm:col-span-2" : ""}>
              <Label
                htmlFor={name}
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                {label}
                {required && <span className="ml-0.5 text-red-500">*</span>}
              </Label>
              <Input
                id={name}
                type={type ?? "text"}
                placeholder={placeholder}
                value={(form[name] as string) ?? ""}
                onChange={(e) => handleChange(name, e.target.value)}
                className={
                  errors[name]
                    ? "border-red-400 focus:border-red-500 focus:ring-red-500"
                    : "border-gray-300 focus:border-green-800 focus:ring-green-800"
                }
              />
              {errors[name] && (
                <p className="mt-1 text-xs text-red-600">{errors[name]}</p>
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-5">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/proveedores")}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={submitting}
            className="bg-green-800 text-white hover:bg-green-900 disabled:opacity-60"
          >
            {submitting ? "Guardando..." : "Guardar proveedor"}
          </Button>
        </div>
      </form>
    </div>
  );
}
