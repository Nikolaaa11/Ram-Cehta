"use client";

/**
 * SeedVouchersDemoButton — crea vouchers de prueba en distintos
 * estados para que el dashboard CEO + KPIs muestren datos sin tener
 * que crear vouchers manualmente.
 *
 * 2 acciones:
 *   - Generar (con selector de empresa + cantidad)
 *   - Limpiar (borra todos los vouchers con glosa que empieza con [DEMO])
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Trash2, X } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";

interface Empresa {
  codigo: string;
  razon_social: string;
}

interface SeedResponse {
  empresa_codigo: string;
  vouchers_creados: number;
  por_estado: Record<string, number>;
  cuentas_usadas: Record<string, string>;
  nota: string;
}

interface CleanupResponse {
  vouchers_eliminados: number;
  lines_eliminadas: number;
}

export function SeedVouchersDemoButton() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [showSeed, setShowSeed] = useState(false);

  const cleanupMut = useMutation({
    mutationFn: async () =>
      apiClient.post<CleanupResponse>(
        "/admin/vouchers-demo/cleanup",
        {},
        session,
      ),
    onSuccess: (r) => {
      toast.success(
        r.vouchers_eliminados > 0
          ? `${r.vouchers_eliminados} vouchers demo eliminados (${r.lines_eliminadas} líneas)`
          : "No había vouchers demo para limpiar",
      );
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["vouchers-kpis"] });
      qc.invalidateQueries({ queryKey: ["conciliacion-summary"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error", {
        duration: 8000,
      });
    },
  });

  return (
    <>
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => setShowSeed(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs font-semibold text-yellow-800 hover:bg-yellow-100"
          title="Crear vouchers de ejemplo en distintos estados"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
          Demo: vouchers
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                "¿Borrar todos los vouchers demo? Borra cualquier voucher cuya glosa empieza con [DEMO].",
              )
            ) {
              cleanupMut.mutate();
            }
          }}
          disabled={cleanupMut.isPending}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-white text-ink-400 hover:border-negative/30 hover:text-negative disabled:opacity-60"
          title="Limpiar vouchers demo"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {showSeed && (
        <SeedDialog
          onClose={() => setShowSeed(false)}
          onCreated={() => {
            setShowSeed(false);
            qc.invalidateQueries({ queryKey: ["vouchers"] });
            qc.invalidateQueries({ queryKey: ["vouchers-kpis"] });
            qc.invalidateQueries({ queryKey: ["conciliacion-summary"] });
          }}
        />
      )}
    </>
  );
}

function SeedDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { session } = useSession();
  const [empresa, setEmpresa] = useState("");
  const [cantidad, setCantidad] = useState(8);
  const [loading, setLoading] = useState(false);

  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
  });

  // Auto-set primera empresa
  if (!empresa && empresas && empresas.length > 0) {
    setEmpresa(empresas[0]!.codigo);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !empresa) return;
    setLoading(true);
    try {
      const r = await apiClient.post<SeedResponse>(
        "/admin/vouchers-demo/seed",
        { empresa_codigo: empresa, cantidad },
        session,
      );
      const breakdown = Object.entries(r.por_estado)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ");
      toast.success(
        `${r.vouchers_creados} vouchers demo creados en ${r.empresa_codigo}`,
        {
          description: breakdown,
          duration: 8000,
        },
      );
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Error", {
        duration: 8000,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-600 hover:bg-ink-200"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
        <div>
          <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-yellow-800">
            <Sparkles className="h-3 w-3" strokeWidth={2.25} />
            Vouchers de demo
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold tracking-tight">
            Generar vouchers de prueba
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            Crea vouchers EGRESO en distintos estados (DRAFT, PENDING, APPROVED,
            EXECUTED, RECONCILED, REJECTED) con líneas debe/haber cuadradas.
            Usa cuentas, proyectos y áreas reales de la empresa.
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 text-[11px] text-amber-800">
          <strong className="font-semibold">Pre-requisitos:</strong> el plan de
          cuentas y al menos un proyecto deben estar cargados para esta
          empresa. Si no los tenés, importá el Excel primero.
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Empresa <span className="text-negative">*</span>
          </label>
          <select
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
            required
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            {(empresas ?? []).map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo} — {e.razon_social}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Cantidad de vouchers
          </label>
          <input
            type="number"
            min={1}
            max={30}
            value={cantidad}
            onChange={(e) => setCantidad(Number(e.target.value))}
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
          <p className="mt-1 text-[10px] italic text-ink-400">
            Distribuidos entre todos los estados (mínimo 1 de cada).
          </p>
        </div>

        <button
          type="submit"
          disabled={loading || !empresa}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
        >
          <Sparkles
            className={`h-4 w-4 ${loading ? "animate-pulse" : ""}`}
            strokeWidth={1.75}
          />
          {loading ? "Generando…" : `Generar ${cantidad} vouchers demo`}
        </button>
      </form>
    </div>
  );
}
