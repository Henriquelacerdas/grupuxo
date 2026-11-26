"use client";

import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { NOTIFICATION_SYMBOLS } from "@/components/icons";
import { ConfirmDialog } from "@/components/sheet";
import { Button, EmptyState, ErrorState, PageTitle, Section, Spinner } from "@/components/ui";
import type { AppNotification, SwapRequest } from "@/lib/api/types";
import { notifications as notificationsAPI, rooms, swaps as swapsAPI, tasks } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { invalidateHouse, keys, useNotificationsQuery, useNow, useSwapsQuery } from "@/lib/client/queries";
import { time } from "@/lib/format/dates";
import { shortName } from "@/lib/format/names";
import { useHouse, useTextContext } from "../house-context";
import { WeekSummarySheet } from "../ratings/week-summary-sheet";
import {
  TINT_COLORS, elapsed, notificationDays, notificationIcon, notificationLines, notificationTarget, notificationTint, targetHref,
} from "./text";

const MARK = "\u0001";

/** Frase do catálogo com o argumento em negrito ("**Henrique L.** quer trocar"). */
function Emphasized({ text }: { text: string }) {
  const [before, value, after] = text.split(MARK);
  if (value === undefined) return <>{text}</>;
  return <>{before}<strong>{value}</strong>{after}</>;
}

type SwapAction = "accept" | "reject" | "cancel";

