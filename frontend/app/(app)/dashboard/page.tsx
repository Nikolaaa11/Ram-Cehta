import { serverApiGet } from "@/lib/api/server";
import type { DashboardData } from "@/lib/api/types";

const clp = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(num);
};

const estadoBadge = (estado: string) => {
  const map: Record<string, string> = {
    pendiente: "bg-yellow-100 text-yellow-800",
    pagado: "bg-green-100 text-green-800",
    vencido: "bg-red-100 text-red-800",
    emitida: "bg-blue-100 text-blue-800",
    anulada: "bg-gray-100 text-gray-600",
  };
  const cls = map[estado.toLowerCase()] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {estado}
    </span>
  );
};

export default async function DashboardPage() {
  let data: DashboardData | null = null;
  let fetchError: string | null = null;

  try {
    data = await serverApiGet<DashboardData>("/dashboard");
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Error desconocido al cargar el dashboard.";
  }

  if (fetchError || !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Dashboard</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <p className="text-sm font-medium text-red-700">
            No se pudo cargar el dashboard
          </p>
          <p className="mt-1 text-xs text-red-500">{fetchError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Período: {data.periodo_actual}</p>
      </div>

      {/* ── Saldos por empresa ─────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-medium text-gray-800">Saldos por empresa</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.saldos_por_empresa.map((s) => (
            <div
              key={s.empresa_codigo}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {s.empresa_codigo}
                </p>
                <p className="mt-0.5 truncate text-sm font-medium text-gray-900">
                  {s.razon_social}
                </p>
                {s.periodo && (
                  <p className="mt-0.5 text-xs text-gray-400">Período {s.periodo}</p>
                )}
              </div>
              <dl className="space-y-1">
                <div className="flex justify-between">
                  <dt className="text-xs text-gray-500">Saldo Cehta</dt>
                  <dd className="text-xs font-medium text-gray-900">{clp(s.saldo_cehta)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-xs text-gray-500">Saldo CORFO</dt>
                  <dd className="text-xs font-medium text-gray-900">{clp(s.saldo_corfo)}</dd>
                </div>
                <div className="flex justify-between border-t border-gray-100 pt-1">
                  <dt className="text-xs font-medium text-gray-700">Saldo contable</dt>
                  <dd className="text-xs font-semibold text-green-800">{clp(s.saldo_contable)}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </section>

      {/* ── OC Resumen ────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-medium text-gray-800">Órdenes de Compra</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "OC emitidas", value: data.oc_resumen.total_emitidas, sub: clp(data.oc_resumen.monto_total_emitidas) },
            { label: "OC pagadas", value: data.oc_resumen.total_pagadas, sub: clp(data.oc_resumen.monto_total_pagadas) },
            { label: "OC anuladas", value: data.oc_resumen.total_anuladas, sub: null },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <p className="text-xs text-gray-500">{item.label}</p>
              <p className="mt-1 text-3xl font-semibold text-gray-900">{item.value}</p>
              {item.sub && <p className="mt-1 text-xs text-gray-400">{item.sub}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* ── F29 pendientes ────────────────────────────────────────────── */}
      {data.f29_pendientes.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium text-gray-800">F29 pendientes</h2>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["Empresa", "Período tributario", "Vencimiento", "Monto", "Estado"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.f29_pendientes.map((f, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                      {f.empresa_codigo}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {f.periodo_tributario}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {f.fecha_vencimiento}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-900">
                      {clp(f.monto_a_pagar)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {estadoBadge(f.estado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Movimientos recientes ─────────────────────────────────────── */}
      {data.movimientos_recientes.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium text-gray-800">Movimientos recientes</h2>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["Fecha", "Empresa", "Descripción", "Abono", "Egreso"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.movimientos_recientes.map((m) => (
                  <tr key={m.movimiento_id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{m.fecha}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                      {m.empresa_codigo}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-gray-600">
                      {m.descripcion ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-green-700">
                      {Number(m.abono) > 0 ? clp(m.abono) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-red-600">
                      {Number(m.egreso) > 0 ? clp(m.egreso) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
