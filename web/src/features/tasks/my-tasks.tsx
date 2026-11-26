"use client";

import { Bell, ChevronDown, CircleCheck, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { Avatar, EmptyState, PageTitle, cx } from "@/components/ui";
import { useT } from "@/i18n/provider";
import type { Room, TaskDefinition, TaskItem } from "@/lib/api/types";
import { swaps, tasks } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { useInvalidateHouse, useNow } from "@/lib/client/queries";
import { cycleStatus, pendingSwap, timing } from "@/lib/format/labels";
import { shortName } from "@/lib/format/names";
import { canComplete, canEnd, canRequestSwap, isCompleted, myTasksOverview, overviewIsEmpty } from "@/lib/rules/tasks";
import { useHouse, useTextContext } from "@/features/house-context";
import { WeekRatingHost } from "@/features/ratings/week-rating-host";
import { roomTextColor, useAlert } from "./alert";
import { usePendingSwaps } from "./pending-swaps";
import { SwapSheet } from "./swap-sheet";
import { TaskRow } from "./task-row";
import { TaskSheet } from "./task-sheet";
import { useCompletions } from "./use-completions";

type SectionID = "cycle" | "extras" | "sporadic";

/** Minhas tarefas: Repetição do cômodo (por cômodo), Repetição própria e Tarefas únicas. */
export function MyTasks() {
  const t = useT();
  const ctx = useTextContext();
  const { snapshot, userID, me, memberNames } = useHouse();
  const now = useNow();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const invalidate = useInvalidateHouse();
  const { show: showAlert, node: alertNode } = useAlert();
  const onError = useCallback((error: unknown) => showAlert(t("Não foi possível atualizar a tarefa"), errorMessage(t, error)), [showAlert, t]);
  const completions = useCompletions(userID, onError);
  const pendingSwaps = usePendingSwaps();

  const [creating, setCreating] = useState(false);
  const [swapOccurrence, setSwapOccurrence] = useState<string | null>(null);
  const [ending, setEnding] = useState<TaskDefinition | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionID>>(new Set());

  // Atalho do PWA "Nova tarefa" (`/app/tasks?new=1`): abre a sheet uma vez e limpa a URL.
  const wantsNew = params.get("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    setCreating(true);
    router.replace("/app/tasks");
  }, [wantsNew, router]);

  const { apply } = completions;
  const view = useMemo(() => apply(snapshot), [apply, snapshot]);
  const overview = useMemo(() => myTasksOverview(view, now), [view, now]);

  const swapText = (item: TaskItem): string | null => {
    const swap = pendingSwaps.get(item.occurrence.id.toLowerCase());
    if (swap === undefined) return null;
    const receiver = memberNames.get(swap.receiverID.toLowerCase());
    return pendingSwap(ctx, receiver === undefined ? null : shortName(receiver));
  };

  const cancelSwap = async (item: TaskItem) => {
    const swap = pendingSwaps.get(item.occurrence.id.toLowerCase());
    if (swap === undefined) return;
    try {
      await swaps.cancel(swap.id);
      toast(t("Pedido de troca cancelado"));
      await invalidate();
    } catch (error) {
      onError(error);
    }
  };

  const endTask = async (definition: TaskDefinition) => {
    try {
      await tasks.end(definition.roomID, definition.id);
      toast(t("Tarefa apagada"));
      await invalidate();
    } catch (error) {
      onError(error);
    }
  };

  const row = (item: TaskItem, room: Room, showRoom: boolean) => {
    const id = item.occurrence.id;
    const hasSwap = pendingSwaps.has(id.toLowerCase());
    return (
      <li key={id}>
        <TaskRow
          item={item}
          color={room.color}
          roomName={showRoom ? room.name : null}
          timing={showRoom && !isCompleted(item) ? timing(ctx, item.occurrence.availableAt, item.occurrence.dueAt, now) : null}
          pendingSwap={swapText(item)}
          canComplete={canComplete(item, userID, now)}
          busy={completions.isPending(id)}
          onComplete={() => void completions.toggle(item)}
          actions={{
            ...(canRequestSwap(item, userID, now) && !completions.isPending(id) && !hasSwap ? { onSwap: () => setSwapOccurrence(id) } : {}),
            ...(hasSwap ? { onCancelSwap: () => void cancelSwap(item) } : {}),
            ...(canEnd(item.definition) ? { onEnd: () => setEnding(item.definition) } : {}),
          }}
        />
      </li>
    );
  };

  const toggleSection = (section: SectionID) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    return next;
  });

  const section = (id: SectionID, title: string, divider: boolean, children: ReactNode) => {
    const expanded = !collapsed.has(id);
    return (
      <section key={id} aria-labelledby={`section-${id}`} className={cx("pt-4", divider && "mt-2 border-t border-separator")}>
        <h2 id={`section-${id}`}>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => toggleSection(id)}
            className="flex min-h-[44px] w-full items-center gap-2 text-left font-rounded text-[22px] font-bold"
          >
            <span className="flex-1">{title}</span>
            <ChevronDown aria-hidden="true" size={20} className={cx("text-secondary transition", !expanded && "-rotate-90")} />
          </button>
        </h2>
        {expanded && <div className="mt-2 space-y-4">{children}</div>}
      </section>
    );
  };

  const empty = overviewIsEmpty(overview);

  return (
    <>
      <PageTitle
        title={t("Minhas tarefas")}
        actions={(
          <>
            <Link href="/app/settings" aria-label={t("Perfil")} className="mr-1 rounded-full lg:hidden">
              <Avatar name={me?.name ?? ""} photoURL={me?.photoURL ?? null} size="toolbar" />
            </Link>
            <Link href="/app/notifications" aria-label={t("Notificações")} title={t("Notificações")} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-accent transition hover:bg-fill lg:hidden">
              <Bell aria-hidden="true" size={22} />
            </Link>
            <button
              type="button"
              aria-label={t("Adicionar tarefa")}
              title={t("Adicionar tarefa")}
              onClick={() => setCreating(true)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent-fill text-on-accent transition hover:brightness-110"
            >
              <Plus aria-hidden="true" size={22} strokeWidth={2.5} />
            </button>
          </>
        )}
      />

      <WeekRatingHost />

      {empty ? (
        <EmptyState icon={CircleCheck} title={t("Tudo em dia")} message={t("Você não tem tarefas agora. Quando começar o próximo ciclo, elas aparecem aqui.")} />
      ) : (
        <div className="pb-4">
          {overview.cycleGroups.length > 0 && section("cycle", t("Repetição do cômodo"), false, overview.cycleGroups.map((group) => (
            <div key={group.room.id}>
              <h3 className="pt-1" aria-label={`${group.room.name}, ${cycleStatus(ctx, group.periodEnd, group.progress, now)}`}>
                <span className="block font-rounded text-[20px] font-semibold" style={{ color: roomTextColor(group.room.color) }}>{group.room.name}</span>
                <span className="block text-[15px] font-normal text-secondary">{cycleStatus(ctx, group.periodEnd, group.progress, now)}</span>
              </h3>
              <ul className="mt-2 space-y-2">{group.tasks.map((item) => row(item, group.room, false))}</ul>
            </div>
          )))}
          {overview.extraTasks.length > 0 && section("extras", t("Repetição própria"), overview.cycleGroups.length > 0, (
            <ul className="space-y-2">{overview.extraTasks.map(({ room, item }) => row(item, room, true))}</ul>
          ))}
          {overview.sporadicTasks.length > 0 && section("sporadic", t("Tarefas únicas"), overview.cycleGroups.length > 0 || overview.extraTasks.length > 0, (
            <ul className="space-y-2">{overview.sporadicTasks.map(({ room, item }) => row(item, room, true))}</ul>
          ))}
        </div>
      )}

      <TaskSheet open={creating} onOpenChange={setCreating} />
      <SwapSheet occurrenceID={swapOccurrence} onClose={() => setSwapOccurrence(null)} />
      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(open) => { if (!open) setEnding(null); }}
        title={t("Apagar tarefa?")}
        message={ending === null ? "" : t("{0} não será mais repetida. O histórico fica, e a vez atual continua até ser concluída.", ending.name)}
        actions={[{ label: t("Apagar"), destructive: true, onSelect: () => { if (ending !== null) void endTask(ending); } }]}
      />
      {alertNode}
    </>
  );
}