/** Notificações: pedidos de troca recebidos ("Pedidos"), os que você fez ("Seus pedidos") e as novidades por dia. */
export function NotificationsView() {
  const ctx = useTextContext();
  const { t } = ctx;
  const { snapshot, userID, memberNames } = useHouse();
  const router = useRouter();
  const client = useQueryClient();
  const now = useNow();
  const notifications = useNotificationsQuery();
  const swaps = useSwapsQuery();
  const [failure, setFailure] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const incoming = useMemo(() => (swaps.data?.incoming ?? []).filter((swap) => swap.status === "pending"), [swaps.data]);
  const outgoing = useMemo(() => (swaps.data?.outgoing ?? []).filter((swap) => swap.status === "pending"), [swaps.data]);

  // Nomes das tarefas: as que a casa mostra; a da outra pessoa, se faltar, vem das candidatas (a troca é simétrica).
  const taskNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of [...snapshot.roomTasks, ...snapshot.myTasks, ...snapshot.sporadicTasks]) names.set(item.occurrence.id.toLowerCase(), item.definition.name);
    return names;
  }, [snapshot]);
  const lookups = useMemo(() => {
    const wanted: { readonly target: string; readonly via: string }[] = [];
    for (const swap of incoming) if (!taskNames.has(swap.offeredOccurrenceID.toLowerCase())) wanted.push({ target: swap.offeredOccurrenceID, via: swap.requestedOccurrenceID });
    for (const swap of outgoing) if (!taskNames.has(swap.requestedOccurrenceID.toLowerCase())) wanted.push({ target: swap.requestedOccurrenceID, via: swap.offeredOccurrenceID });
    return wanted;
  }, [incoming, outgoing, taskNames]);
  const candidates = useQueries({
    queries: lookups.map((lookup) => ({ queryKey: keys.swapCandidates(lookup.via), queryFn: () => tasks.swapCandidates(lookup.via), staleTime: 60_000 })),
  });
  const taskName = (occurrenceID: string): string | null => {
    const id = occurrenceID.toLowerCase();
    const known = taskNames.get(id);
    if (known !== undefined) return known;
    for (const result of candidates) {
      const found = result.data?.find((item) => item.occurrence.id.toLowerCase() === id);
      if (found !== undefined) return found.definition.name;
    }
    return null;
  };
  const memberName = (id: string): string | null => {
    const name = memberNames.get(id.toLowerCase());
    return name === undefined ? null : shortName(name);
  };

  const respond = useMutation({
    mutationFn: ({ action, swap }: { action: SwapAction; swap: SwapRequest }) =>
      action === "accept" ? swapsAPI.accept(swap.id) : action === "reject" ? swapsAPI.reject(swap.id) : swapsAPI.cancel(swap.id),
    onError: (error) => setFailure(errorMessage(t, error)),
    // Recarrega também na falha: o pedido pode ter sido resolvido por outro caminho.
    onSettled: () => invalidateHouse(client),
  });

  const markRead = useMutation({
    mutationFn: (notification: AppNotification) => notificationsAPI.read(notification.id),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.notifications }),
    onError: (error) => setFailure(errorMessage(t, error)),
  });

  const answer = useMutation({
    mutationFn: async ({ notification, approve }: { notification: AppNotification; approve: boolean }) => {
      if (notification.roomID === null || notification.actorUserID === null) return;
      await (approve ? rooms.approve(notification.roomID, notification.actorUserID) : rooms.deny(notification.roomID, notification.actorUserID));
      if (notification.readAt === null) await notificationsAPI.read(notification.id);
    },
    onError: (error) => setFailure(errorMessage(t, error)),
    onSettled: () => invalidateHouse(client),
  });

  const open = (notification: AppNotification) => {
    if (notification.readAt === null) markRead.mutate(notification);
    if (notification.kind === "weeklySummaryReady") {
      setSummaryOpen(true);
      return;
    }
    const target = notificationTarget(notification);
    if (target !== null) router.push(targetHref(target));
  };

  let content;
  if (notifications.isPending) {
    content = <Spinner label={t("Carregando notificações…")} />;
  } else if (notifications.isError) {
    content = <ErrorState message={errorMessage(t, notifications.error)} onRetry={() => void notifications.refetch()} />;
  } else if (notifications.data.length === 0 && incoming.length === 0 && outgoing.length === 0) {
    content = <EmptyState icon={Bell} title={t("Nada por aqui")} message={t("Pedidos de troca e mudanças nas tarefas da casa aparecem aqui.")} />;
  } else {
    const busy = respond.isPending;
    content = (
      <>
        {incoming.length > 0 && (
          <Section title={t("Pedidos")}>
            {incoming.map((swap) => {
              const requester = memberName(swap.requesterID);
              return (
                <article key={swap.id} className="flex flex-col gap-3 px-4 py-3" aria-label={t("{0} quer trocar", requester ?? t("Um morador"))}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p><Emphasized text={t("{0} quer trocar", MARK + (requester ?? t("Um morador")) + MARK)} /></p>
                    <span className="shrink-0 text-[13px] text-secondary">{elapsed(ctx, swap.createdAt, now)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <SwapTask owner={t("Você")} name={taskName(swap.requestedOccurrenceID) ?? t("Uma tarefa")} />
                    <ArrowLeftRight aria-hidden="true" size={18} className="shrink-0 text-secondary" />
                    <SwapTask owner={requester} name={taskName(swap.offeredOccurrenceID) ?? t("Uma tarefa")} />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => respond.mutate({ action: "reject", swap })}>{t("Recusar")}</Button>
                    <Button className="flex-1" disabled={busy} onClick={() => respond.mutate({ action: "accept", swap })}>{t("Aceitar")}</Button>
                  </div>
                </article>
              );
            })}
          </Section>
        )}

        {outgoing.length > 0 && (
          <Section title={t("Seus pedidos")}>
            {outgoing.map((swap) => {
              const offered = taskName(swap.offeredOccurrenceID);
              const requested = taskName(swap.requestedOccurrenceID);
              return (
                <article key={swap.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p><Emphasized text={t("Aguardando {0}", MARK + (memberName(swap.receiverID) ?? t("resposta")) + MARK)} /></p>
                    <span className="shrink-0 text-[13px] text-secondary">{elapsed(ctx, swap.createdAt, now)}</span>
                  </div>
                  {offered !== null && <p className="text-[15px] text-secondary"><Emphasized text={t("Você dá {0}", MARK + offered + MARK)} /></p>}
                  {requested !== null && <p className="text-[15px] text-secondary"><Emphasized text={t("Você recebe {0}", MARK + requested + MARK)} /></p>}
                  <div className="pt-1">
                    <Button variant="destructive" size="small" disabled={busy} onClick={() => respond.mutate({ action: "cancel", swap })}>{t("Cancelar pedido")}</Button>
                  </div>
                </article>
              );
            })}
          </Section>
        )}

        {notificationDays(ctx, notifications.data, now).map((day) => (
          <Section key={day.title} title={day.title}>
            {day.notifications.map((notification) => {
              const lines = notificationLines(ctx, notification, memberNames);
              const Icon = NOTIFICATION_SYMBOLS[notificationIcon(notification.kind)] ?? Bell;
              const unread = notification.readAt === null;
              const answersAccess = notification.kind === "roomAccessRequested" && unread
                && notification.roomID !== null && notification.actorUserID !== null && notification.actorUserID.toLowerCase() !== userID;
              return (
                <article key={notification.id} className="relative flex items-center gap-3 px-4 py-2.5 transition hover:bg-fill">
                  <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white" style={{ background: TINT_COLORS[notificationTint(notification.kind)] }}>
                    <Icon size={19} strokeWidth={2.5} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => open(notification)}
                        className="text-left after:absolute after:inset-0 after:content-['']"
                      >
                        <span className={lines.detail === null ? "" : "font-semibold"}>{lines.title}</span>
                        {lines.detail !== null && <span className="sr-only">. {lines.detail}</span>}
                      </button>
                      <span className="shrink-0 text-[13px] text-secondary">{time(notification.createdAt, ctx.locale, ctx.timeZone)}</span>
                    </div>
                    {lines.detail !== null && <p aria-hidden="true" className="text-[15px] text-secondary">{lines.detail}</p>}
                    {answersAccess && (
                      <div className="relative z-10 flex gap-2 pt-1.5">
                        <Button variant="secondary" size="small" disabled={answer.isPending} onClick={() => answer.mutate({ notification, approve: false })}>{t("Recusar")}</Button>
                        <Button size="small" disabled={answer.isPending} onClick={() => answer.mutate({ notification, approve: true })}>{t("Aceitar")}</Button>
                      </div>
                    )}
                  </div>
                  {unread && <span role="img" aria-label={t("Não lida")} className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent-fill" />}
                </article>
              );
            })}
          </Section>
        ))}
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("Notificações")} />
      {content}
      <WeekSummarySheet open={summaryOpen} onOpenChange={setSummaryOpen} />
      <ConfirmDialog
        open={failure !== null}
        onOpenChange={(next) => { if (!next) setFailure(null); }}
        title={t("Não foi possível atualizar")}
        {...(failure !== null ? { message: failure } : {})}
        actions={[]}
        cancelLabel={t("OK")}
      />
    </>
  );
}

function SwapTask({ owner, name }: { owner: string | null; name: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-[12px] bg-fill p-2">
      {owner !== null && <p className="text-[12px] text-secondary">{owner}</p>}
      <p className="truncate text-[15px] font-semibold">{name}</p>
    </div>
  );
}
