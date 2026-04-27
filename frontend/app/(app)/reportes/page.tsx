/**
 * Reportes — landing.
 *
 * Server Component. Renderiza 4 tarjetas hacia los reportes formales para
 * inversionistas. Cada subruta se hace cargo de su data fetching.
 */
import { TrendingUp, PieChart, Users, FileText } from "lucide-react";
import { ReporteCard } from "@/components/reportes/ReporteCard";

export const metadata = {
  title: "Reportes — Cehta Capital",
  description: "Reportes formales para inversionistas, comité y auditoría.",
};

export default function ReportesPage() {
  return (
    <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
          Reportes
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Genera reportes formales para inversionistas, comité y auditoría.
          Todos los documentos llevan la marca Cehta Capital y se generan en
          tiempo real desde la base contable consolidada.
        </p>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <ReporteCard
          icon={<TrendingUp className="h-5 w-5" strokeWidth={1.5} />}
          title="Estado del Fondo"
          description="AUM consolidado, NAV por período y trazabilidad del último ETL contable."
          href="/reportes/fondo"
          accent="cehta-green"
        />
        <ReporteCard
          icon={<PieChart className="h-5 w-5" strokeWidth={1.5} />}
          title="Composición del Portafolio"
          description="Distribución entre las 9 empresas con KPIs operativos por compañía."
          href="/reportes/portafolio"
          accent="sf-blue"
        />
        <ReporteCard
          icon={<Users className="h-5 w-5" strokeWidth={1.5} />}
          title="Suscripciones de Acciones"
          description="Acciones FIP CEHTA ESG suscritas con totales en CLP y UF."
          href="/reportes/suscripciones"
          accent="sf-purple"
        />
        <ReporteCard
          icon={<FileText className="h-5 w-5" strokeWidth={1.5} />}
          title="Compliance Tributario"
          description="F29 por empresa con vencimientos, estados de pago y comprobantes."
          href="/reportes/tributario"
          accent="sf-teal"
        />
      </div>
    </div>
  );
}
