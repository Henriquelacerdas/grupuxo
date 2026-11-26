"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { RoomIcon } from "@/components/icons";
import { cx } from "@/components/ui";
import type { RoomColor } from "@/lib/api/types";

export interface RoomLook { readonly icon: string; readonly color: RoomColor }

/** Ícone do cômodo (32 pt) e nome, como nos cartões da avaliação e do resumo. */
export function RoomTitle({ name, look }: { name: string; look: RoomLook | undefined }) {
  return (
    <div className="flex items-center gap-3">
      {look !== undefined && <RoomIcon icon={look.icon} color={look.color} size={32} />}
      <span className="font-semibold">{name}</span>
    </div>
  );
}

/** Um dos três níveis: visual de 40 pt, toque de 44 pt. */
export function LevelPill({ title, selected, onSelect }: { title: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        "min-h-[44px] rounded-full px-4 text-[15px] font-semibold transition",
        selected ? "bg-accent-fill text-on-accent" : "bg-fill text-label hover:bg-fill-strong",
      )}
    >
      {title}
    </button>
  );
}

/** Tag da avaliação. Marcada: fundo e texto no tom do acento, com ✓. */
export function TagChip({ title, selected, onToggle }: { title: string; selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cx(
        "inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 text-[15px] transition",
        selected ? "bg-accent-soft text-accent" : "bg-fill text-label hover:bg-fill-strong",
      )}
    >
      {selected && <Check aria-hidden="true" size={15} strokeWidth={2.5} />}
      {title}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-[var(--radius-card)] bg-card", className)}>{children}</div>;
}
