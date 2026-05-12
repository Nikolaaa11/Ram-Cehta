"use client";

import { Toaster as SonnerToaster, toast } from "sonner";
import { CheckCircle2, XCircle, AlertCircle, Info, Loader2 } from "lucide-react";

/**
 * Apple-style toast notifications wrapper around sonner.
 *
 * V5++ ola CA premium upgrade:
 *   - Glass background (backdrop-blur)
 *   - Tone-colored left border (3px) según tipo
 *   - Custom icons con halo glow
 *   - Smooth swipe-to-dismiss
 *   - Dark mode support
 *
 * Mounted once globally via `components/providers.tsx`. Use `toast.success(...)`,
 * `toast.error(...)`, `toast.warning(...)`, or `toast.info(...)` from any client
 * component to surface non-blocking feedback.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors={false}
      closeButton
      theme="system"
      offset={16}
      expand
      visibleToasts={5}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "group relative overflow-hidden rounded-2xl ring-1 ring-hairline shadow-elevated-lg bg-white/90 backdrop-blur-xl text-ink-900 p-4 pl-5 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-ink-300 before:rounded-l-2xl dark:bg-ink-900/90 dark:text-ink-100 dark:ring-ink-700",
          title: "text-sm font-semibold tracking-tight",
          description: "text-xs text-ink-500 mt-0.5 dark:text-ink-400",
          actionButton:
            "rounded-lg bg-cehta-green px-3 py-1 text-xs font-medium text-white hover:bg-cehta-green-600 transition-colors",
          cancelButton:
            "rounded-lg bg-ink-100 px-3 py-1 text-xs font-medium text-ink-700 hover:bg-ink-200 transition-colors dark:bg-ink-800 dark:text-ink-300",
          closeButton:
            "!bg-white/90 !ring-1 !ring-hairline hover:!bg-ink-50 transition-colors dark:!bg-ink-800 dark:!ring-ink-700",
          success:
            "before:!bg-positive [&_[data-icon]]:!text-positive",
          error:
            "before:!bg-negative [&_[data-icon]]:!text-negative",
          warning:
            "before:!bg-warning [&_[data-icon]]:!text-warning",
          info:
            "before:!bg-sf-blue [&_[data-icon]]:!text-sf-blue",
          loading:
            "before:!bg-cehta-green [&_[data-icon]]:!text-cehta-green",
        },
        duration: 4000,
      }}
      icons={{
        success: (
          <span className="relative inline-flex">
            <span className="absolute inset-0 rounded-full bg-positive/20 blur-sm" />
            <CheckCircle2
              className="relative h-5 w-5 text-positive"
              strokeWidth={2}
            />
          </span>
        ),
        error: (
          <span className="relative inline-flex">
            <span className="absolute inset-0 rounded-full bg-negative/20 blur-sm" />
            <XCircle
              className="relative h-5 w-5 text-negative"
              strokeWidth={2}
            />
          </span>
        ),
        warning: (
          <span className="relative inline-flex">
            <span className="absolute inset-0 rounded-full bg-warning/20 blur-sm" />
            <AlertCircle
              className="relative h-5 w-5 text-warning"
              strokeWidth={2}
            />
          </span>
        ),
        info: (
          <span className="relative inline-flex">
            <span className="absolute inset-0 rounded-full bg-sf-blue/20 blur-sm" />
            <Info className="relative h-5 w-5 text-sf-blue" strokeWidth={2} />
          </span>
        ),
        loading: (
          <Loader2
            className="h-5 w-5 animate-spin text-cehta-green"
            strokeWidth={2}
          />
        ),
      }}
    />
  );
}

export { toast };
