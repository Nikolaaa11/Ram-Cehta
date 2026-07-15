"use client";

/**
 * /prevouchers — MEGAPROMPT PREVOUCHER · Cola para especialistas.
 *
 * Muestra los pre-vouchers (vouchers DRAFT) pendientes de procesar en todas
 * las empresas del scope del usuario: quién lo cargó, hace cuántos días,
 * si trae documento adjunto y si la imputación ya cuadra.
 *
 * Flujo del especialista:
 *   1. "Completar" → abre /vouchers/{id}, edita la imputación (líneas).
 *   2. Desde el detalle: "Enviar a aprobación" → entra al flujo de firmas.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  Inbox,
  Loader2,
  Paperclip,
  User as UserIcon,
} from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMyEmpresas } from "@/hooks/use-my-empresas";
import { useSession } from "@/hooks/use-session";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PrevoucherItem {
  voucher_id: number;
  codigo: string;
  empresa_codigo: string;
  tipo: string;
  fecha_documento: string;
  glosa: string;
  total_debit: string;
  moneda: string;
  contraparte_nombre: string | null;
  source: string | null;
  creador_email: string | null;
  dias_esperando: number;
  adjuntos: number;
  lineas: number;
  cuadrado: boolean;
  oc_id: number | null;
  oc_numero: string | null;
}

interface PrevoucherCola {
  items: PrevoucherItem[];
  total: number;
}

interface EmpresaItem {
  codigo: string;
  razon_social?: string | null;
}

function fmtCLP(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString("es-CL")}` : v;
}

export default function PrevouchersPage() {
  const { session } = useSession();
  const [empresa, setEmpresa] = useState("");

  // /me/empresas devuelve { is_admin, empresas[], scope_summary } — NO un
  // array. useMyEmpresas ya lo tipa bien y comparte la misma query key que
  // usa el sidebar, así que reusarlo evita el choque de cache.
  const { data: misEmpresas } = useMyEmpresas();
  const empresas = misEmpresas?.empresas ?? [];
  const qs = empresa ? `?empresa_codigo=${encodeURIComponent(empresa)}` : "";
  const { data, isLoading, isError } = useApiQuery<PrevoucherCola>(
    ["prevouchers", "cola", empresa],
    `/prevouchers/cola${qs}`,
    !!session,
    { refetchInterval: 60_000 },
  );

  const items = useMemo(() => data?.items ?? [], [data]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
            Pre-vouchers
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Gastos reportados por el equipo que esperan imputación contable.
            Tomá uno, completalo y envialo a firmas.
          </p>
        </div>
        <select
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
          className="h-10 rounded-xl border-0 bg-white px-3 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          <option value="">Todas las empresas</option>
          {(empresas ?? []).map((e) => (
            <option key={e.codigo} value={e.codigo}>
              {e.codigo}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink-100/40" />
          ))}
        </div>
      ) : isError ? (
        <Surface>
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-negative">
              No se pudo cargar la cola de pre-vouchers.
            </p>
            <p className="mt-1 text-xs text-ink-500">Reintentá en unos segundos.</p>
          </div>
        </Surface>
      ) : items.length === 0 ? (
        <Surface>
          <div className="px-6 py-14 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-cehta-green/10 ring-1 ring-cehta-green/20">
              <Inbox className="h-5 w-5 text-cehta-green" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-medium text-ink-700">Cola vacía — todo procesado</p>
            <p className="mt-1 text-xs text-ink-500">
              Los pre-vouchers se cargan desde{" "}
              <Link href={{ pathname: "/gastos" }} className="text-cehta-green hover:underline">
                Gastos rápidos
              </Link>{" "}
              (o quedan aquí todos los borradores por completar).
            </p>
          </div>
        </Surface>
      ) : (
        <ul className="space-y-3">
          {items.map((p) => (
            <li key={p.voucher_id}>
              <Surface>
                <div className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cehta-green/10 ring-1 ring-cehta-green/20">
                    <ClipboardList className="h-5 w-5 text-cehta-green" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-ink-900">
                        {p.codigo}
                      </span>
                      <Badge variant="info">{p.empresa_codigo}</Badge>
                      {p.source === "prevoucher" && (
                        <Badge variant="neutral">Gastos rápidos</Badge>
                      )}
                      {p.oc_numero && (
                        <Badge variant="neutral">OC {p.oc_numero}</Badge>
                      )}
                      {p.cuadrado ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-cehta-green">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Cuadrado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                          <AlertTriangle className="h-3.5 w-3.5" /> Falta imputación
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-700">{p.glosa}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-500">
                      {p.creador_email && (
                        <span className="inline-flex items-center gap-1">
                          <UserIcon className="h-3 w-3" /> {p.creador_email}
                        </span>
                      )}
                      <span
                        className={cn(
                          p.dias_esperando >= 5 && "font-semibold text-negative",
                        )}
                      >
                        hace {p.dias_esperando} día{p.dias_esperando !== 1 ? "s" : ""}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="h-3 w-3" />
                        {p.adjuntos > 0
                          ? `${p.adjuntos} adjunto${p.adjuntos !== 1 ? "s" : ""}`
                          : "sin documento"}
                      </span>
                      <span>
                        {p.lineas} línea{p.lineas !== 1 ? "s" : ""}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-base font-semibold tabular-nums text-ink-900">
                      {fmtCLP(p.total_debit)}
                    </span>
                    <Link
                      href={{ pathname: `/vouchers/${p.voucher_id}` }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cehta-green px-4 text-sm font-medium text-white shadow transition-colors hover:bg-cehta-green-700"
                    >
                      <FileText className="h-4 w-4" strokeWidth={1.5} />
                      Completar
                    </Link>
                  </div>
                </div>
              </Surface>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <p className="text-center text-[11px] text-ink-500">
          {isLoading ? (
            <Loader2 className="inline h-3 w-3 animate-spin" />
          ) : (
            <>La cola se actualiza sola cada minuto · {data?.total} pendiente
            {data && data.total !== 1 ? "s" : ""}</>
          )}
        </p>
      )}
    </div>
  );
}
