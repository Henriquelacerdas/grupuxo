"use client";

import { ArrowLeftRight, Circle, CircleCheck, Ellipsis, Pencil, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, type MenuItem } from "@/components/sheet";
import { cx } from "@/components/ui";
import { useT } from "@/i18n/provider";
import type { RoomColor, TaskItem } from "@/lib/api/types";
import type { TaskTiming } from "@/lib/format/labels";

export interface RowActions {
  readonly onSwap?: () => void;
  readonly onCancelSwap?: () => void;
  readonly onEnd?: () => void;
}

/** Uma tarefa do morador (MyTaskRow): círculo de conclusão na cor do cômodo, nome, cômodo, prazo e troca pedida. */
export function TaskRow({
  item, color, roomName, timing, pendingSwap, canComplete, busy, onComplete, actions,
}: {
  item: TaskItem; color: RoomColor; roomName: string | null; timing: TaskTiming | null; pendingSwap: string | null;
  canComplete: boolean; busy: boolean; onComplete: () => void; actions: RowActions;
}) {
  const t = useT();
  const router = useRouter();
  const done = item.occurrence.status === "completed";
  const name = item.definition.name;
  const href = `/app/tasks/${encodeURIComponent(item.definition.id.toLowerCase())}`;
  const menu: MenuItem[] = [
    ...(actions.onSwap !== undefined ? [{ label: t("Pedir troca"), icon: ArrowLeftRight, onSelect: actions.onSwap }] : []),
    ...(actions.onCancelSwap !== undefined ? [{ label: t("Cancelar pedido de troca"), icon: X, onSelect: actions.onCancelSwap }] : []),
    { label: t("Editar"), icon: Pencil, onSelect: () => router.push(href) },
    ...(actions.onEnd !== undefined ? [{ label: t("Apagar"), icon: Trash2, onSelect: actions.onEnd, destructive: true }] : []),
  ];
  const timingNode = timing === null ? null : (
    <span className={cx(timing.style === "due" && "font-semibold text-label", timing.style === "overdue" && "text-danger")}>{timing.text}</span>
  );
  return (
    <div className="flex min-h-[56px] items-center gap-1 rounded-[var(--radius-control)] bg-card py-1.5 pl-2 pr-1">
      <button
        type="button"
        onClick={onComplete}
        disabled={!canComplete || busy}
        aria-label={done ? t("Desmarcar conclusão de {0}", name) : t("Concluir {0}", name)}
        aria-pressed={done}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-fill disabled:cursor-not-allowed disabled:opacity-45"
        style={{ color: `var(--room-${color})` }}
      >
        {done ? <CircleCheck aria-hidden="true" size={27} strokeWidth={2.25} /> : <Circle aria-hidden="true" size={27} strokeWidth={1.75} />}
      </button>
      <Link href={href} className="min-w-0 flex-1 py-1">
        <span className={cx("block text-[17px]", done && "text-secondary line-through")}>{name}</span>
        {(roomName !== null || timingNode !== null) && (
          <span className="block text-[15px] text-secondary">
            {roomName}
            {roomName !== null && timingNode !== null && " · "}
            {timingNode}
          </span>
        )}
        {pendingSwap !== null && (
          <span className="mt-0.5 flex items-center gap-1 text-[13px] text-secondary">
            <ArrowLeftRight aria-hidden="true" size={13} />
            {pendingSwap}
          </span>
        )}
        <span className="sr-only">{done ? t("Concluída") : t("Pendente")}</span>
      </Link>
      <Menu label={t("Mais opções para {0}", name)} trigger={<Ellipsis aria-hidden="true" size={20} />} items={menu} />
    </div>
  );
}
