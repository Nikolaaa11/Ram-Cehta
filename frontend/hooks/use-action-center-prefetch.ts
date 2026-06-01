"use client";

/**
 * useActionCenterPrefetch — calienta el cache de /calendar/obligations al
 * hacer hover sobre el item "Action Center" del sidebar (R152iii).
 *
 * La query carga las obligaciones de los próximos 90 días + cruza con
 * vouchers/transferencias. Es costosa en cierre de mes.
 */
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { format, addDays } from "date-fns";

export function useActionCenterPrefetch() {
  const qc = useQueryClient();
  const { session } = useSession();

  return () => {
    if (!session) return;
    const today = new Date();
    const params = new URLSearchParams({
      from_date: format(today, "yyyy-MM-dd"),
      to_date: format(addDays(today, 90), "yyyy-MM-dd"),
    });
    qc.prefetchQuery({
      queryKey: ["calendar-obligations", params.toString()],
      queryFn: () =>
        apiClient.get(`/calendar/obligations?${params.toString()}`, session),
      staleTime: 60_000,
    });
  };
}
