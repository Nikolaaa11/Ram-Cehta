/**
 * /reportes/contables — landing de los 5 reportes formales.
 *
 * Server Component. Apple-tier editorial — mismo lenguaje visual que
 * /reportes con cards numeradas y mesh gradient sutil.
 */
import {
  Banknote,
  BookOpen,
  CalendarCheck,
  CircleDollarSign,
  FileBarChart,
  FileText,
  Layers,
  LineChart,
  Scale,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { ReporteCard } from "@/components/reportes/ReporteCard";

export const metadata = {
  title: "Reportes contables — Cehta Capital",
  description:
    "Libro Diario, Libro Mayor, P&L por proyecto y área, rendición CORFO.",
};

export default function ReportesContablesPage() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] overflow-hidden"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 0%, rgba(35,108,79,0.06) 0%, transparent 60%)," +
            "radial-gradient(40% 40% at 85% 10%, rgba(212,175,55,0.05) 0%, transparent 70%)",
        }}
      />

      <div className="mx-auto max-w-[1280px] px-6 lg:px-10 pt-16 pb-24">
        <header className="max-w-3xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
            Reportes contables formales · V5
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-ink-900 sm:text-[44px] sm:leading-[1.05]">
            Libro Diario, Mayor
            <br className="hidden sm:block" />
            <span className="text-ink-500">y P&L cross-dimensional.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink-600 sm:text-base">
            Consolidación de vouchers en formato contable estándar chileno.
            Solo asientos APPROVED+ entran a los reportes — DRAFT, PENDING,
            REJECTED y VOID quedan fuera por diseño. Imprimibles a PDF con
            print:hidden en filtros y acciones.
          </p>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-[11px] font-medium text-ink-600 ring-1 ring-hairline backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5 text-cehta-green" strokeWidth={1.75} />
            Imputación triple cuenta × proyecto × área en cada línea
          </div>
        </header>

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          <ReporteCard
            number="01"
            icon={<BookOpen className="h-5 w-5" strokeWidth={1.5} />}
            title="Libro Diario"
            description="Cronología completa de asientos contables del período. Una fila por línea con cuenta, proyecto y área."
            href="/reportes/contables/libro-diario"
            accent="cehta-green"
          />
          <ReporteCard
            number="02"
            icon={<Wallet className="h-5 w-5" strokeWidth={1.5} />}
            title="Libro Mayor"
            description="Saldo de apertura, movimientos del período y saldo de cierre por cuenta."
            href="/reportes/contables/libro-mayor"
            accent="sf-blue"
          />
          <ReporteCard
            number="03"
            icon={<CircleDollarSign className="h-5 w-5" strokeWidth={1.5} />}
            title="P&L por Proyecto"
            description="Ingresos vs gastos agrupados por código PRJ-EMP-TIPO-NNN. Base para rendiciones."
            href="/reportes/contables/pl-proyecto"
            accent="sf-purple"
          />
          <ReporteCard
            number="04"
            icon={<Layers className="h-5 w-5" strokeWidth={1.5} />}
            title="P&L por Área"
            description="Ingresos vs gastos por centro de costo (ADM, COM, OPE, ING, IDI, LEG, RRH, TIC, EJE, FIN)."
            href="/reportes/contables/pl-area"
            accent="sf-teal"
          />
          <ReporteCard
            number="05"
            icon={<FileBarChart className="h-5 w-5" strokeWidth={1.5} />}
            title="Rendición CORFO"
            description="Desglose por tipo de gasto (RRHH/OPERACION/INVERSION/GG) para un proyecto CORFO específico."
            href="/reportes/contables/rendicion-corfo"
            accent="sf-purple"
          />
          <ReporteCard
            number="06"
            icon={<Scale className="h-5 w-5" strokeWidth={1.5} />}
            title="Balance de Prueba"
            description="Saldos por cuenta agrupados (PDF directo) — verifica Σdebe = Σhaber del período."
            href="/reportes/contables/balance-prueba"
            accent="sf-blue"
            badge="V5++"
          />
          <ReporteCard
            number="07"
            icon={<CalendarCheck className="h-5 w-5" strokeWidth={1.5} />}
            title="Cierre Mensual"
            description="Checklist + KPIs: vouchers pendientes/firmados, F29, cartolas, movimientos. Hoja de ruta para cerrar el mes."
            href="/reportes/contables/cierre-mensual"
            accent="cehta-green"
            badge="V5++"
          />
          <ReporteCard
            number="08"
            icon={<LineChart className="h-5 w-5" strokeWidth={1.5} />}
            title="Cashflow Mensual"
            description="Entradas vs salidas mes a mes del año + saldo acumulado corriente. Útil para detectar meses negativos."
            href="/reportes/contables/cashflow-mensual"
            accent="sf-teal"
            badge="V5++"
          />
          <ReporteCard
            number="09"
            icon={<TrendingUp className="h-5 w-5" strokeWidth={1.5} />}
            title="P&L Mensual"
            description="Ingresos (4-*) vs Gastos (5-*) mes a mes del año + margen porcentual + mejor/peor mes."
            href="/reportes/contables/pl-mensual"
            accent="cehta-green"
            badge="V5++"
          />
          <ReporteCard
            number="10"
            icon={<FileText className="h-5 w-5" strokeWidth={1.5} />}
            title="Estado de Resultados"
            description="ER anual jerárquico con cuentas (4-* y 5-*). Resultado del ejercicio + margen. Formato chileno formal — útil para SII/F22."
            href="/reportes/contables/estado-resultados"
            accent="sf-blue"
            badge="V5++"
          />
          <ReporteCard
            number="11"
            icon={<Banknote className="h-5 w-5" strokeWidth={1.5} />}
            title="Balance General"
            description="Activo / Pasivo / Patrimonio a fecha de corte. Verifica ecuación contable. Saldos acumulados desde inicio."
            href="/reportes/contables/balance-general"
            accent="sf-purple"
            badge="V5++"
          />
          <ReporteCard
            number="12"
            icon={<BookOpen className="h-5 w-5" strokeWidth={1.5} />}
            title="Consolidado del Fondo"
            description="Agregado de las 9 empresas portfolio FIP CEHTA: Ingresos/Gastos/Resultado por empresa + totales + Top 3 contribuyentes."
            href="/reportes/contables/consolidado-fondo"
            accent="cehta-green"
            badge="V5++"
          />
        </div>

        <footer className="mt-20 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-6 text-[11px] text-ink-400">
          <span>
            © Cehta Capital · Reportes contables formales · Solo vouchers APPROVED+
          </span>
          <span className="font-mono">
            v5.{new Date().getFullYear() % 100}
          </span>
        </footer>
      </div>
    </div>
  );
}
