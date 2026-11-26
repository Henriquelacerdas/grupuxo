"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CalendarClock, Check, ChevronLeft, ChevronRight, CircleCheck, CircleUser, Ellipsis, Flag, ListChecks, LogOut, Pencil, Plus, Repeat, Trash2, UserCheck, Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { roomColorVar } from "@/components/icons";
import { ConfirmDialog, Menu, type MenuItem } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { Avatar, Button, EmptyState, ErrorState, IconButton, Section, Segmented, Spinner } from "@/components/ui";
import { useT } from "@/i18n/provider";
import type { RoomParticipation, TaskItem } from "@/lib/api/types";
import { rooms as roomsAPI, tasks as tasksAPI } from "@/lib/client/endpoints";
import { ApiError, errorMessage } from "@/lib/client/http";
import { keys, useInvalidateHouse, useNow } from "@/lib/client/queries";
import { cycleDuration, deadline, participantsText, responsibles, rotation, singleTaskStatus, taskSubtitle, effortName, timing } from "@/lib/format/labels";
import { shortName } from "@/lib/format/names";
import { canClaim, canComplete, canEnd, isCompleted, isWholeHouse } from "@/lib/rules/tasks";
import { TaskSheet } from "../tasks/task-sheet";
import { useHouse, useTextContext } from "../house-context";
import { cycleAssignees, roomSections, sectionsEmpty, type RoomTaskFilter } from "./detail-sections";
import { RoomSheet } from "./room-sheet";

/** Tela do cômodo (RoomDetailView): rodízio, tarefas "Agora"/"Todas" e as ações do cômodo. */
export function RoomDetail({ roomID }: { roomID: string }) {
  const t = useT();
  const { snapshot } = useHouse();
  const id = roomID.toLowerCase();
  const fromSnapshot = snapshot.participations.find((p) => p.room.id.toLowerCase() === id);
  const participation = useQuery({
    queryKey: keys.room(id),
    queryFn: () => roomsAPI.get(id),
    ...(fromSnapshot === undefined ? {} : { placeholderData: fromSnapshot }),
  });

  if (participation.isPending) return <Spinner label={t("Carregando cômodo…")} />;
  if (participation.isError) {
    const notFound = participation.error instanceof ApiError && participation.error.status === 404;
    return (
      <>
        <BackLink />
        {notFound
          ? <EmptyState title={t("Item não encontrado.")} action={<Link className="text-accent" href="/app/house">{t("Casa")}</Link>} />
          : <ErrorState message={errorMessage(t, participation.error)} onRetry={() => void participation.refetch()} />}
      </>
    );
  }
  return <RoomContent participation={participation.data} />;
}

function BackLink() {
  const t = useT();
  return (
    <Link href="/app/house" className="-ml-2 inline-flex min-h-[44px] items-center gap-0.5 px-2 text-[17px] text-accent">
      <ChevronLeft aria-hidden="true" size={22} />
      {t("Casa")}
    </Link>
  );
}

type Dialog =
  | { readonly kind: "leave" }
  | { readonly kind: "leaveAndDelete" }
  | { readonly kind: "deleteRoom" }
  | { readonly kind: "endTask"; readonly item: TaskItem };

