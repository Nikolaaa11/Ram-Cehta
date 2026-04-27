"use client";

import * as React from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "cmdk";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "@/lib/utils";

export interface ComboboxItem {
  value: string;
  label: string;
  group?: string;
}

interface ComboboxProps {
  items: ComboboxItem[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  searchPlaceholder?: string;
  className?: string;
  triggerClassName?: string;
}

export function Combobox({
  items,
  value,
  onValueChange,
  placeholder = "Selecciona…",
  emptyText = "Sin resultados.",
  searchPlaceholder = "Buscar…",
  className,
  triggerClassName,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = items.find((i) => i.value === value);

  // Agrupar items si tienen `group`.
  const grouped = React.useMemo(() => {
    const map = new Map<string, ComboboxItem[]>();
    for (const item of items) {
      const key = item.group ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls="combobox-popover"
          className={cn(
            "inline-flex h-9 items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline shadow-glass",
            "transition-colors duration-150 ease-apple hover:bg-surface-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
            triggerClassName,
          )}
        >
          <span className={cn("truncate", !selected && "text-ink-500")}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-500" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        id="combobox-popover"
        className={cn("p-0 w-[var(--radix-popover-trigger-width)] min-w-[14rem]", className)}
      >
        <Command className="overflow-hidden rounded-2xl">
          <div className="border-b border-hairline px-3 py-2">
            <CommandInput
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm text-ink-900 placeholder:text-ink-500 outline-none"
            />
          </div>
          <CommandList className="max-h-72 overflow-y-auto p-1">
            <CommandEmpty className="px-3 py-6 text-center text-sm text-ink-500">
              {emptyText}
            </CommandEmpty>
            {grouped.map(([groupName, groupItems]) => (
              <CommandGroup
                key={groupName || "default"}
                heading={groupName || undefined}
                className={cn(
                  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5",
                  "[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium",
                  "[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide",
                  "[&_[cmdk-group-heading]]:text-ink-500",
                )}
              >
                {groupItems.map((item) => (
                  <CommandItem
                    key={item.value}
                    value={`${item.label} ${item.value}`}
                    onSelect={() => {
                      onValueChange(item.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-900",
                      "data-[selected=true]:bg-surface-muted",
                      "aria-selected:bg-surface-muted",
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                    {value === item.value && (
                      <Check className="h-4 w-4 text-cehta-green" strokeWidth={1.5} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
