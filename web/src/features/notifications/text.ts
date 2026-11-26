import type { AppNotification, NotificationKind } from "@/lib/api/types";
import { calendarDays, dayMonth, list, weekday } from "@/lib/format/dates";
import { effortName, type TextContext } from "@/lib/format/labels";
import { shortName } from "@/lib/format/names";

// Texto, ícone, cor e destino de cada aviso (NotificationText.swift). O servidor manda dados (tipo, quem fez, nome do
// assunto) e o web monta a frase no idioma do navegador; o nome do assunto é como era na hora, porque a tarefa ou o
// morador pode ter saído. Datas no fuso da casa.

export type NotificationTint = "accent" | "orange" | "green" | "gray" | "red" | "blue";
export type NotificationTarget = { readonly kind: "task"; readonly id: string } | { readonly kind: "room"; readonly id: string };

/** id do morador (minúsculo) → nome completo. */
export type MemberNames = ReadonlyMap<string, string>;

const WEEK_MS = 7 * 24 * 3600 * 1000;

function actorName(ctx: TextContext, notification: AppNotification, memberNames: MemberNames): string {
  const id = notification.actorUserID?.toLowerCase();
  const name = id === undefined ? undefined : memberNames.get(id);
  return name === undefined || name === "" ? ctx.t("Alguém") : shortName(name);
}

/** A frase do aviso numa linha só. */
export function notificationMessage(ctx: TextContext, notification: AppNotification, memberNames: MemberNames): string {
  const { t } = ctx;
  const actor = actorName(ctx, notification, memberNames);
  const subject = notification.subjectName ?? "";
  const empty = subject === "";
  switch (notification.kind) {
    case "taskSwapRequested": return t("Você recebeu uma solicitação de troca de tarefa.");
    case "taskSwapAccepted": return t("Sua solicitação de troca de tarefa foi aceita.");
    case "taskSwapRejected": return t("Sua solicitação de troca de tarefa foi recusada.");
    case "taskEdited": return empty ? t("Uma tarefa foi editada.") : t("{0} editou a tarefa {1}.", actor, subject);
    case "taskDeleted": return empty ? t("Uma tarefa foi apagada.") : t("{0} apagou a tarefa {1}.", actor, subject);
    case "effortChanged": return empty ? t("O esforço de uma tarefa mudou.") : t("{0} mudou o esforço de {1}.", actor, subject);
    case "memberJoined": return empty ? t("Alguém entrou na casa.") : t("{0} entrou na casa.", subject);
    case "memberLeft": return empty ? t("Alguém saiu da casa.") : t("{0} saiu da casa.", subject);
    case "roomDeleted": return empty ? t("Um cômodo foi excluído.") : t("{0} excluiu o cômodo {1}.", actor, subject);
    case "roomAccessRequested": return empty ? t("{0} pediu para entrar em um cômodo.", actor) : t("{0} pediu para entrar em {1}.", actor, subject);
    case "roomAccessApproved": return empty ? t("Você entrou em um cômodo.") : t("Você entrou em {0}.", subject);
    case "roomAccessDenied": return empty ? t("Seu pedido para entrar em um cômodo foi recusado.") : t("Seu pedido para entrar em {0} foi recusado.", subject);
    case "cycleTurned": return empty ? t("Um ciclo virou.") : t("O ciclo de {0} virou.", subject);
    case "weeklySummaryReady": return t("O resumo da semana está pronto.");
  }
}

/**
 * "domingo" quando o fim cai na semana do aviso; mais longe (ciclo de 2 semanas ou mais), a data inteira, para não
 * parecer o domingo mais próximo: "29 de novembro". O prazo é a meia-noite seguinte, então volta um segundo.
 */
export function untilText(ctx: TextContext, due: number, created: number): string {
  const last = due - 1000;
  return due - created > WEEK_MS ? dayMonth(last, ctx.locale, ctx.timeZone, "long") : weekday(last, ctx.locale, ctx.timeZone);
}

export interface NotificationLines { readonly title: string; readonly detail: string | null }

