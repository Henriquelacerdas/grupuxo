"use client";

import { useMutation } from "@tanstack/react-query";
import { Ellipsis, ListOrdered, Plus, Settings, SquarePlus, ListChecks, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Menu } from "@/components/sheet";
import { EmptyState, PageTitle } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useT } from "@/i18n/provider";
import type { Room } from "@/lib/api/types";
import { rooms as roomsAPI } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { useInvalidateHouse, useNow } from "@/lib/client/queries";
import { deadline, responsibles } from "@/lib/format/labels";
import { roomOverviews, type RoomOverview } from "@/lib/rules/tasks";
import { RoomSheet } from "../rooms/room-sheet";
import { TaskSheet } from "../tasks/task-sheet";
import { useHouse, useTextContext } from "../house-context";
import { shareInvite } from "./invite";
import { applyRoomOrder, loadOrder, saveOrder } from "./order";
import { ReorderSheet } from "./reorder-sheet";
import { RestrictedRoomCard, RoomCard, SporadicCard } from "./room-cards";

/** Aba Casa (HouseManagementView): tarefas únicas, cômodos e o menu de criar. */
export function HousePage() {
  const t = useT();
  const ctx = useTextContext();
  const toast = useToast();
  const router = useRouter();
  const now = useNow();
  const invalidate = useInvalidateHouse();
  const { snapshot, house, userID } = useHouse();

  const [creatingTask, setCreatingTask] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [order, setOrder] = useState<readonly string[]>(() => (typeof window === "undefined" ? [] : loadOrder(house.id)));
  const [busyRoomIDs, setBusyRoomIDs] = useState<ReadonlySet<string>>(new Set());

  const overviews = useMemo(
    () => applyRoomOrder(roomOverviews(snapshot).map((overview) => ({ ...overview, id: overview.participation.room.id })), (row) => row.participation.isMember, order),
    [snapshot, order],
  );
  const roomsByID = useMemo(() => new Map(snapshot.home.rooms.map((room) => [room.id, room])), [snapshot]);
  const memberRooms = overviews.filter((row) => row.participation.isMember).map((row) => row.participation.room);

  const access = useMutation({
    mutationFn: ({ roomID, cancel }: { roomID: string; cancel: boolean }) => (cancel ? roomsAPI.cancelAccess(roomID) : roomsAPI.requestAccess(roomID)),
    onMutate: ({ roomID }) => setBusyRoomIDs((ids) => new Set(ids).add(roomID)),
    onSettled: async (_data, error, { roomID }) => {
      if (error !== null) toast(errorMessage(t, error), "error");
      await invalidate();
      setBusyRoomIDs((ids) => { const next = new Set(ids); next.delete(roomID); return next; });
    },
  });

  const invite = async () => {
    const result = await shareInvite(t, house);
    if (result === "copied") toast(t("Convite copiado"));
    else if (result === "failed") toast(t("Não foi possível copiar o convite."), "error");
  };

  const onCreatedRoom = (room: Room) => {
    void invalidate();
    router.push(`/app/rooms/${room.id.toLowerCase()}`);
  };

  return (
    <>
      <PageTitle
        title={t("Casa")}
        subtitle={house.name}
        actions={(
          <>
            <Menu
              label={t("Adicionar")}
              trigger={<span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent-fill text-on-accent"><Plus aria-hidden="true" size={22} strokeWidth={2.5} /></span>}
              items={[
                { label: t("Nova tarefa"), icon: ListChecks, onSelect: () => setCreatingTask(true) },
                { label: t("Novo cômodo"), icon: SquarePlus, onSelect: () => setCreatingRoom(true) },
              ]}
            />
            <Menu
              label={t("Mais opções")}
              trigger={<Ellipsis aria-hidden="true" size={24} />}
              items={[
                { label: t("Reordenar cômodos"), icon: ListOrdered, onSelect: () => setReordering(true), disabled: memberRooms.length < 2 },
                { label: t("Convidar pessoas"), icon: UserPlus, onSelect: () => void invite() },
                { label: t("Ajustes da casa"), icon: Settings, onSelect: () => router.push("/app/house/settings") },
              ]}
            />
          </>
        )}
      />

      <div className="flex flex-col gap-3">
        <SporadicCard tasks={snapshot.sporadicTasks} rooms={roomsByID} />

        <h2 className="mt-3 font-rounded text-[20px] font-bold">{t("Cômodos")}</h2>

        {overviews.length === 0 ? (
          <EmptyState title={t("Nenhum cômodo ainda")} message={t("Crie o primeiro cômodo para começar o rodízio da casa.")} />
        ) : (
          overviews.map((row) => renderRow(row))
        )}
      </div>

      <TaskSheet open={creatingTask} onOpenChange={setCreatingTask} />
      <RoomSheet open={creatingRoom} onOpenChange={setCreatingRoom} onCreated={onCreatedRoom} />
      <ReorderSheet
        open={reordering}
        onOpenChange={setReordering}
        rooms={memberRooms}
        onSave={(ids) => { setOrder(ids); saveOrder(house.id, ids); }}
      />
    </>
  );

  function renderRow(row: RoomOverview & { id: string }) {
    const { room } = row.participation;
    if (!row.participation.isMember) {
      return (
        <RestrictedRoomCard
          key={room.id}
          room={room}
          requestPending={row.accessRequestPending}
          busy={busyRoomIDs.has(room.id)}
          onRequest={() => access.mutate({ roomID: room.id, cancel: false })}
          onCancel={() => access.mutate({ roomID: room.id, cancel: true })}
        />
      );
    }
    return (
      <RoomCard
        key={room.id}
        room={room}
        responsibles={responsibles(ctx, row.responsibleNames, row.responsibleUserIDs.map((id) => id.toLowerCase()), userID)}
        deadline={deadline(ctx, row.participation.periodEnd, now)}
        progress={row.progress ?? { completed: 0, total: 0 }}
      />
    );
  }
}
