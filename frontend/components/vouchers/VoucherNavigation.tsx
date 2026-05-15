"use client";

/**
 * VoucherNavigation — Etapa B
 *
 * Navega entre vouchers desde el detail. Llama GET /vouchers/{id}/neighbors
 * que devuelve prev_id y next_id respetando el scope multi-tenant del user.
 * Atajos de teclado:
 *   - [  → voucher anterior
 *   - ]  → voucher siguiente
 *
 * Se renderiza en el header del detalle como botoncitos compactos.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface NeighborsResponse {
  current_id: number;
  prev_id: number | null;
  next_id: number | null;
}

export function VoucherNavigation({ voucherId }: { voucherId: number }) {
  const { session } = useSession();
  const router = useRouter();

  const { data } = useQuery<NeighborsResponse>({
    queryKey: ["voucher-neighbors", voucherId],
    queryFn: () =>
      apiClient.get<NeighborsResponse>(
        `/vouchers/${voucherId}/neighbors`,
        session,
      ),
    enabled: !!session && !!voucherId,
    staleTime: 60_000,
  });

  // Keyboard shortcuts: [ y ] navegan. Evita el activado mientras
  // el user esta tipeando en un input/textarea/contenteditable.
  useEffect(() => {
    if (!data) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "[" && data?.prev_id) {
        e.preventDefault();
        router.push(`/vouchers/${data.prev_id}` as Route);
      } else if (e.key === "]" && data?.next_id) {
        e.preventDefault();
        router.push(`/vouchers/${data.next_id}` as Route);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, router]);

  const hasPrev = !!data?.prev_id;
  const hasNext = !!data?.next_id;

  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-hairline bg-white p-0.5">
      <button
        type="button"
        disabled={!hasPrev}
        onClick={() =>
          data?.prev_id &&
          router.push(`/vouchers/${data.prev_id}` as Route)
        }
        aria-label="Voucher anterior"
        title="Voucher anterior · atajo: ["
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronLeft className="size-3.5" />
        <span className="hidden sm:inline">Anterior</span>
        <kbd className="hidden sm:inline rounded bg-ink-100 px-1 text-[9px] font-mono text-ink-500">
          [
        </kbd>
      </button>
      <div className="h-4 w-px bg-hairline" aria-hidden />
      <button
        type="button"
        disabled={!hasNext}
        onClick={() =>
          data?.next_id &&
          router.push(`/vouchers/${data.next_id}` as Route)
        }
        aria-label="Voucher siguiente"
        title="Voucher siguiente · atajo: ]"
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <span className="hidden sm:inline">Siguiente</span>
        <kbd className="hidden sm:inline rounded bg-ink-100 px-1 text-[9px] font-mono text-ink-500">
          ]
        </kbd>
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}
