"use client";

/**
 * /admin/rendiciones-corfo/mapping — Round 152x
 *
 * UI de mapeo en BULK cuenta_local → Cuenta CORFO + Ítem.
 * Una sola vez por empresa: configurás cada cuenta usada en COMPRAS
 * históricas y queda persistido. Las próximas rendiciones salen 100%
 * pre-llenadas.
 */
import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  CircleAlert,
  Search,
  Sparkles,
  Wand2,
} from "lucide-react";

// =========================================================================
// AUTO-SUGERENCIA: fuzzy match nombre cuenta local → CORFO
// =========================================================================
// Mapping basado en keywords que aparecen en planes de cuenta chilenos
// vs los 22 valores de Cuenta CORFO + 14 valores de Ítem.
// Devuelve la mejor sugerencia con un score 0-100 (umbral 35 para sugerir).

const KEYWORD_MAP_CUENTA: Array<[string[], string]> = [
  // [keywords (lowercase, sin acentos), Cuenta CORFO oficial]
  [["honorario", "boleta hon"], "SUBCONTRATOS"],
  [["subcontrat", "subconctra", "asesoria", "consultoria"], "SUBCONTRATOS"],
  [["capacitacion", "training", "curso", "taller"], "CAPACITACION"],
  [["difusion", "marketing", "publicidad", "evento"], "DIFUSIÓN"],
  [["arriendo", "alquiler", "leasing"], "ARRIENDO"],
  [["inversion", "activo fijo", "equipo", "maquinaria"], "GASTOS DE INVERSIÓN"],
  [["administra", "contador", "ofic", "gerencia"], "GASTOS DE ADMINISTRACIÓN"],
  [["servicios bas", "luz", "agua", "internet", "telefon", "electric"], "SERVICIOS BÁSICOS"],
  [["operacion", "insumo", "material", "materiales", "consumible"], "GASTOS DE OPERACIÓN"],
  [["gira", "viaje", "viatic", "movilizacion"], "GIRAS TECNOLÓGICAS"],
  [["patrocin", "sponsor"], "PATROCINADOR"],
  [["impuesto", "iva", "sii", "f29", "f22"], "IMPUESTO"],
  [["transferencia bancaria", "comision banc"], "TRANSFERENCIAS"],
  [["overhead", "indirecto"], "OVERHEAD"],
  [["propiedad intelectual", "patente", "marca registrada"], "PROPIEDAD INTELECTUAL"],
  [["contrato persona juridica", "contrato spa", "contrato ltda"], "CONTRATOS CON PERSONA JURÍDICA"],
  [["constitucion", "notaria", "derecho"], "CONSTITUCIÓN DE DERECHOS"],
  [["reembolso", "rendicion"], "Gastos reembolsables"],
];

const KEYWORD_MAP_ITEM: Array<[string[], string]> = [
  [["laboratorio", "ensayo", "analisis quimic"], "Análisis de laboratorio"],
  [["arriendo prototipo", "espacio prueba"], "Arriendo de espacio prueba de prototipo"],
  [["formulacion proyecto", "elaboracion proyecto"], "Formulación de proyecto"],
  [["garantia", "fianza", "seguro"], "Garantías"],
  [["viaje internacional", "viatico extranjero"], "Gastos de movilización Internacional"],
  [["viaje", "viatico", "movilizacion"], "Gastos de movilización nacional"],
  [["sistema", "integracion", "software", "api"], "Integración de sistema"],
  [["material", "insumo", "consumible"], "Materiales e insumos"],
  [["patente", "marca", "propiedad intelectual"], "Propiedad Intelectual"],
  [["prospeccion", "comercial", "mercado"], "Prospección comercial nacional e internacional"],
  [["ingenieria", "diseño"], "Servicos de Ingeniería"],
  [["taller", "galpon", "bodega"], "Talleres y Galpones"],
  [["transporte", "envio", "logistica"], "Transporte"],
  [["administracion", "contabilidad", "gerencia"], "Servicio de Administración"],
];

