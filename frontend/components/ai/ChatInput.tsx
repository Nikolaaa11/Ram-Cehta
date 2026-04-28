"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Textarea autosize + botón Enviar.
 * - Enter envía, Shift+Enter inserta newline.
 * - Disabled mientras `streaming` para evitar dobles envíos.
 */
export function ChatInput({
  onSend,
  disabled,
  placeholder = "Pregúntame...",
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Autosize.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <div
      className={cn(
        "flex items-end gap-2 rounded-2xl border border-hairline bg-white px-3 py-2 shadow-card transition-shadow duration-150 ease-apple",
        "focus-within:shadow-card-hover focus-within:ring-2 focus-within:ring-cehta-green/40",
      )}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-ink-900 outline-none placeholder:text-ink-300 disabled:opacity-50"
      />
      <Button
        type="button"
        size="icon"
        onClick={submit}
        disabled={disabled || !value.trim()}
        className="h-8 w-8 shrink-0 rounded-full bg-cehta-green text-white shadow-card hover:bg-cehta-green-600"
        aria-label="Enviar mensaje"
      >
        <Send className="h-4 w-4" strokeWidth={1.75} />
      </Button>
    </div>
  );
}