/** As duas linhas do aviso (Figma "Notificações"); os que o Figma não detalha ficam numa linha só. */
export function notificationLines(ctx: TextContext, notification: AppNotification, memberNames: MemberNames): NotificationLines {
  const { t } = ctx;
  const actor = actorName(ctx, notification, memberNames);
  const subject = notification.subjectName ?? "";
  const taskAndRoom = [subject, notification.roomName ?? ""].filter((part) => part !== "").join(" · ");
  const single = (): NotificationLines => ({ title: notificationMessage(ctx, notification, memberNames), detail: null });

  switch (notification.kind) {
    case "taskSwapAccepted": {
      const task = notification.taskName;
      const detail = task === null
        ? null
        : notification.dueAt === null
          ? t("Você faz {0}.", task)
          : t("Você faz {0} até {1}.", task, untilText(ctx, notification.dueAt, notification.createdAt));
      return { title: t("{0} aceitou a troca", actor), detail };
    }
    case "taskSwapRejected":
      return { title: t("{0} recusou a troca", actor), detail: null };
    case "taskEdited":
      return subject === "" ? single() : { title: t("{0} editou uma tarefa", actor), detail: taskAndRoom };
    case "taskDeleted":
      return subject === "" ? single() : { title: t("{0} apagou uma tarefa", actor), detail: taskAndRoom };
    case "effortChanged": {
      if (subject === "") return single();
      const { effortFrom, effortTo } = notification;
      const detail = effortFrom !== null && effortTo !== null
        ? `${subject}: ${effortName(t, effortFrom)} → ${effortName(t, effortTo)}`
        : taskAndRoom;
      return { title: t("{0} mudou o esforço", actor), detail };
    }
    case "roomAccessRequested":
      return subject === "" ? single() : { title: t("{0} quer entrar em {1}", actor, subject), detail: t("Cômodo privado") };
    case "cycleTurned": {
      if (subject === "") return single();
      const who = list([t("Você"), ...notification.names.map(shortName)], ctx.locale);
      const detail = notification.dueAt === null ? null : t("{0} até {1}", who, untilText(ctx, notification.dueAt, notification.createdAt));
      return { title: t("Novo ciclo: {0}", subject), detail };
    }
    case "weeklySummaryReady":
      return { title: t("Resumo da semana pronto"), detail: t("Veja como ficaram os cômodos.") };
    default:
      return single();
  }
}

/** Chave do ícone em `NOTIFICATION_SYMBOLS` (components/icons). */
export function notificationIcon(kind: NotificationKind): string {
  switch (kind) {
    case "taskEdited": return "pencil";
    case "taskDeleted": case "roomDeleted": return "trash";
    case "effortChanged": return "bolt";
    case "taskSwapRequested": return "swap";
    case "taskSwapAccepted": case "roomAccessApproved": return "check";
    case "taskSwapRejected": case "roomAccessDenied": return "x";
    case "memberJoined": return "join";
    case "memberLeft": return "leave";
    case "roomAccessRequested": return "unlock";
    case "cycleTurned": return "cycle";
    case "weeklySummaryReady": return "summary";
  }
}

export function notificationTint(kind: NotificationKind): NotificationTint {
  switch (kind) {
    case "taskEdited": case "effortChanged": return "orange";
    case "taskSwapRequested": case "roomAccessRequested": return "accent";
    case "taskSwapAccepted": case "roomAccessApproved": case "memberJoined": return "green";
    case "taskSwapRejected": case "roomAccessDenied": case "memberLeft": return "gray";
    case "taskDeleted": case "roomDeleted": return "red";
    case "cycleTurned": case "weeklySummaryReady": return "blue";
  }
}

export const TINT_COLORS: Readonly<Record<NotificationTint, string>> = {
  accent: "var(--accent-fill)", orange: "var(--room-orange)", green: "var(--room-green)", gray: "var(--room-gray)",
  red: "var(--room-red)", blue: "var(--room-blue)",
};

/** Para onde o toque leva, quando o aviso aponta para algo que ainda existe. */
export function notificationTarget(notification: AppNotification): NotificationTarget | null {
  switch (notification.kind) {
    case "taskEdited": case "effortChanged":
      return notification.taskDefinitionID === null ? null : { kind: "task", id: notification.taskDefinitionID.toLowerCase() };
    case "roomAccessRequested": case "roomAccessApproved": case "cycleTurned":
      return notification.roomID === null ? null : { kind: "room", id: notification.roomID.toLowerCase() };
    default:
      return null;
  }
}

export function targetHref(target: NotificationTarget): string {
  return target.kind === "task" ? `/app/tasks/${target.id}` : `/app/rooms/${target.id}`;
}

export interface NotificationDay { readonly title: string; readonly notifications: readonly AppNotification[] }

/** "Hoje", "Ontem" e depois a data, do mais recente ao mais antigo (desempate pelo id). */
export function notificationDays(ctx: TextContext, notifications: readonly AppNotification[], now: number): NotificationDay[] {
  const sorted = [...notifications].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const days: { title: string; notifications: AppNotification[] }[] = [];
  for (const notification of sorted) {
    const offset = calendarDays(now, notification.createdAt, ctx.timeZone);
    const title = offset === 0 ? ctx.t("Hoje") : offset === -1 ? ctx.t("Ontem") : dayMonth(notification.createdAt, ctx.locale, ctx.timeZone, "long");
    const last = days[days.length - 1];
    if (last !== undefined && last.title === title) last.notifications.push(notification);
    else days.push({ title, notifications: [notification] });
  }
  return days;
}

/** "há 5 minutos", "ontem": tempo desde o pedido (o `.relative(presentation: .named)` do app). */
export function elapsed(ctx: TextContext, at: number, now: number): string {
  const format = new Intl.RelativeTimeFormat(ctx.locale, { numeric: "auto" });
  const seconds = Math.round((at - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return format.format(Math.round(seconds / 86_400), "day");
  return format.format(Math.round(seconds / (7 * 86_400)), "week");
}
