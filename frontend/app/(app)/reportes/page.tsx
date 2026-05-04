/**
 * /reportes — landing rediseñada (Apple-tier).
 *
 * Decisiones de diseño:
 *  - Hero editorial con eyebrow + display heading + soft gradient mesh.
 *  - 4 reportes presentados como cards numeradas con jerarquía clara.
 *  - Section "Cómo se generan" abajo — confianza editorial.
 *  - Footer con signature Cehta + timestamp del último ETL.
 *  - Print-friendly: oculta nav y mantiene grid responsive.
 *
 * Server Component — cada subruta hace su propio fetch.
 */
import {
  FileBarChart,
  FileText,
  PieChart,
  ScrollText,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { ReporteCard } from "@/components/reportes/ReporteCard";

export const metadata = {
  title: "Reportes — Cehta Capital",
  description:
    "Reportes formales para inversionistas, comité y auditoría. Datos consolidados en tiempo real.",
};

export default function ReportesPage() {
  return (
    <div className="relative">
      {/* Gradient mesh decorativo — Apple-tier subtle */}
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
        {/* Hero editorial */}
        <header className="max-w-3xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
            Reportes formales · FIP CEHTA ESG
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-ink-900 sm:text-[44px] sm:leading-[1.05]">
            Documentos para inversionistas,
            <br className="hidden sm:block" />
            <span className="text-ink-500">comité y auditoría.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink-600 sm:text-base">
            Seis reportes consolidados a partir de la base contable
            integrada. Generados en tiempo real, exportables a PDF, con la
            marca y los criterios formales de Cehta Capital.
          </p>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-[11px] font-medium text-ink-600 ring-1 ring-hairline backdrop-blur-sm">
            <Sparkles
              className="h-3.5 w-3.5 text-cehta-green"
              strokeWidth={1.75}
            />
            Datos sincronizados desde la base operativa
          </div>
        </header>

        {/* Grid de 6 reportes */}
        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          <ReporteCard
            number="01"
            icon={<TrendingUp className="h-5 w-5" strokeWidth={1.5} />}
            title="Estado del Fondo"
            description="AUM consolidado, NAV por período y trazabilidad del último ETL contable."
            href="/reportes/fondo"
            accent="cehta-green"
          />
          <ReporteCard
            number="02"
            icon={<PieChart className="h-5 w-5" strokeWidth={1.5} />}
            title="Composición del Portafolio"
            description="Distribución entre las empresas operativas con KPIs clave por compañía."
            href="/reportes/portafolio"
            accent="sf-blue"
          />
          <ReporteCard
            number="03"
            icon={<Users className="h-5 w-5" strokeWidth={1.5} />}
            title="Suscripciones de Acciones"
            description="Acciones FIP CEHTA ESG suscritas con totales en CLP y UF, por LP."
            href="/reportes/suscripciones"
            accent="sf-purple"
          />
          <ReporteCard
            number="04"
            icon={<FileText className="h-5 w-5" strokeWidth={1.5} />}
            title="Compliance Tributario"
            description="F29 por empresa con vencimientos, estados de pago y comprobantes."
            href="/reportes/tributario"
            accent="sf-teal"
          />
          <ReporteCard
            number="05"
            icon={<ScrollText className="h-5 w-5" strokeWidth={1.5} />}
            title="Actas del Fondo"
            description="Directorio AFIS, Comités y Asambleas de LPs con quórum y acuerdos votados."
            href="/reportes/actas"
            accent="sf-purple"
          />
          <ReporteCard
            number="06"
            icon={<FileBarChart className="h-5 w-5" strokeWidth={1.5} />}
            title="Estados Financieros"
            description="Balance, Estado de Resultados y Flujo de Caja por empresa, con auditoría."
            href="/reportes/eeff"
            accent="sf-teal"
          />
        </div>

        {/* Section: cómo se generan — editorial trust */}
        <section className="mt-24 grid grid-cols-1 gap-10 border-t border-hairline pt-14 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-500">
              Cómo se generan
            </p>
            <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink-900">
              Datos vivos,
              <br />
              criterios formales.
            </h2>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <Pillar
              title="Una sola fuente de verdad"
              body="Cada reporte hace fetch directo de la base operativa consolidada. No hay copias intermedias ni planillas paralelas — el número que ves es el número que está en producción."
            />
            <Pillar
              title="Snapshot al momento de imprimir"
              body="Cada PDF queda firmado con la fecha y hora del último ETL contable que lo alimentó. Si Auditoría pregunta, hay timestamp."
            />
            <Pillar
              title="Cifras en CLP y UF"
              body="Conversión a UF al tipo de cambio del cierre del período correspondiente, no del día de generación. Coherente con normativa CMF."
            />
          </div>
        </section>

        {/* Signature Cehta */}
        <footer className="mt-20 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-6 text-[11px] text-ink-400">
          <span>
            © Cehta Capital · FIP CEHTA ESG · Documento interno confidencial
          </span>
          <span className="font-mono">v5.{new Date().getFullYear() % 100}</span>
        </footer>
      </div>
    </div>
  );
}

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-l-2 border-cehta-green/30 pl-5">
      <h3 className="font-display text-base font-semibold tracking-tight text-ink-900">
        {title}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{body}</p>
    </div>
  );
}
