import Link from "next/link";
import { notFound } from "next/navigation";
import { serverApiGet } from "@/lib/api/server";
import { ApiError } from "@/lib/api/client";
import type { ProveedorRead } from "@/lib/api/types";

export default async function ProveedorDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const proveedorId = Number(id);
  if (!Number.isInteger(proveedorId) || proveedorId <= 0) notFound();

  let proveedor: ProveedorRead | null = null;
  let fetchError: string | null = null;

  try {
    proveedor = await serverApiGet<ProveedorRead>(`/proveedores/${proveedorId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    fetchError = err instanceof Error ? err.message : "Error desconocido";
  }

  if (fetchError || !proveedor) {
    return (
      <div className="space-y-6">
        <Link href="/proveedores" className="text-sm text-green-700 hover:underline">
          ← Volver a proveedores
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <p className="text-sm font-medium text-red-700">No se pudo cargar el proveedor</p>
          <p className="mt-1 text-xs text-red-500">{fetchError}</p>
        </div>
      </div>
    );
  }

  const Field = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value || "—"}</dd>
    </div>
  );

  return (
    <div className="space-y-6">
      <Link href="/proveedores" className="text-sm text-green-700 hover:underline">
        ← Volver a proveedores
      </Link>

      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
          {proveedor.razon_social}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {proveedor.rut ? `RUT ${proveedor.rut}` : "Sin RUT registrado"}
        </p>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-medium text-gray-800">Datos generales</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Giro" value={proveedor.giro} />
          <Field label="Dirección" value={proveedor.direccion} />
          <Field label="Ciudad" value={proveedor.ciudad} />
          <Field label="Contacto" value={proveedor.contacto} />
          <Field label="Teléfono" value={proveedor.telefono} />
          <Field label="Email" value={proveedor.email} />
        </dl>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-medium text-gray-800">Datos bancarios</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Banco" value={proveedor.banco} />
          <Field label="Tipo de cuenta" value={proveedor.tipo_cuenta} />
          <Field label="Número de cuenta" value={proveedor.numero_cuenta} />
        </dl>
      </section>

      <p className="text-xs text-gray-400">
        Creado: {new Date(proveedor.created_at).toLocaleString("es-CL")}
        {" · "}
        Actualizado: {new Date(proveedor.updated_at).toLocaleString("es-CL")}
      </p>
    </div>
  );
}
