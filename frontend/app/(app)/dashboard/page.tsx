export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Saldos, flujo, IVA y F29 consolidados por empresa del portfolio.
        </p>
      </header>
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          KPIs y gráficos se conectarán al endpoint <code>/api/v1/dashboard</code> en la Fase 2.4.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Según la Disciplina 2, el backend devuelve datos <strong>pre-calculados</strong>; el
          frontend solo renderiza.
        </p>
      </div>
    </div>
  );
}