function _normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function suggest(cuentaLocal: string, cuentaNombre: string | null): { cuenta: string | null; item: string | null } {
  const txt = _normalize((cuentaNombre || "") + " " + cuentaLocal);
  let bestCuenta: string | null = null;
  let bestCuentaScore = 0;
  for (const [keys, corfoCuenta] of KEYWORD_MAP_CUENTA) {
    for (const k of keys) {
      if (txt.includes(_normalize(k))) {
        const score = k.length; // keyword más larga = match más específico
        if (score > bestCuentaScore) {
          bestCuentaScore = score;
          bestCuenta = corfoCuenta;
        }
      }
    }
  }
  let bestItem: string | null = null;
  let bestItemScore = 0;
  for (const [keys, corfoItem] of KEYWORD_MAP_ITEM) {
    for (const k of keys) {
      if (txt.includes(_normalize(k))) {
        const score = k.length;
        if (score > bestItemScore) {
          bestItemScore = score;
          bestItem = corfoItem;
        }
      }
    }
  }
  return { cuenta: bestCuenta, item: bestItem };
}
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface CuentaUsoRow {
  cuenta_codigo: string;
  cuenta_nombre: string | null;
  uso_count: number;
  monto_acumulado: number;
  corfo_cuenta: string | null;
  corfo_item: string | null;
  corfo_cargo: string | null;
}

interface Catalogos {
  cuenta_gastos: string[];
  cuenta_rrhh: string[];
  item_gastos: string[];
  tipo_doc_gastos: string[];
  tipo_doc_rrhh: string[];
  etapa: string[];
}

const EMPRESAS = ["REVTECH", "TRONGKAI"] as const;
const fmtCLP = (n: number) => n.toLocaleString("es-CL", { maximumFractionDigits: 0 });

