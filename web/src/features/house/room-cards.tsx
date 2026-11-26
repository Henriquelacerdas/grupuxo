"use client";

import { ChevronRight, Clock, Flag, LoaderCircle, Lock, LockOpen, Repeat } from "lucide-react";
import Link from "next/link";
import { RoomIcon, roomColorVar } from "@/components/icons";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/provider";
import type { Room, TaskItem } from "@/lib/api/types";
import type { CycleProgress } from "@/lib/format/labels";
import { progressText } from "@/lib/format/labels";
import { useTextContext } from "../house-context";

const cardClass = "block rounded-[var(--radius-card)] bg-card px-5 py-4 shadow-[var(--shadow)]";

/** Cômodo de que o morador participa: responsáveis, prazo e progresso do ciclo (RoomCard). */
export function RoomCard({ room, responsibles, deadline, progress }: {
  room: Room; responsibles: string | null; deadline: string; progress: CycleProgress;
}) {
  const t = useT();
  const ctx = useTextContext();
  const progressLabel = progressText(ctx, progress);
  const fraction = progress.total === 0 ? 0 : progress.completed / progress.total;
  return (
    <Link href={`/app/rooms/${room.id.toLowerCase()}`} className={`${cardClass} transition hover:brightness-[0.98]`} aria-label={room.name}>
      <div className="flex items-center gap-4">
        <RoomIcon icon={room.icon} color={room.color} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-rounded text-[20px] font-bold">{room.name}</span>
            {room.visibility === "privateRoom" && <LockOpen aria-label={t("Cômodo privado")} size={16} className="shrink-0 text-secondary" />}
            <ChevronRight aria-hidden="true" size={20} className="shrink-0 text-secondary" />
          </div>
          {responsibles !== null && (
            <p className="mt-0.5 flex items-baseline gap-2">
              <Repeat aria-hidden="true" size={16} className="relative top-[3px] w-[22px] shrink-0" />
              <span className="sr-only">{t("Responsáveis: {0}", responsibles)}</span>
              <span aria-hidden="true">{responsibles}</span>
            </p>
          )}
          <p className="mt-0.5 flex items-baseline gap-2 text-secondary">
            <Clock aria-hidden="true" size={16} className="relative top-[3px] w-[22px] shrink-0" />
            <span>{deadline}</span>
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill" aria-hidden="true">
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(fraction * 100)}%`, background: roomColorVar(room.color) }} />
        </div>
        <span className="shrink-0 text-[12px] text-secondary">{progressLabel}</span>
      </div>
    </Link>
  );
}

/** Cômodo privado de que o morador não participa: cadeado e pedido de entrada (RestrictedRoomCard). */
export function RestrictedRoomCard({ room, requestPending, busy, onRequest, onCancel }: {
  room: Room; requestPending: boolean; busy: boolean; onRequest: () => void; onCancel: () => void;
}) {
  const t = useT();
  return (
    <div className={cardClass} aria-label={room.name} role="group">
      <div className="flex items-center gap-4">
        <RoomIcon icon={room.icon} color={room.color} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-rounded text-[20px] font-bold">{room.name}</p>
          <p className="mt-0.5 flex items-baseline gap-2 text-secondary">
            <Lock aria-hidden="true" size={16} className="relative top-[3px] w-[22px] shrink-0" />
            <span>{t("Cômodo Privado")}</span>
          </p>
        </div>
      </div>
      {requestPending ? (
        <button
          type="button"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={onCancel}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-fill px-5 text-[17px] font-semibold text-label transition hover:bg-fill-strong disabled:opacity-50"
        >
          {busy && <LoaderCircle aria-hidden="true" size={18} className="animate-spin" />}
          {t("Cancelar solicitação")}
        </button>
      ) : (
        <Button variant="secondary" className="mt-3 w-full" loading={busy} onClick={onRequest}>{t("Pedir para entrar")}</Button>
      )}
    </div>
  );
}

const SPORADIC_MAX_ROWS = 3;

/** Card "Tarefas Únicas": até 3 linhas, com "+N Outras" quando sobra (SporadicTasksCard). */
export function SporadicCard({ tasks, rooms }: { tasks: readonly TaskItem[]; rooms: ReadonlyMap<string, Room> }) {
  const t = useT();
  const shown = tasks.length > SPORADIC_MAX_ROWS ? tasks.slice(0, SPORADIC_MAX_ROWS - 1) : tasks.slice(0, SPORADIC_MAX_ROWS);
  const overflow = tasks.length - shown.length;
  return (
    <Link href="/app/sporadic" className={`${cardClass} transition hover:brightness-[0.98]`} aria-label={t("Tarefas únicas")}>
      <div className="flex items-center gap-3">
        <span className="flex w-8 justify-center"><Flag aria-hidden="true" size={20} className="text-[var(--room-red)]" fill="currentColor" /></span>
        <span className="flex-1 font-rounded text-[20px] font-bold">{t("Tarefas Únicas")}</span>
        <ChevronRight aria-hidden="true" size={20} className="text-secondary" />
      </div>
      {tasks.length === 0 ? (
        <p className="mt-3 text-[15px] text-secondary">{t("Nenhuma tarefa única no momento.")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {shown.map((item) => {
            const room = rooms.get(item.definition.roomID);
            return (
              <li key={item.occurrence.id} className="flex items-center gap-3">
                <RoomIcon icon={room?.icon ?? "house.fill"} color={room?.color ?? "gray"} size={32} />
                <span className="truncate">{item.definition.name}</span>
              </li>
            );
          })}
          {overflow > 0 && (
            <li className="flex items-center gap-3">
              <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: roomColorVar("gray") }}>
                +{overflow}
              </span>
              <span className="sr-only">{t("e mais {0}", overflow)}</span>
              <span aria-hidden="true">{t("Outras")}</span>
            </li>
          )}
        </ul>
      )}
    </Link>
  );
}

