"use client";

/**
 * /admin/proyectos/nuevo — Round 102 — Crear proyecto contable
 *
 * Pidio el operador: "otra opción que le aparezca a cada uno donde puede
 * crear los proyectos". Form simple que crea un proyecto contable
 * (sin SQL, sin pedir todo el Bloque E — eso se configura después en
 * /admin/proyectos/[codigo]).
 *
 * Flow:
 *   1. Elige empresa
 *   2. Elige sigla (3 letras) + número correlativo (3 dígitos)
 *      → genera código PRJ-{EMPRESA}-{SIGLA}-{NNN}
 *   3. Nombre descriptivo
 *   4. Tipo financiamiento (default INTERNO)
 *   5. Click Crear → POST /proyectos-contables → redirect a detalle
 *
 * Después puede ir al detalle a configurar % CORFO/P-tec, cuentas, etc.
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, Save } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import type { ProyectoContable } from "@/lib/api/schema";

interface MyEmpresa {
  codigo: string;
  razon_social: string;
  roles: string[];
}

const TIPOS_FIN = [
  { value: "INTERNO", label: "Interno (sin subsidio)" },
  { value: "CORFO", label: "CORFO (subsidio)" },
  { value: "PRIVADO", label: "Privado" },
  { value: "FINANCIERO", label: "Financiero" },
] as const;

export default function ProyectoNuevoPage() {
  const router = useRouter();
  const { session } = useSession();

  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [sigla, setSigla] = useState("OPS"); // 3 letras
  const [correlativo, setCorrelativo] = useState("001");
  const [nombre, setNombre] = useState("");
  const [tipoFin, setTipoFin] = useState<string>("INTERNO");
  const [presupuesto, setPresupuesto] = useState<string>("");

  // Lista empresas que el user tiene acceso
  const { data: empresasData } = useQuery<{ empresas: MyEmpresa[] }>({
    queryKey: ["me", "empresas-proyecto-nuevo"],
    queryFn: () =>
      apiClient.get<{ empresas: MyEmpresa[] }>("/me/empresas", session),
    enabled: !!session,
  });
  const empresas = empresasData?.empresas ?? [];

  // Auto-seleccionar primera empresa
  useEffect(() => {
    if (empresas.length > 0 && !empresaCodigo) {
      const first = empresas[0];
      if (first) setEmpresaCodigo(first.codigo);
    }
  }, [empresas, empresaCodigo]);

  // Sugerir siguiente correlativo basado en proyectos existentes
  const { data: existentes } = useQuery<ProyectoContable[]>({
    queryKey: ["proyectos-existentes", empresaCodigo, sigla],
    queryFn: () =>
      apiClient.get<ProyectoContable[]>(
        `/proyectos-contables?empresa_codigo=${empresaCodigo}`,
        session,
      ),
    enabled: !!session && !!empresaCodigo,
  });

  useEffect(() => {
    if (!existentes) return;
    const pattern = new RegExp(`^PRJ-${empresaCodigo}-${sigla}-(\\d{3})$`);
    const numeros = existentes
      .map((p) => p.codigo.match(pattern)?.[1])
      .filter((n): n is string => !!n)
      .map((n) => parseInt(n, 10));
    const max = numeros.length > 0 ? Math.max(...numeros) : 0;
    const next = (max + 1).toString().padStart(3, "0");
    setCorrelativo(next);
  }, [existentes, empresaCodigo, sigla]);

  const codigoFinal = `PRJ-${empresaCodigo}-${sigla}-${correlativo}`;
  const valid =
    !!empresaCodigo &&
    /^[A-Z]+$/.test(sigla) &&
    sigla.length >= 2 &&
    sigla.length <= 5 &&
    /^\d{3}$/.test(correlativo) &&
    nombre.trim().length >= 2;

  const createMut = useMutation({
    mutationFn: async () => {
      const body = {
        codigo: codigoFinal,
        empresa_codigo: empresaCodigo,
        nombre: nombre.trim(),
        tipo_financiamiento: tipoFin,
        presupuesto_total: presupuesto ? Number(presupuesto) : null,
        moneda: "CLP",
        tipos_gasto_elegibles: ["OPERACION"],
        estado: "ACTIVE",
        aporte_corfo_pct_default: 0,
        aporte_ptec_pct_default: 0,
        aporte_empresa_directa_pct_default: 100,
        bloquear_edicion_pct: false,
      };
      return apiClient.post<ProyectoContable>(
        "/proyectos-contables",
        body,
        session,
      );
    },
    onSuccess: (p) => {
      toast.success(`Proyecto ${p.codigo} creado`);
      router.push(`/admin/proyectos/${p.codigo}` as Route);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo crear el proyecto",
        { duration: 8000 },
      );
    },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <Link
        href={"/admin/proyectos" as Route}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-cehta-green"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al listado
      </Link>

      <div className="relative overflow-hidden rounded-3xl bg-ink-50/40 dark:bg-ink-900 ring-1 ring-hairline p-8 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(rgba(35,108,79,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(35,108,79,0.04) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at top, black 30%, transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-72 w-[600px] rounded-full bg-cehta-green/20 blur-3xl opacity-60"
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-4 py-1.5 ring-1 ring-cehta-green/20">
            <FileText className="size-3.5 text-cehta-green" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Admin · Nuevo proyecto
            </p>
          </div>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight bg-gradient-to-br from-ink-900 via-ink-700 to-cehta-green bg-clip-text text-transparent dark:from-white dark:via-ink-100 dark:to-cehta-green">
            Crear proyecto contable
          </h1>
          <p className="mt-2 text-sm md:text-base text-ink-500 dark:text-ink-400 max-w-2xl">
            Mínimo necesario para que el proyecto aparezca en el dropdown de
            vouchers. Después lo configurás con % Bloque E si aplica.
          </p>
        </div>
      </div>

      <Surface className="p-6 space-y-5">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
            Empresa
          </label>
          <select
            value={empresaCodigo}
            onChange={(e) => setEmpresaCodigo(e.target.value)}
            className="form-input"
          >
            {empresas.length === 0 && (
              <option value="">Cargando empresas...</option>
            )}
            {empresas.map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo} · {e.razon_social}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Sigla del tipo (2-5 letras)
            </label>
            <input
              type="text"
              value={sigla}
              onChange={(e) => setSigla(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5))}
              placeholder="OPS"
              className="form-input font-mono uppercase"
              maxLength={5}
            />
            <p className="mt-1 text-[10px] text-ink-500">
              Ej. <code>OPS</code> (operacional), <code>COR</code> (CORFO),{" "}
              <code>OTR</code> (otros).
            </p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Correlativo
            </label>
            <input
              type="text"
              value={correlativo}
              onChange={(e) =>
                setCorrelativo(e.target.value.replace(/\D/g, "").slice(0, 3).padStart(3, "0"))
              }
              placeholder="001"
              className="form-input font-mono text-right"
              maxLength={3}
            />
            <p className="mt-1 text-[10px] text-ink-500">
              Auto-sugerido según existentes.
            </p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Código final
            </label>
            <input
              type="text"
              value={codigoFinal}
              disabled
              className="form-input font-mono bg-ink-50 text-cehta-green font-semibold"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
            Nombre descriptivo *
          </label>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="ej. BESS Panimavida - Planta de almacenamiento"
            className="form-input"
            maxLength={200}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Tipo financiamiento
            </label>
            <select
              value={tipoFin}
              onChange={(e) => setTipoFin(e.target.value)}
              className="form-input"
            >
              {TIPOS_FIN.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Presupuesto total (opcional)
            </label>
            <input
              type="number"
              min={0}
              value={presupuesto}
              onChange={(e) => setPresupuesto(e.target.value)}
              placeholder="ej. 50000000"
              className="form-input font-mono text-right"
            />
            <p className="mt-1 text-[10px] text-ink-500">
              CLP. Se usa para tracking de ejecución.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-hairline">
          <Link
            href={"/admin/proyectos" as Route}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            Cancelar
          </Link>
          <button
            type="button"
            disabled={!valid || createMut.isPending}
            onClick={() => createMut.mutate()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-5 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {createMut.isPending ? "Creando..." : "Crear proyecto"}
          </button>
        </div>
      </Surface>
    </div>
  );
}
