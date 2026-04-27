"use client";

import { Toaster as SonnerToaster, toast } from "sonner";
import { CheckCircle2, XCircle, AlertCircle, Info } from "lucide-react";

/**
 * Apple-style toast notifications wrapper around sonner.
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
      theme="light"
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            "rounded-2xl ring-1 ring-hairline shadow-card bg-white text-ink-900 p-4",
          title: "text-sm font-semibold tracking-tight",
          description: "text-xs text-ink-500 mt-0.5",
          closeButton: "ring-1 ring-hairline",
        },
        duration: 4000,
      }}
      icons={{
        success: (
          <CheckCircle2 className="h-5 w-5 text-positive" strokeWidth={2} />
        ),
        error: <XCircle className="h-5 w-5 text-negative" strokeWidth={2} />,
        warning: (
          <AlertCircle className="h-5 w-5 text-warning" strokeWidth={2} />
        ),
        info: <Info className="h-5 w-5 text-sf-blue" strokeWidth={2} />,
      }}
    />
  );
}

export { toast };
