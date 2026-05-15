"use client";

/**
 * usePullToRefresh — Etapa C mobile UX
 *
 * Permite refrescar la pagina con un swipe hacia abajo desde el top (gesto
 * nativo en apps mobile). Solo se activa cuando el user esta tocando un
 * touchscreen (skip en desktop) y el scroll esta en top — asi no
 * interfiere con scroll interno normal.
 *
 * Uso:
 *   const { isRefreshing, pullDistance, isPulling } = usePullToRefresh(
 *     async () => { await refetch(); }
 *   );
 *
 *   {isPulling && <PullIndicator distance={pullDistance} />}
 *
 * Constantes:
 *   - THRESHOLD = 70px → distancia que el user tiene que pullar para que
 *     se dispare el refresh al soltar.
 *   - MAX_PULL = 120px → distancia maxima (resistencia visual).
 *
 * Notas tecnicas:
 *   - Solo activo si window.scrollY === 0 (top de la pagina).
 *   - touch-action: pan-y en body permite scroll vertical pero captura
 *     el gesto cuando estamos en top.
 *   - No hace e.preventDefault del touch para no romper scroll normal —
 *     solo trackea el delta cuando aplica.
 *   - Se cancela si el user vuelve a scrollear o si suelta antes del
 *     threshold.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const THRESHOLD = 70;
const MAX_PULL = 120;

interface PullState {
  isPulling: boolean;
  isRefreshing: boolean;
  pullDistance: number;
}

export function usePullToRefresh(
  onRefresh: () => Promise<void> | void,
  options: { enabled?: boolean } = {},
): PullState {
  const { enabled = true } = options;
  const [state, setState] = useState<PullState>({
    isPulling: false,
    isRefreshing: false,
    pullDistance: 0,
  });
  const startY = useRef<number | null>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled) return;
      // Solo si estamos al top del scroll
      if (window.scrollY > 0) return;
      const touch = e.touches[0];
      if (!touch) return;
      startY.current = touch.clientY;
    },
    [enabled],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!enabled || startY.current === null) return;
      if (window.scrollY > 0) {
        // User volvio a scrollear, abortar
        startY.current = null;
        setState((s) => ({ ...s, isPulling: false, pullDistance: 0 }));
        return;
      }
      const touch = e.touches[0];
      if (!touch) return;
      const delta = touch.clientY - startY.current;
      if (delta <= 0) {
        // Movio hacia arriba — abortar
        startY.current = null;
        setState((s) => ({ ...s, isPulling: false, pullDistance: 0 }));
        return;
      }
      // Resistencia: cuanto mas tiras, menos baja (sqrt curve)
      const resisted = Math.min(MAX_PULL, Math.sqrt(delta * 18));
      setState((s) => ({ ...s, isPulling: true, pullDistance: resisted }));
    },
    [enabled],
  );

  const handleTouchEnd = useCallback(async () => {
    if (!enabled || startY.current === null) return;
    const pulled = state.pullDistance;
    startY.current = null;
    if (pulled >= THRESHOLD && !state.isRefreshing) {
      setState({
        isPulling: false,
        isRefreshing: true,
        pullDistance: THRESHOLD,
      });
      try {
        await onRefreshRef.current();
      } catch {
        // Errores ya los maneja el caller via toast usualmente
      }
      setState({ isPulling: false, isRefreshing: false, pullDistance: 0 });
    } else {
      setState({ isPulling: false, isRefreshing: false, pullDistance: 0 });
    }
  }, [enabled, state.pullDistance, state.isRefreshing]);

  useEffect(() => {
    if (!enabled) return;
    // Solo registrar en touch devices
    if (typeof window === "undefined") return;
    const isTouch =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      // Para iPads con keyboard donde maxTouchPoints puede mentir
      window.matchMedia("(pointer: coarse)").matches;
    if (!isTouch) return;

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return state;
}

/**
 * Threshold exported para que el indicador visual sepa cuando mostrar
 * "Suelta para refrescar" vs "Sigue tirando".
 */
export const PULL_TO_REFRESH_THRESHOLD = THRESHOLD;
