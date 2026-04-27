import { Surface } from "@/components/ui/surface";
import { LineChart, PieChart, BarChart3, Activity } from "lucide-react";

interface PlaceholderProps {
  title: string;
  description: string;
  Icon: typeof LineChart;
  height?: string;
}

function Placeholder({ title, description, Icon, height = "h-80" }: PlaceholderProps) {
  return (
    <Surface className={`flex flex-col ${height}`}>
      <Surface.Header divider>
        <Surface.Title>{title}</Surface.Title>
        <Surface.Subtitle>{description}</Surface.Subtitle>
      </Surface.Header>
      <Surface.Body className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/40">
          <Icon className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
        </div>
        <p className="text-sm text-ink-500">Próximamente</p>
      </Surface.Body>
    </Surface>
  );
}

/**
 * Placeholders dimensionalmente correctos para los charts de Phase 4-7.
 * Reservan el espacio para evitar layout shift cuando lleguen los componentes
 * reales.
 */
export function ChartsPlaceholder() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Placeholder
            title="Cashflow"
            description="Real vs. proyectado por mes"
            Icon={LineChart}
          />
        </div>
        <Placeholder
          title="Egresos por concepto"
          description="Distribución del mes actual"
          Icon={PieChart}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Placeholder
          title="Saldos por empresa"
          description="Cehta + CORFO al cierre"
          Icon={BarChart3}
        />
        <Placeholder
          title="Carga de IVA"
          description="Últimos 12 períodos"
          Icon={Activity}
        />
        <Placeholder
          title="Top proyectos"
          description="Por egreso del período"
          Icon={BarChart3}
        />
      </div>
      <Placeholder
        title="Movimientos recientes"
        description="Últimas operaciones"
        Icon={LineChart}
        height="h-96"
      />
    </div>
  );
}
