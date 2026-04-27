import Link from "next/link";
import { notFound } from "next/navigation";
import { serverApiGet } from "@/lib/api/server";
import { ApiError } from "@/lib/api/client";
import type { OcRead } from "@/lib/api/schema";

const clp = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(n);
};

const estadoBadge = (estado: string) => {
  const map: Record<string, string> = {
    borrador: "bg-gray-100 text-gray-700",
    emitida: "bg-blue-100 text-blue-800",
    pagada: "bg-green-100 text-green-800",
    parcial: "bg-yellow-100 text-yellow-800",
    anulada: "bg-red-100 text-red-700",
  };
  const cls = map[estado.toLowerCase()] ?? "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {estado}
    </span>
  );
};

export default async function OcDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ocId = Number(id);
  if (!Number.isInteger(ocId) || ocId <= 0) notFound();

  let oc: OcRead | null = null;
  let fetchError: string | null = null;

  try {
    oc = await serverApiGet<OcRead>(`/ordenes-compra/${ocId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    fetchError = err instanceof Error ? err.message : "Error desconocido";
  }

  if (fetchError || !oc) {
    return (
      <div className="space-y-6">
        <Link href="/ordenes-compra" className="text-sm text-green-700 hover:underline">
          ← Volver a OCs
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <p className="text-sm font-medium text-red-700">No se pudo cargar la OC</p>
          <p className="mt-1 text-xs text-red-500">{fetchError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/ordenes-compra" className="text-sm text-green-700 hover:underline">
        ← Volver a OCs
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
            OC {oc.numero_oc}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {oc.empresa_codigo} · Emitida {oc.fecha_emision}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {estadoBadge(oc.estado)}
          {oc.pdf_url && (
            <a
              href={oc.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-green-700 hover:underline"
            >
              Ver PDF ↗
            </a>
          )}
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Neto</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{clp(oc.neto)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">IVA</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{clp(oc.iva)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total</p>
          <p className="mt-1 text-2xl font-semibold text-green-800">{clp(oc.total)}</p>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-800">Detalle</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Proveedor</dt>
            <dd className="mt-1">
              {oc.proveedor_id ? (
                <Link
                  href={`/proveedores/${oc.proveedor_id}`}
                  className="text-green-700 hover:underline"
                >
                  Proveedor #{oc.proveedor_id}
                </Link>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Moneda</dt>
            <dd className="mt-1 text-gray-900">{oc.moneda}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Validez</dt>
            <dd className="mt-1 text-gray-900">{oc.validez_dias} días</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Forma de pago</dt>
            <dd className="mt-1 text-gray-900">{oc.forma_pago ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Plazo</dt>
            <dd className="mt-1 text-gray-900">{oc.plazo_pago ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-gray-500">Observaciones</dt>
            <dd className="mt-1 whitespace-pre-wrap text-gray-900">{oc.observaciones ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {oc.items && oc.items.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <h2 className="border-b border-gray-100 px-6 py-4 text-lg font-medium text-gray-800">
            Ítems
          </h2>
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Descripción</th>
                <th className="px-4 py-3 text-right">P. Unitario</th>
                <th className="px-4 py-3 text-right">Cantidad</th>
                <th className="px-4 py-3 text-right">Total línea</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {oc.items.map((it) => (
                <tr key={it.detalle_id}>
                  <td className="px-4 py-3 text-gray-500">{it.item}</td>
                  <td className="px-4 py-3 text-gray-900">{it.descripcion}</td>
                  <td className="px-4 py-3 text-right text-gray-900">
                    {clp(it.precio_unitario)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900">{it.cantidad}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {clp(it.total_linea)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