export default function MappingBulkPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [empresa, setEmpresa] = useState<(typeof EMPRESAS)[number]>("REVTECH");
  const [filter, setFilter] = useState("");
  const [edits, setEdits] = useState<Record<string, { corfo_cuenta?: string; corfo_item?: string }>>({});
  const [saved, setSaved] = useState(false);

  const { data: cuentas, isLoading } = useQuery<CuentaUsoRow[]>({
    queryKey: ["corfo", "mapping", "full", empresa],
    queryFn: () =>
      apiClient.get<CuentaUsoRow[]>(`/admin/corfo/mapping/${empresa}/full`, session),
    enabled: !!session,
  });

  const { data: cats } = useQuery<Catalogos>({
    queryKey: ["corfo", "catalogos"],
    queryFn: () => apiClient.get<Catalogos>("/admin/corfo/catalogos", session),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });

  // Reset edits cuando cambia empresa
  useEffect(() => {
    setEdits({});
    setSaved(false);
  }, [empresa]);

  const filtered = useMemo(() => {
    if (!cuentas) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return cuentas;
    return cuentas.filter(
      (c) =>
        c.cuenta_codigo.toLowerCase().includes(q) ||
        (c.cuenta_nombre || "").toLowerCase().includes(q) ||
        (c.corfo_cuenta || "").toLowerCase().includes(q),
    );
  }, [cuentas, filter]);

  const stats = useMemo(() => {
    const items = cuentas ?? [];
    const mapeadas = items.filter((c) => c.corfo_cuenta).length;
    return {
      total: items.length,
      mapeadas,
      sin_mapear: items.length - mapeadas,
      pct: items.length > 0 ? Math.round((100 * mapeadas) / items.length) : 0,
    };
  }, [cuentas]);

  // Aplicar edits encima de los datos actuales para mostrar estado en vivo
  const display = useMemo(() => {
    return filtered.map((c) => {
      const e = edits[c.cuenta_codigo];
      return {
        ...c,
        corfo_cuenta: e?.corfo_cuenta ?? c.corfo_cuenta,
        corfo_item: e?.corfo_item ?? c.corfo_item,
      };
    });
  }, [filtered, edits]);

  const pendingEditsCount = Object.keys(edits).length;

  const saveMut = useMutation({
    mutationFn: async () => {
      // Solo enviar los que tienen corfo_cuenta seteada
      const items = Object.entries(edits)
        .filter(([_, v]) => v.corfo_cuenta)
        .map(([cuenta_codigo, v]) => ({
          cuenta_codigo,
          corfo_cuenta: v.corfo_cuenta!,
          corfo_item: v.corfo_item || null,
        }));
      if (items.length === 0) return { saved: 0 };
      return await apiClient.post<{ saved: number }>(
        `/admin/corfo/mapping/${empresa}`,
        { items },
        session,
      );
    },
    onSuccess: () => {
      setEdits({});
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["corfo", "mapping", "full", empresa] });
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Back */}
      <Link
        href={"/admin/rendiciones-corfo" as Route}
        className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-cehta-green"
      >
        <ArrowLeft className="size-4" />
        Volver a Rendiciones CORFO
      </Link>

      {/* Header */}
      <div className="mt-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            Mapeo cuenta_local → CORFO
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Configura UNA vez el mapeo de cada cuenta contable de tu plan al
            catálogo oficial CORFO. Después las rendiciones salen pre-llenadas.
          </p>
        </div>
      </div>

      {/* Selector empresa */}
      <div className="mt-6 flex items-center gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Empresa:
        </label>
        {EMPRESAS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setEmpresa(e)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
              empresa === e
                ? "bg-cehta-green text-white"
                : "bg-ink-50 text-ink-700 hover:bg-ink-100"
            }`}
          >
            {e}
          </button>
        ))}
      </div>

      {/* Stats + Progreso */}
      <div className="mt-6 rounded-2xl border border-hairline bg-white p-5 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Progreso de mapeo · {empresa}
            </p>
            <p className="mt-1 text-2xl font-semibold text-ink-900">
              {stats.mapeadas} de {stats.total} cuentas mapeadas
            </p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-bold text-cehta-green">{stats.pct}%</p>
            {stats.pct === 100 && stats.total > 0 && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-semibold text-emerald-800">
                <CheckCircle2 className="size-3.5" />
                Mapeo completo
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full bg-cehta-green transition-all duration-500"
            style={{ width: `${stats.pct}%` }}
          />
        </div>
      </div>

      {/* Filtro + Auto-sugerir + Save */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar por código, nombre o cuenta CORFO…"
            className="w-full rounded-xl border border-hairline py-2 pl-10 pr-3 text-sm focus:border-cehta-green focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            const newEdits: typeof edits = { ...edits };
            let suggested = 0;
            for (const c of cuentas ?? []) {
              if (c.corfo_cuenta) continue; // ya mapeada, no tocar
              const s = suggest(c.cuenta_codigo, c.cuenta_nombre);
              if (s.cuenta) {
                newEdits[c.cuenta_codigo] = {
                  corfo_cuenta: s.cuenta,
                  corfo_item: s.item ?? undefined,
                };
                suggested++;
              }
            }
            setEdits(newEdits);
          }}
          disabled={!cuentas || cuentas.filter((c) => !c.corfo_cuenta).length === 0}
          className="inline-flex items-center gap-2 rounded-xl border border-cehta-green bg-cehta-green/10 px-4 py-2 text-sm font-semibold text-cehta-green transition-colors hover:bg-cehta-green/20 disabled:cursor-not-allowed disabled:opacity-50"
          title="Sugiere automáticamente Cuenta + Ítem CORFO basado en el nombre de la cuenta local"
        >
          <Wand2 className="size-4" />
          Auto-sugerir mapeo
        </button>
        <button
          type="button"
          onClick={() => saveMut.mutate()}
          disabled={pendingEditsCount === 0 || saveMut.isPending}
          className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cehta-green-700 disabled:cursor-not-allowed disabled:bg-ink-300"
        >
          <Save className="size-4" />
          {saveMut.isPending
            ? "Guardando…"
            : pendingEditsCount > 0
              ? `Guardar ${pendingEditsCount} cambio${pendingEditsCount === 1 ? "" : "s"}`
              : "Sin cambios pendientes"}
        </button>
      </div>

      {/* Toast saved */}
      {saved && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="size-4" />
          Mapeo guardado. Las próximas rendiciones lo usarán automáticamente.
        </div>
      )}

      {/* Tabla */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
        <div className="overflow-x-auto">
          {isLoading ? (
            <p className="py-12 text-center text-sm text-ink-400">
              Cargando cuentas usadas en COMPRAS…
            </p>
          ) : display.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-400">
              {cuentas?.length === 0
                ? "Esta empresa no tiene vouchers COMPRA todavía."
                : "Sin coincidencias con el filtro."}
            </p>
          ) : (
            <table className="w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead className="bg-ink-50/50">
                <tr className="text-[10px] uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3 text-left font-semibold">Cuenta local</th>
                  <th className="px-4 py-3 text-right font-semibold">Uso</th>
                  <th className="px-4 py-3 text-right font-semibold">Monto acum.</th>
                  <th className="px-4 py-3 text-left font-semibold">Cuenta CORFO ▾</th>
                  <th className="px-4 py-3 text-left font-semibold">Ítem CORFO ▾</th>
                  <th className="px-4 py-3 text-center font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {display.map((c) => {
                  const isPending = edits[c.cuenta_codigo] !== undefined;
                  const isMapped = !!c.corfo_cuenta;
                  return (
                    <tr
                      key={c.cuenta_codigo}
                      className={`hover:bg-ink-50/40 ${
                        isPending ? "bg-amber-50/50" : ""
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-xs font-semibold text-ink-900">
                          {c.cuenta_codigo}
                        </div>
                        {c.cuenta_nombre && (
                          <div className="mt-0.5 text-xs text-ink-500">
                            {c.cuenta_nombre}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {c.uso_count}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-ink-500">
                        ${fmtCLP(c.monto_acumulado)}
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={c.corfo_cuenta || ""}
                          onChange={(ev) =>
                            setEdits((prev) => ({
                              ...prev,
                              [c.cuenta_codigo]: {
                                ...prev[c.cuenta_codigo],
                                corfo_cuenta: ev.target.value,
                              },
                            }))
                          }
                          className="w-full rounded-lg border border-hairline px-2 py-1 text-xs focus:border-cehta-green focus:outline-none"
                        >
                          <option value="">— elegir —</option>
                          {cats?.cuenta_gastos.map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={c.corfo_item || ""}
                          onChange={(ev) =>
                            setEdits((prev) => ({
                              ...prev,
                              [c.cuenta_codigo]: {
                                ...prev[c.cuenta_codigo],
                                corfo_item: ev.target.value,
                              },
                            }))
                          }
                          className="w-full rounded-lg border border-hairline px-2 py-1 text-xs focus:border-cehta-green focus:outline-none"
                        >
                          <option value="">— opcional —</option>
                          {cats?.item_gastos.map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {isPending ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            ✏️ Sin guardar
                          </span>
                        ) : isMapped ? (
                          <CheckCircle2 className="mx-auto size-4 text-emerald-600" />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              const s = suggest(c.cuenta_codigo, c.cuenta_nombre);
                              if (s.cuenta) {
                                setEdits((prev) => ({
                                  ...prev,
                                  [c.cuenta_codigo]: {
                                    corfo_cuenta: s.cuenta!,
                                    corfo_item: s.item ?? undefined,
                                  },
                                }));
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-full bg-cehta-green/10 px-2 py-0.5 text-[10px] font-semibold text-cehta-green hover:bg-cehta-green/20"
                            title="Sugerir mapeo automático para esta cuenta"
                          >
                            <Sparkles className="size-3" />
                            Sugerir
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Sticky save button at bottom */}
      {pendingEditsCount > 0 && (
        <div className="sticky bottom-5 mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-cehta-green px-6 py-3 text-sm font-semibold text-white shadow-elevated-lg transition-transform hover:scale-105"
          >
            <Save className="size-4" />
            Guardar {pendingEditsCount} cambio{pendingEditsCount === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {/* Help */}
      <div className="mt-8 rounded-2xl bg-cehta-green/5 px-5 py-4 text-xs text-ink-700">
        <p className="font-semibold text-cehta-green">💡 Tips</p>
        <ul className="mt-2 ml-5 list-disc space-y-1 leading-relaxed">
          <li>
            <strong>Auto-sugerencia</strong>: click en <kbd>Wand2 Auto-sugerir mapeo</kbd> (arriba) o el botón "Sugerir" de cada fila.
            El sistema analiza el nombre de la cuenta local y propone Cuenta + Ítem CORFO basado en keywords (honorarios → SUBCONTRATOS, arriendo → ARRIENDO, etc.). Siempre puedes sobrescribir.
          </li>
          <li>Las cuentas más usadas aparecen primero. Empezá por las 5 más
            frecuentes — eso ya cubre el 80% de las facturas.</li>
          <li><strong>El mapeo es por empresa</strong>: REVTECH y TRONGKAI tienen mapeos independientes.</li>
          <li>Los cambios solo persisten cuando haces clic en <strong>Guardar N cambios</strong>.</li>
        </ul>
      </div>
    </div>
  );
}
