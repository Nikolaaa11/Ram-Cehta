"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";
import { EgresosProyectoCard } from "./EgresosProyectoCard";
import type { EgresoProyectoItem } from "@/lib/api/schema";

/**
 * Wrapper client-side del treemap de Egresos por Proyecto. Maneja el
 * toggle "Incluir Oficina y Reversa" — el backend acepta el flag
 * `include_default_excluded` y devuelve la data ya filtrada.
 */
export function EgresosProyectoSection({
  empresaCodigo,
  initialData,
}: {
  empresaCodigo: string;
  initialData: EgresoProyectoItem[];
}) {
  const { session, loading: sessionLoading } = useSession();
  const [showAll, setShowAll] = React.useState(false);

  const query = useQuery<EgresoProyectoItem[], Error>({
    queryKey: ["empresa", empresaCodigo, "egresos-por-proyecto", { showAll }],
    queryFn: () =>
      apiClient.get<EgresoProyectoItem[]>(
        `/empresa/${empresaCodigo}/egresos-por-proyecto${
          showAll ? "?include_default_excluded=true" : ""
        }`,
        session,
      ),
    enabled: !sessionLoading && !!session,
    staleTime: 60_000,
    initialData: showAll ? undefined : initialData,
  });

  const data = query.data ?? [];

  return (
    <EgresosProyectoCard
      data={data}
      showAll={showAll}
      onToggleShowAll={setShowAll}
    />
  );
}