function RoomContent({ participation }: { participation: RoomParticipation }) {
  const t = useT();
  const ctx = useTextContext();
  const toast = useToast();
  const router = useRouter();
  const now = useNow();
  const invalidate = useInvalidateHouse();
  const { snapshot, userID, house, memberNames } = useHouse();
  const { room } = participation;
  const isMember = participation.isMember;
  const wholeHouse = isWholeHouse(room);

  const [filter, setFilter] = useState<RoomTaskFilter>("now");
  const [showDetails, setShowDetails] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [editingRoom, setEditingRoom] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const tasks = useQuery({ queryKey: keys.roomTasks(room.id.toLowerCase()), queryFn: () => roomsAPI.tasks(room.id) });
  const requests = useQuery({
    queryKey: keys.accessRequests(room.id.toLowerCase()),
    queryFn: () => roomsAPI.accessRequests(room.id),
    enabled: isMember && room.visibility === "privateRoom",
  });

  const fail = (error: unknown) => toast(errorMessage(t, error), "error");
  const action = useMutation({
    mutationFn: async (run: () => Promise<void>) => run(),
    onSuccess: () => invalidate(),
    onError: fail,
  });
  const busy = action.isPending;

  const leave = (confirmDeletion: boolean) => action.mutate(async () => {
    try {
      await roomsAPI.leave(room.id, userID, confirmDeletion);
    } catch (error) {
      if (error instanceof ApiError && error.code === "room_deletion_confirmation_required") { setDialog({ kind: "leaveAndDelete" }); return; }
      throw error;
    }
    if (confirmDeletion) router.push("/app/house");
  });
  const deleteRoom = () => action.mutate(async () => {
    await roomsAPI.remove(room.id);
    router.push("/app/house");
  });

  const assignees = cycleAssignees(room, tasks.data ?? []);
  const nowSummary = assignees.length > 0
    ? responsibles(ctx, assignees.map((u) => u.name), assignees.map((u) => u.id.toLowerCase()), userID)
    : responsibles(ctx, participation.responsibleNames, [], userID);
  const nextSummary = responsibles(ctx, participation.nextResponsibleNames, [], userID);
  const sporadic = snapshot.sporadicTasks;
  const sections = roomSections(room, tasks.data ?? [], sporadic, filter, now, house.timezone);

  const menuItems: (MenuItem | "separator")[] = [
    { label: t("Editar cômodo"), icon: Pencil, onSelect: () => setEditingRoom(true) },
    { label: t("Sair do rodízio"), icon: LogOut, destructive: true, disabled: busy, onSelect: () => setDialog(participation.memberCount <= 1 ? { kind: "leaveAndDelete" } : { kind: "leave" }) },
    "separator",
    { label: t("Excluir cômodo"), icon: Trash2, destructive: true, disabled: busy, onSelect: () => setDialog({ kind: "deleteRoom" }) },
  ];

  const rowActions = (item: TaskItem, single: boolean): MenuItem[] => {
    const items: MenuItem[] = [];
    if (!single && canComplete(item, userID, now)) {
      items.push({
        label: isCompleted(item) ? t("Reabrir") : t("Concluir"),
        icon: CircleCheck,
        disabled: busy,
        onSelect: () => action.mutate(() => (isCompleted(item) ? tasksAPI.reopen(item.occurrence.id) : tasksAPI.complete(item.occurrence.id))),
      });
    }
    if (!single && isMember && canEnd(item.definition)) {
      items.push({ label: t("Apagar"), icon: Trash2, destructive: true, onSelect: () => setDialog({ kind: "endTask", item }) });
    }
    return items;
  };

  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none absolute -inset-x-4 -top-24 h-72 opacity-60 lg:-inset-x-10" style={{ background: `linear-gradient(to bottom, ${roomColorVar(room.color)}, transparent)` }} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <BackLink />
          <div className="flex items-center gap-1">
            {isMember && <IconButton label={t("Nova tarefa")} icon={Plus} onClick={() => setCreatingTask(true)} />}
            {isMember && !wholeHouse && <Menu label={t("Mais opções do cômodo")} trigger={<Ellipsis aria-hidden="true" size={24} />} items={menuItems} />}
          </div>
        </div>
        <header className="mb-5 mt-1">
          <h1 className="font-rounded text-[34px] font-bold leading-tight tracking-tight">{room.name}</h1>
          <p className="font-rounded text-[20px] text-secondary">{rotation(t, room.periodicity)}</p>
        </header>

        <Section>
          <button
            type="button"
            onClick={() => setShowDetails((shown) => !shown)}
            aria-expanded={showDetails}
            className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-fill"
          >
            <Repeat aria-hidden="true" size={22} className="w-11 shrink-0" style={{ color: roomColorVar(room.color) }} />
            <span className="min-w-0 flex-1">
              <span className="block font-rounded text-[17px] font-semibold">
                {nowSummary ?? (room.visibility === "common" ? t("Todos os moradores") : t("Cômodo privado"))}
              </span>
              <span className="block text-[15px] text-secondary">{deadline(ctx, participation.periodEnd, now)}</span>
            </span>
            <ChevronRight aria-hidden="true" size={20} className="shrink-0 transition-transform" style={{ color: roomColorVar(room.color), transform: showDetails ? "rotate(90deg)" : undefined }} />
            <span className="sr-only">{t("Mostra os detalhes do rodízio")}</span>
          </button>
        </Section>

        {showDetails && (
          <Section>
            <DetailRow icon={<Repeat size={18} />} title={t("Ciclo")} value={cycleDuration(t, room.periodicity)} />
            {nowSummary !== null && <DetailRow icon={<UserCheck size={18} />} title={t("Agora")} value={nowSummary} />}
            {nextSummary !== null && <DetailRow icon={<CalendarClock size={18} />} title={t("Depois")} value={nextSummary} />}
            <DetailRow
              icon={<Users size={18} />}
              title={t("Participantes")}
              value={room.visibility === "common" ? t("{0} pessoas", participation.memberCount) : participantsText(t, room, participation.memberCount)}
            />
          </Section>
        )}

        {!isMember && (
          <Section>
            <p className="px-4 py-3 text-secondary">{t("Entre para consultar e criar tarefas neste cômodo.")}</p>
            <div className="px-4 py-2">
              <Button variant="plain" className="-ml-5" loading={busy} onClick={() => action.mutate(() => roomsAPI.join(room.id, userID))}>{t("Entrar no cômodo")}</Button>
            </div>
          </Section>
        )}

        {isMember && room.visibility === "privateRoom" && (requests.data?.length ?? 0) > 0 && (
          <Section title={t("Pedidos para entrar")}>
            {(requests.data ?? []).map((request) => {
              const name = memberNames.get(request.userID.toLowerCase()) ?? t("Alguém");
              return (
                <div key={request.userID} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                  <Avatar name={name} />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <Button size="small" variant="secondary" disabled={busy} onClick={() => action.mutate(() => roomsAPI.approve(room.id, request.userID))}>{t("Aceitar")}</Button>
                  <Button size="small" variant="plain" disabled={busy} onClick={() => action.mutate(() => roomsAPI.deny(room.id, request.userID))}>{t("Recusar")}</Button>
                </div>
              );
            })}
          </Section>
        )}

        {isMember && (
          <div className="mb-5">
            <Segmented label={t("Exibição de tarefas")} value={filter} onChange={setFilter} options={[{ value: "now", label: t("Agora") }, { value: "all", label: t("Todas") }]} />
          </div>
        )}

        {tasks.isPending ? (
          <Spinner label={t("Carregando cômodo…")} />
        ) : tasks.isError && isMember ? (
          <ErrorState message={errorMessage(t, tasks.error)} onRetry={() => void tasks.refetch()} />
        ) : sectionsEmpty(sections) ? (
          <EmptyState icon={ListChecks} title={t("Nenhuma tarefa aqui")} message={t("Adicione a primeira em “+” ou escolha uma sugestão na aba Todas.")} />
        ) : (
          <>
            {sections.cycle.length > 0 && (
              <Section title={t("Repetição do cômodo")}>
                {sections.cycle.map((item) => (
                  <TaskRow key={item.occurrence.id} item={item} actions={rowActions(item, false)}>
                    {filter === "now"
                      ? <CycleLine item={item} timingText={startTiming(item)} />
                      : <span className="text-[15px] text-secondary">{effortName(t, item.definition.effort)}</span>}
                  </TaskRow>
                ))}
              </Section>
            )}
            {sections.general.length > 0 && (
              <Section title={t("Repetição própria")}>
                {sections.general.map((item) => (
                  <TaskRow key={item.occurrence.id} item={item} actions={rowActions(item, false)}>
                    {filter === "now"
                      ? <CycleLine item={item} timingText={isCompleted(item) ? null : timing(ctx, item.occurrence.availableAt, item.occurrence.dueAt, now)?.text ?? null} />
                      : (
                        <span className="flex items-center gap-1 text-[15px] text-secondary">
                          <Repeat aria-label={t("Repetição própria")} size={14} />
                          {taskSubtitle(t, item.definition, true)}
                        </span>
                      )}
                  </TaskRow>
                ))}
              </Section>
            )}
            {sections.single.length > 0 && (
              <Section title={t("Tarefas únicas")}>
                {sections.single.map((item) => (
                  <SingleRow
                    key={item.occurrence.id}
                    item={item}
                    status={singleTaskStatus(t, item, userID)}
                    onClaim={canClaim(item, isMember) && item.definition.endedAt === null
                      ? () => action.mutate(() => tasksAPI.claim(item.occurrence.id))
                      : null}
                    busy={busy}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </div>

      <TaskSheet open={creatingTask} onOpenChange={setCreatingTask} roomID={room.id} />
      <RoomSheet open={editingRoom} onOpenChange={setEditingRoom} editing={room} />

      <ConfirmDialog
        open={dialog?.kind === "leave"}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        title={t("Sair do rodízio de “{0}”?", room.name)}
        message={t("Você continua com as tarefas desta semana até domingo. Depois, o rodízio segue só entre os outros.")}
        actions={[{ label: t("Sair"), destructive: true, onSelect: () => leave(false) }]}
      />
      <ConfirmDialog
        open={dialog?.kind === "leaveAndDelete"}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        title={t("Sair e excluir cômodo?")}
        message={t("Atenção: Você é o último participante desse cômodo. Se sair, o cômodo e suas tarefas serão excluídos.")}
        actions={[{ label: t("Sair e excluir"), destructive: true, onSelect: () => leave(true) }]}
      />
      <ConfirmDialog
        open={dialog?.kind === "deleteRoom"}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        title={t("Excluir {0}?", room.name)}
        message={t("O cômodo, as tarefas e o histórico dele serão excluídos para todos. Não dá para desfazer.")}
        actions={[{ label: t("Excluir cômodo"), destructive: true, onSelect: deleteRoom }]}
      />
      <ConfirmDialog
        open={dialog?.kind === "endTask"}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        title={t("Apagar tarefa?")}
        {...(dialog?.kind === "endTask" ? { message: t("{0} não será mais repetida. O histórico fica, e a vez atual continua até ser concluída.", dialog.item.definition.name) } : {})}
        actions={[{
          label: t("Apagar"),
          destructive: true,
          onSelect: () => { if (dialog?.kind === "endTask") { const { definition } = dialog.item; action.mutate(() => tasksAPI.end(definition.roomID, definition.id)); } },
        }]}
      />
    </div>
  );

  /** Nas tarefas do ciclo o prazo já está no cartão: só "Começa sábado", quando a vez ainda não abriu. */
  function startTiming(item: TaskItem): string | null {
    if (isCompleted(item)) return null;
    const value = timing(ctx, item.occurrence.availableAt, item.occurrence.dueAt, now);
    return value?.style === "upcoming" ? value.text : null;
  }
}

function DetailRow({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return (
    <div className="flex min-h-[48px] items-center gap-3 px-4 py-2.5">
      <span aria-hidden="true" className="text-accent">{icon}</span>
      <span className="flex-1">{title}</span>
      <span className="text-right text-secondary">{value}</span>
    </div>
  );
}

function TaskRow({ item, actions, children }: { item: TaskItem; actions: readonly MenuItem[]; children: ReactNode }) {
  const t = useT();
  return (
    <div className="flex min-h-[56px] items-center">
      <Link href={`/app/tasks/${item.definition.id.toLowerCase()}`} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2 transition hover:bg-fill">
        <RowAvatar item={item} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{item.definition.name}</span>
          {children}
        </span>
        {actions.length === 0 && <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-muted" />}
      </Link>
      {actions.length > 0 && (
        <div className="pr-2">
          <Menu label={t("Mais opções")} trigger={<Ellipsis aria-hidden="true" size={20} />} items={actions} />
        </div>
      )}
    </div>
  );
}

/** Avatar de quem está com a vez (ou a sugestão), com o check quando feita. */
function RowAvatar({ item }: { item: TaskItem }) {
  const person = item.assignee ?? item.suggestedAssignee;
  return (
    <span aria-hidden="true" className="relative shrink-0">
      {person === null
        ? <CircleUser size={40} strokeWidth={1.25} className="text-secondary" />
        : <Avatar name={person.name} photoURL={person.photoURL} size="row" />}
      {isCompleted(item) && (
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-card bg-[var(--room-gray)] text-white">
          <Check size={9} strokeWidth={4} />
        </span>
      )}
    </span>
  );
}

/** "Feita por você", "Para Julia C.", "Sugestão: Bia" (+ " · Começa sábado"). */
function CycleLine({ item, timingText }: { item: TaskItem; timingText: string | null }) {
  const t = useT();
  const { userID } = useHouse();
  const person = item.assignee ?? item.suggestedAssignee;
  const you = t("você");
  let status: string;
  if (isCompleted(item)) {
    if (item.occurrence.completedByUserID?.toLowerCase() === userID) status = t("Feita por {0}", you);
    else if (person !== null) status = t("Feita por {0}", shortName(person.name));
    else status = t("Feita");
  } else if (item.assignee !== null) {
    status = item.assignee.id.toLowerCase() === userID ? t("Para {0}", you) : t("Para {0}", shortName(item.assignee.name));
  } else if (item.suggestedAssignee !== null) {
    status = t("Sugestão: {0}", shortName(item.suggestedAssignee.name));
  } else {
    status = t("Sem responsável");
  }
  return <span className="block text-[15px] text-secondary">{timingText === null ? status : t("{0} · {1}", status, timingText)}</span>;
}

function SingleRow({ item, status, onClaim, busy }: { item: TaskItem; status: string; onClaim: (() => void) | null; busy: boolean }) {
  const t = useT();
  const open = item.assignment === null && !isCompleted(item);
  return (
    <div className="flex min-h-[56px] items-center">
      <Link href={`/app/tasks/${item.definition.id.toLowerCase()}`} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2 transition hover:bg-fill">
        <span className="flex w-11 shrink-0 justify-center"><Flag aria-hidden="true" size={20} fill="currentColor" className="text-[var(--room-red)]" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{item.definition.name}</span>
          <span className="block text-[15px] text-secondary">{status}</span>
        </span>
        {!open && <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-muted" />}
      </Link>
      {open && (
        <div className="pr-3">
          <Button size="small" variant="secondary" disabled={onClaim === null || busy} onClick={() => onClaim?.()} aria-label={t("Pegar {0}", item.definition.name)}>
            {t("Pegar")}
          </Button>
        </div>
      )}
    </div>
  );
}

