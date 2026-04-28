"use client";

import { use, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Inbox, AlertTriangle, GanttChartSquare } from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMe } from "@/hooks/use-me";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { ProyectoCard } from "@/components/avance/ProyectoCard";
import { RiesgoTable } from "@/components/avance/RiesgoTable";
import { CrearProyectoDialog } from "@/components/avance/CrearProyectoDialog";
import { CrearHitoDialog } from "@/components/avance/CrearHitoDialog";
import { CrearRiesgoDialog } from "@/components/avance/CrearRiesgoDialog";
import { cn } from "@/lib/utils";
import type { ProyectoListItem, RiesgoRead } from "@/lib/api/schema";

const SEVERIDAD_ITEMS: ComboboxItem[] = [
  { value: "", label: "Todas las severidades" },
  { value: "alta", label: "Alta" },
  { value: "media", label: "Media" },
  { value: "baja", label: "Baja" },
];

type Tab = "proyectos" | "riesgos";

export default function EmpresaAvancePage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canEdit = me?.allowed_actions?.includes("avance:update") ?? false;
  const canCreate = me?.allowed_actions?.includes("avance:create") ?? false;

  const [tab, setTab] = useState<Tab>("proyectos");
  const [proyectoOpen, setProyectoOpen] = useState(false);
  const [riesgoOpen, setRiesgoOpen] = useState(false);
  const [hitoTarget, setHitoTarget] = useState<number | null>(null);
  const [severidad, setSeveridad] = useState<string>("");

  const proyectosQ = useApiQuery<ProyectoListItem[]>(
    ["avance", codigo, "proyectos"],
    `/avance/${codigo}/proyectos`,
  );

  const riesgosPath = severidad
    ? `/avance/${codigo}/riesgos?severidad=${severidad}`
    : `/avance/${codigo}/riesgos`;

  const riesgosQ = useApiQuery<RiesgoRead[]>(
    ["avance", codigo, "riesgos", severidad],
    riesgosPath,
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ["avance", codigo] });

  const proyectos = proyectosQ.data ?? [];
  const riesgos = riesgosQ.data ?? [];

  return (
    <div className="space-y-6">
      <Surface>
        <Surface.Header>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Surface.Title>Avance · {codigo}</Surface.Title>
              <Surface.Subtitle>
                {proyectos.length}{" "}
                {proyectos.length === 1 ? "proyecto activo" : "proyectos activos"}
                {" · "}
                {riesgos.length}{" "}
                {riesgos.length === 1 ? "riesgo registrado" : "riesgos registrados"}
              </Surface.Subtitle>
            </div>
            {canCreate && (
              <div className="flex items-center gap-2">
                {tab === "proyectos" ? (
                  <button
                    type="button"
                    onClick={() => setProyectoOpen(true)}
                    className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2} />
                    Nuevo proyecto
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRiesgoOpen(true)}
                    className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2} />
                    Nuevo riesgo
                  </button>
                )}
              </div>
            )}
          </div>
        </Surface.Header>

        <div className="mt-4 inline-flex items-center gap-1 rounded-xl bg-ink-100/40 p-1">
          <TabButton
            active={tab === "proyectos"}
            onClick={() => setTab("proyectos")}
            Icon={GanttChartSquare}
            label="Proyectos"
            count={proyectos.length}
          />
          <TabButton
            active={tab === "riesgos"}
            onClick={() => setTab("riesgos")}
            Icon={AlertTriangle}
            label="Riesgos"
            count={riesgos.length}
          />
        </div>
      </Surface>

      {tab === "proyectos" && (
        <>
          {proyectosQ.isLoading && (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-32 w-full rounded-2xl" />
              ))}
            </div>
          )}

          {!proyectosQ.isLoading && proyectos.length === 0 && (
            <Surface className="text-center">
              <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60 text-ink-500">
                <Inbox className="h-6 w-6" strokeWidth={1.5} />
              </span>
              <p className="mt-3 text-base font-medium text-ink-900">
                Sin proyectos
              </p>
              <p className="mt-1 text-sm text-ink-500">
                {canCreate
                  ? "Creá el primer proyecto con + Nuevo proyecto."
                  : "Pedile a un admin que registre el roadmap de esta empresa."}
              </p>
            </Surface>
          )}

          {!proyectosQ.isLoading &&
            proyectos.map((p) => (
              <ProyectoCard
                key={p.proyecto_id}
                proyecto={p}
                empresaCodigo={codigo}
                canEdit={canEdit}
                onAddHito={(pid) => setHitoTarget(pid)}
              />
            ))}
        </>
      )}

      {tab === "riesgos" && (
        <>
          <div className="flex items-center gap-3">
            <Combobox
              items={SEVERIDAD_ITEMS}
              value={severidad}
              onValueChange={setSeveridad}
              placeholder="Severidad"
              triggerClassName="min-w-[200px]"
            />
          </div>

          {riesgosQ.isLoading ? (
            <Skeleton className="h-32 w-full rounded-2xl" />
          ) : (
            <RiesgoTable riesgos={riesgos} />
          )}
        </>
      )}

      <CrearProyectoDialog
        open={proyectoOpen}
        onOpenChange={setProyectoOpen}
        empresaCodigo={codigo}
        onCreated={refresh}
      />
      <CrearRiesgoDialog
        open={riesgoOpen}
        onOpenChange={setRiesgoOpen}
        empresaCodigo={codigo}
        onCreated={refresh}
      />
      <CrearHitoDialog
        open={hitoTarget !== null}
        onOpenChange={(o) => !o && setHitoTarget(null)}
        proyectoId={hitoTarget}
        onCreated={refresh}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150",
        active
          ? "bg-white text-ink-900 shadow-card"
          : "text-ink-500 hover:text-ink-700",
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
      {label}
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs",
          active ? "bg-cehta-green/10 text-cehta-green" : "bg-ink-100/60 text-ink-500",
        )}
      >
        {count}
      </span>
    </button>
  );
}
