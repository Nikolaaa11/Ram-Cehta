"use client";

/**
 * /empresa/[codigo]/tributario — Round 152d
 *
 * Status tributario por empresa: F29 + F22 + SII documentos.
 *   - F29 mensual: períodos pendientes/declarados
 *   - F22 anual: declaraciones de renta
 *   - SII docs: facturas emitidas/recibidas recientes
 */
import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Calendar, FileText, ExternalLink } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface F29 {
  periodo: string;
  estado: string;
  fecha_vencimiento: string | null;
  fecha_presentacion: string | null;
  monto_iva_debito: string | number | null;
  monto_iva_credito: string | number | null;
}

interface F22 {
  ano_tributario: number;
  estado: string;
  fecha_vencimiento: string | null;
  monto_a_pagar: string | number | null;
  monto_a_devolver: string | number | null;
}

interface SiiDoc {
  tipo_dte: string;
  folio: number;
  emisor_rut: string | null;
  receptor_rut: string | null;
  fecha_emision: string;
  monto_total: string | number;
}

interface TributarioSummary {
  f29: F29[];
  f22: F22[];
  sii_docs_recent: SiiDoc[];
}

const numeric: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

const fmtClp = (v: number) =>
  v.toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

export default function TributarioPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const { session } = useSession();

  const { data, isLoading, error } = useQuery<TributarioSummary>({
    queryKey: ["empresa", codigo, "tributario"],
    queryFn: () =>
      apiClient.get<TributarioSummary>(
        `/empresa/${encodeURIComponent(codigo)}/tributario`,
        session,
      ),
    enabled: !!session,
  });

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/50 p-6 text-sm text-red-900">
        <p className="font-semibold">No se pudo cargar Tributario</p>
        <p className="mt-1 text-xs text-red-700">
          {error instanceof Error ? error.message : "Error desconocido"}
        </p>
        <p className="mt-2 text-xs text-red-700">
          Si el módulo SII no está habilitado todavía, esto es normal. Una vez
          que se carguen las credenciales SII + se aplique la migración SII,
          esta pestaña mostrará F29 + F22 + documentos.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return <p className="py-12 text-center text-sm text-ink-400">Cargando…</p>;
  }

  const hasData =
    (data?.f29?.length ?? 0) > 0 ||
    (data?.f22?.length ?? 0) > 0 ||
    (data?.sii_docs_recent?.length ?? 0) > 0;

  if (!hasData) {
    return (
      <div className="rounded-2xl border border-hairline bg-white p-12 text-center shadow-card">
        <p className="text-sm font-medium text-ink-700">Sin obligaciones tributarias cargadas</p>
        <p className="mt-1 text-xs text-ink-500">
          Cuando se activen las credenciales SII de esta empresa, aquí aparecerán
          F29 mensuales, F22 anuales y documentos electrónicos.
        </p>
        <Link
          href={"/admin/sii" as never}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cehta-green hover:underline"
        >
          Ir a Admin SII
          <ExternalLink className="size-3" />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* F29 */}
      {(data?.f29?.length ?? 0) > 0 && (
        <section className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
          <header className="border-b border-hairline px-6 py-4">
            <h3 className="flex items-center gap-2 text-base font-semibold text-ink-900">
              <Calendar className="size-4" />
              F29 — Declaración mensual IVA
            </h3>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={numeric}>
              <thead className="bg-ink-50/50">
                <tr className="text-[10px] uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3 text-left font-semibold">Período</th>
                  <th className="px-4 py-3 text-left font-semibold">Estado</th>
                  <th className="px-4 py-3 text-left font-semibold">Vence</th>
                  <th className="px-4 py-3 text-right font-semibold">IVA Débito</th>
                  <th className="px-4 py-3 text-right font-semibold">IVA Crédito</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data?.f29?.map((r, i) => (
                  <tr key={i} className="hover:bg-ink-50/40">
                    <td className="px-4 py-2.5 font-medium">{r.periodo}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          r.estado === "declarado"
                            ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700"
                            : "rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700"
                        }
                      >
                        {r.estado}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">{r.fecha_vencimiento ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">
                      {r.monto_iva_debito != null
                        ? fmtClp(Number(r.monto_iva_debito))
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.monto_iva_credito != null
                        ? fmtClp(Number(r.monto_iva_credito))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* F22 */}
      {(data?.f22?.length ?? 0) > 0 && (
        <section className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
          <header className="border-b border-hairline px-6 py-4">
            <h3 className="flex items-center gap-2 text-base font-semibold text-ink-900">
              <FileText className="size-4" />
              F22 — Renta anual
            </h3>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={numeric}>
              <thead className="bg-ink-50/50">
                <tr className="text-[10px] uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3 text-left font-semibold">Año tributario</th>
                  <th className="px-4 py-3 text-left font-semibold">Estado</th>
                  <th className="px-4 py-3 text-right font-semibold">A pagar</th>
                  <th className="px-4 py-3 text-right font-semibold">A devolver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data?.f22?.map((r, i) => (
                  <tr key={i} className="hover:bg-ink-50/40">
                    <td className="px-4 py-2.5 font-medium">{r.ano_tributario}</td>
                    <td className="px-4 py-2.5">{r.estado}</td>
                    <td className="px-4 py-2.5 text-right">
                      {r.monto_a_pagar != null ? fmtClp(Number(r.monto_a_pagar)) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.monto_a_devolver != null
                        ? fmtClp(Number(r.monto_a_devolver))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* SII Docs recientes */}
      {(data?.sii_docs_recent?.length ?? 0) > 0 && (
        <section className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
          <header className="border-b border-hairline px-6 py-4">
            <h3 className="text-base font-semibold text-ink-900">
              Documentos SII recientes (últimos 30 días)
            </h3>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={numeric}>
              <thead className="bg-ink-50/50">
                <tr className="text-[10px] uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3 text-left font-semibold">Tipo DTE</th>
                  <th className="px-4 py-3 text-left font-semibold">Folio</th>
                  <th className="px-4 py-3 text-left font-semibold">Contraparte</th>
                  <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                  <th className="px-4 py-3 text-right font-semibold">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data?.sii_docs_recent?.map((d, i) => (
                  <tr key={i} className="hover:bg-ink-50/40">
                    <td className="px-4 py-2.5">{d.tipo_dte}</td>
                    <td className="px-4 py-2.5">{d.folio}</td>
                    <td className="px-4 py-2.5">
                      {d.emisor_rut ?? d.receptor_rut ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">{d.fecha_emision}</td>
                    <td className="px-4 py-2.5 text-right">
                      {fmtClp(Number(d.monto_total))}
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
