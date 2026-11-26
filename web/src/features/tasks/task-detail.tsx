"use client";

import { ChevronDown, Clock, House, Repeat, UserRound, X, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { Avatar, Button, EmptyState, IconButton, cx } from "@/components/ui";
import { RoomIcon } from "@/components/icons";
import { useI18n } from "@/i18n/provider";
import type { TaskDefinition } from "@/lib/api/types";
import { tasks } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { useInvalidateHouse, useNow } from "@/lib/client/queries";
import { calendarDays } from "@/lib/format/dates";
import { deadline, effortName } from "@/lib/format/labels";
import { shortName } from "@/lib/format/names";
import { canComplete, canEdit, canEnd, canRequestSwap, isCompleted, isLinked } from "@/lib/rules/tasks";
import { useHouse, useTextContext } from "@/features/house-context";
import { useAlert } from "./alert";
import { itemsOf, overview, queuePosition } from "./detail";
import { detailRecurrence } from "./recurrence";
import { SwapSheet } from "./swap-sheet";
import { TaskSheet } from "./task-sheet";
import { useCompletions } from "./use-completions";

const COLLAPSED_QUEUE = 2;

/** "Semana passada", "Ontem", "Há 3 dias": a data relativa, com a primeira letra maiúscula. */
function lastDone(locale: string, days: number): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const text = Math.abs(days) < 7 ? rtf.format(days, "day")
    : Math.abs(days) < 30 ? rtf.format(Math.round(days / 7), "week")
      : Math.abs(days) < 365 ? rtf.format(Math.round(days / 30), "month") : rtf.format(Math.round(days / 365), "year");
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** Detalhe da tarefa (TaskDetailView): cabeçalho, descrição, rodízio, detalhes e ações. */
export function TaskDetail({ taskDefinitionID }: { taskDefinitionID: string }) {
  const { t, locale } = useI18n();
  const ctx = useTextContext();
  const { snapshot, userID } = useHouse();
  const now = useNow();
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateHouse();
  const { show: showAlert, node: alertNode } = useAlert();
  const onError = useCallback((error: unknown) => showAlert(t("Não foi possível concluir a ação"), errorMessage(t, error)), [showAlert, t]);
  const completions = useCompletions(userID, onError);
  const { apply } = completions;
  const view = useMemo(() => apply(snapshot), [apply, snapshot]);

  const [editing, setEditing] = useState<TaskDefinition | null>(null);
  const [swapOccurrence, setSwapOccurrence] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"end" | "delete" | null>(null);
  const [fullQueue, setFullQueue] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (window.history.length > 1) router.back();
    else router.push("/app/tasks");
  };

  const items = useMemo(() => itemsOf(view, taskDefinitionID), [view, taskDefinitionID]);
  const definition = items[0]?.definition;
  if (definition === undefined) {
    return (
      <>
        <div className="pt-2"><IconButton label={t("Fechar")} icon={X} onClick={close} /></div>
        <EmptyState title={t("Item não encontrado.")} />
      </>
    );
  }

  const participation = view.participations.find((p) => p.room.id === definition.roomID);
  const room = participation?.room ?? view.home.rooms.find((r) => r.id === definition.roomID);
  const isRoomMember = participation?.isMember === true;
  const { current, lastCompleted, upcoming } = overview(items, userID, now);
  const linked = room !== undefined && isLinked(definition, room);

  const kind = definition.kind === "sporadic" ? t("Tarefa única") : linked ? t("Repetição do cômodo") : t("Repetição própria");
  const deadlineText = participation !== undefined && linked
    ? deadline(ctx, participation.periodEnd, now)
    : current?.occurrence.dueAt != null
      ? t("Prazo: {0}", new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: ctx.timeZone }).format(current.occurrence.dueAt - 1000))
      : null;

  const mayComplete = current !== null && !busy && !completions.isPending(current.occurrence.id) && canComplete(current, userID, now);
  const maySwap = current !== null && !busy && !completions.isPending(current.occurrence.id) && canRequestSwap(current, userID, now);
  const mayEnd = !busy && canEnd(definition);
  const mayDelete = !busy && definition.kind === "sporadic" && definition.createdByUserID === userID;

  const remove = async (mode: "end" | "delete") => {
    setBusy(true);
    try {
      if (mode === "end") await tasks.end(definition.roomID, definition.id);
      else await tasks.remove(definition.roomID, definition.id);
      toast(mode === "end" ? t("Tarefa apagada") : t("Tarefa Única apagada"));
      await invalidate();
      close();
    } catch (error) {
      onError(error);
      setBusy(false);
    }
  };

  const visibleQueue = fullQueue ? upcoming : upcoming.slice(0, COLLAPSED_QUEUE);
  const dateFormat = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: ctx.timeZone });

  const details: { title: string; icon: ReactNode; value: ReactNode }[] = [
    ...(room !== undefined ? [{ title: t("Cômodo"), icon: <House aria-hidden="true" size={18} />, value: room.name }] : []),
    { title: t("Repetição"), icon: <Repeat aria-hidden="true" size={18} />, value: detailRecurrence(t, definition.recurrence) },
    { title: t("Esforço"), icon: <Zap aria-hidden="true" size={18} />, value: effortName(t, definition.effort) },
    ...(lastCompleted?.occurrence.completedAt != null ? [{
      title: t("Última vez"), icon: <Clock aria-hidden="true" size={18} />,
      value: lastDone(locale, Math.min(0, calendarDays(now, lastCompleted.occurrence.completedAt, ctx.timeZone))),
    }] : []),
    ...(lastCompleted?.assignee != null ? [{ title: t("Último morador"), icon: <UserRound aria-hidden="true" size={18} />, value: shortName(lastCompleted.assignee.name) }] : []),
  ];

  return (
    <article className="pb-6">
      <div className="flex items-center justify-between pt-2">
        <IconButton label={t("Fechar")} icon={X} onClick={close} />
        {canEdit(definition, userID, isRoomMember) && <Button variant="plain" onClick={() => setEditing(definition)}>{t("Editar")}</Button>}
      </div>

      <header className="mt-3 flex items-center gap-4">
        {room !== undefined && <RoomIcon icon={room.icon} color={room.color} size={72} />}
        <div className="min-w-0">
          <h1 className="font-rounded text-[28px] font-bold leading-tight">{definition.name}</h1>
          {deadlineText !== null && <p className="text-[15px]">{deadlineText}</p>}
          <p className="text-[15px] text-secondary">{kind}</p>
        </div>
      </header>

      {definition.details !== "" && (
        <DetailSection title={t("Descrição")}>
          <p className="whitespace-pre-wrap px-4 py-4">{definition.details}</p>
        </DetailSection>
      )}

      {upcoming.length > 0 && (
        <DetailSection title={t("Rodízio")}>
          <ul className="[&>*+*]:border-t [&>*+*]:border-separator">
            {visibleQueue.map((entry, index) => {
              const position = queuePosition(upcoming, index);
              const isMe = entry.assignee?.id === userID;
              return (
                <li key={entry.occurrenceID} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
                  {entry.assignee !== null && <Avatar name={entry.assignee.name} photoURL={entry.assignee.photoURL} />}
                  <span className={cx("flex-1", isMe && "font-semibold", entry.assignee === null && "text-secondary")}>
                    {entry.assignee === null ? t("Sem responsável") : isMe ? t("Você") : shortName(entry.assignee.name)}
                  </span>
                  <span className="text-secondary">
                    {position === "current" ? t("Atual") : position === "next" ? t("Próximo") : dateFormat.format(entry.availableAt)}
                  </span>
                </li>
              );
            })}
            {upcoming.length > COLLAPSED_QUEUE && (
              <li>
                <button
                  type="button"
                  aria-expanded={fullQueue}
                  onClick={() => setFullQueue((v) => !v)}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 text-accent transition hover:bg-fill"
                >
                  {fullQueue ? t("Ver menos") : t("Ver mais")}
                  <ChevronDown aria-hidden="true" size={16} className={cx("transition", fullQueue && "rotate-180")} />
                </button>
              </li>
            )}
          </ul>
        </DetailSection>
      )}

      <DetailSection title={t("Detalhes")}>
        <dl className="[&>*+*]:border-t [&>*+*]:border-separator">
          {details.map((row) => (
            <div key={row.title} className="flex min-h-[48px] items-center gap-3 px-4 py-2">
              <dt className="flex flex-1 items-center gap-2"><span className="text-accent">{row.icon}</span>{row.title}</dt>
              <dd className="text-right text-secondary">{row.value}</dd>
            </div>
          ))}
        </dl>
      </DetailSection>

      <div className="mt-6 flex flex-col gap-3">
        {current !== null && canComplete(current, userID, now) && (
          isCompleted(current)
            ? <Button size="large" variant="secondary" disabled={!mayComplete} onClick={() => void completions.toggle(current)}>{t("Desmarcar como feita")}</Button>
            : <Button size="large" disabled={!mayComplete} onClick={() => void completions.toggle(current)}>{t("Marcar como feita")}</Button>
        )}
        {maySwap && current !== null && (
          <Button size="large" variant="secondary" onClick={() => setSwapOccurrence(current.occurrence.id)}>{t("Pedir troca")}</Button>
        )}
        {(mayEnd || mayDelete) && (
          <Button size="large" variant="destructive" onClick={() => setConfirming(mayEnd ? "end" : "delete")}>{t("Apagar tarefa")}</Button>
        )}
      </div>

      {editing !== null && <TaskSheet open onOpenChange={(open) => { if (!open) setEditing(null); }} editing={editing} />}
      <SwapSheet occurrenceID={swapOccurrence} onClose={() => setSwapOccurrence(null)} />
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => { if (!open) setConfirming(null); }}
        title={confirming === "delete" ? t("Apagar Tarefa Única?") : t("Apagar tarefa?")}
        message={confirming === "delete"
          ? t("A tarefa \"{0}\" será apagada para todos os moradores.", definition.name)
          : t("A tarefa não será mais repetida. O histórico fica, e a vez atual continua até ser concluída.")}
        actions={[{ label: t("Apagar"), destructive: true, onSelect: () => { if (confirming !== null) void remove(confirming); } }]}
      />
      {alertNode}
    </article>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-1.5 px-4 font-rounded text-[17px] font-semibold">{title}</h2>
      <div className="overflow-hidden rounded-[var(--radius-card)] bg-card">{children}</div>
    </section>
  );
}
