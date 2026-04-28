import Link from "next/link";
import { ArrowRight, Users, Scale, Target, Sparkles } from "lucide-react";
import type { Route } from "next";
import { Surface } from "@/components/ui/surface";

/**
 * Resumen de la empresa — landing al entrar a /empresa/[codigo]/.
 *
 * V3 fase 2: muestra navegación rápida a sub-secciones. En fase 3 se
 * carga con KPIs reales (saldos por empresa, OCs pendientes, etc.) que
 * ya provee `/dashboard/saldos-por-empresa` y endpoints relacionados.
 */
export default async function EmpresaResumenPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;

  const quickLinks = [
    {
      href: `/empresa/${codigo}/trabajadores` as Route,
      icon: Users,
      title: "Trabajadores",
      description:
        "Gestión de empleados, contratos, anexos y documentos personales",
      cta: "Ver equipo",
    },
    {
      href: `/empresa/${codigo}/legal` as Route,
      icon: Scale,
      title: "Legal",
      description:
        "Contratos, actas, declaraciones SII, permisos y certificaciones",
      cta: "Ver documentos",
    },
    {
      href: `/empresa/${codigo}/avance` as Route,
      icon: Target,
      title: "Avance",
      description: "Roadmap, hitos, KPIs operativos y reportes semanales",
      cta: "Ver proyectos",
    },
    {
      href: `/empresa/${codigo}/asistente` as Route,
      icon: Sparkles,
      title: "AI Asistente",
      description: "Pregunta cualquier cosa sobre la empresa con contexto IA",
      cta: "Abrir chat",
    },
  ];

  return (
    <div className="space-y-6">
      <Surface variant="glass">
        <Surface.Header>
          <Surface.Title>Resumen de {codigo}</Surface.Title>
          <Surface.Subtitle>
            KPIs consolidados, actividad reciente e información general.
          </Surface.Subtitle>
        </Surface.Header>
        <Surface.Body>
          <p className="text-sm text-ink-500">
            Los KPIs operativos (saldos, OCs pendientes, F29 vencidas) se
            consolidan en V3 fase 3. Por ahora podés navegar a las
            sub-secciones desde acá o desde las tabs de arriba.
          </p>
        </Surface.Body>
      </Surface>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {quickLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href} className="group">
              <Surface variant="interactive" className="h-full">
                <div className="flex items-start gap-4">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
                    <Icon className="h-5 w-5" strokeWidth={1.5} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-display font-semibold tracking-tight text-ink-900">
                      {link.title}
                    </h3>
                    <p className="mt-1 text-sm text-ink-500">
                      {link.description}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cehta-green opacity-80 transition-opacity duration-150 ease-apple group-hover:opacity-100">
                      {link.cta}
                      <ArrowRight
                        className="h-3.5 w-3.5"
                        strokeWidth={2}
                      />
                    </span>
                  </div>
                </div>
              </Surface>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
