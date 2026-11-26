"use client";

import { useQuery } from "@tanstack/react-query";
import { Sheet } from "@/components/sheet";
import { ErrorState, Spinner } from "@/components/ui";
import { useT } from "@/i18n/provider";
import type { RatingSummary, RoomRatingSummary } from "@/lib/api/types";
import { house as houseAPI } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { keys } from "@/lib/client/queries";
import { list } from "@/lib/format/dates";
import { shortName } from "@/lib/format/names";
import { useHouse, useTextContext } from "../house-context";
import { RoomIcon } from "@/components/icons";
import { Card, type RoomLook } from "./parts";
import { isImprovement, levelTitle, period, ratingCount, tagTitle } from "./text";

export function useRatingSummary(enabled = true) {
  return useQuery({ queryKey: keys.ratingSummary, queryFn: houseAPI.ratingSummary, enabled });
}

/** "Resumo da semana" pronto para os cômodos do morador (`WeekSummary.hasResultForMyRooms`). */
export const hasResultForMyRooms = (summary: RatingSummary): boolean => summary.mine.some((room) => room.level !== null);

export function useRoomLooks(): ReadonlyMap<string, RoomLook> {
  const { snapshot } = useHouse();
  return new Map(snapshot.home.rooms.map((room) => [room.id.toLowerCase(), { icon: room.icon, color: room.color }]));
}

/**
 * "Resumo da semana" (WeekSummarySheet): o período e as tarefas feitas na casa; "Seu cômodo" com o nível, as
 * avaliações e as tags de quem cuidou; e "Casa" com os demais (só nível e contagem). Nunca mostra quem avaliou.
 */
export function WeekSummarySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const summary = useRatingSummary(open);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("Resumo da semana")} cancel={{ label: t("Fechar") }}>
      {summary.isPending ? <Spinner /> : summary.isError
        ? <ErrorState message={errorMessage(t, summary.error)} onRetry={() => void summary.refetch()} />
        : <SummaryContent summary={summary.data} />}
    </Sheet>
  );
}

function SummaryContent({ summary }: { summary: RatingSummary }) {
  const ctx = useTextContext();
  const { t } = ctx;
  const { userID } = useHouse();
  const looks = useRoomLooks();

  const caretakers = (room: RoomRatingSummary): string => list(
    room.responsibleUserIDs.map((id, index) => (id.toLowerCase() === userID ? t("você") : shortName(room.responsibleNames[index] ?? ""))),
    ctx.locale,
  );
  const upcoming = summary.upcoming.map((room) => room.roomName);
  const names = list(upcoming, ctx.locale);
  const note = upcoming.length === 0 ? "" : upcoming.length === 1
    ? t("A {0} entra no resumo quando o ciclo dela terminar.", names)
    : t("{0} entram no resumo quando o ciclo deles terminar.", names);
  const anonymity = t("Ninguém vê quem avaliou.");

  const look = (room: RoomRatingSummary): RoomLook | undefined => looks.get(room.roomID.toLowerCase());
  const roomLine = (room: RoomRatingSummary) => (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {look(room) !== undefined && <RoomIcon icon={look(room)?.icon ?? ""} color={look(room)?.color ?? "gray"} size={32} />}
      <div className="min-w-0 flex-1">
        <p>{room.roomName}</p>
        <p className="text-[15px] text-secondary">{room.level === null ? t("Poucas avaliações para mostrar") : ratingCount(t, room.ratingCount)}</p>
      </div>
      <span className="text-secondary">{room.level === null ? "—" : levelTitle(t, room.level)}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="font-rounded text-[22px] font-bold">{period(ctx, summary.week.start, summary.week.end)}</h3>
        <p className="text-[15px] text-secondary">{t("{0} de {1} tarefas feitas na casa", summary.week.tasksDone, summary.week.tasksTotal)}</p>
      </div>

      {summary.mine.map((room, index) => {
        const good = room.tags.filter((tag) => !isImprovement(tag));
        const improve = room.tags.filter(isImprovement);
        return (
          <section key={room.roomID} className="flex flex-col gap-2">
            {index === 0 && <h4 className="font-semibold">{summary.mine.length === 1 ? t("Seu cômodo") : t("Seus cômodos")}</h4>}
            <Card>
              {roomLine(room)}
              {(good.length > 0 || improve.length > 0) && (
                <div className="flex flex-col gap-3 px-4 pb-4 pt-1">
                  {good.length > 0 && <TagGroup title={t("O que foi bom")} tags={good.map((tag) => tagTitle(t, tag))} />}
                  {improve.length > 0 && <TagGroup title={t("O que pode melhorar")} tags={improve.map((tag) => tagTitle(t, tag))} />}
                </div>
              )}
            </Card>
            <p className="text-[13px] text-secondary">
              {t("As tags aparecem sem nome e sem contagem. Só quem cuidou do cômodo ({0}) vê esta parte.", caretakers(room))}
            </p>
          </section>
        );
      })}

      {(summary.house.length > 0 || upcoming.length > 0) && (
        <section className="flex flex-col gap-2">
          <h4 className="font-semibold">{t("Casa")}</h4>
          {summary.house.length > 0 && (
            <Card className="overflow-hidden [&>*+*]:border-t [&>*+*]:border-separator">
              {summary.house.map((room) => <div key={room.roomID}>{roomLine(room)}</div>)}
            </Card>
          )}
          <p className="text-[13px] text-secondary">{note === "" ? anonymity : `${anonymity} ${note}`}</p>
        </section>
      )}
    </div>
  );
}

function TagGroup({ title, tags }: { title: string; tags: readonly string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-semibold uppercase text-secondary">{title}</p>
      <ul className="flex flex-wrap gap-2">
        {tags.map((tag) => <li key={tag} className="flex h-8 items-center rounded-full bg-fill px-3 text-[15px]">{tag}</li>)}
      </ul>
    </div>
  );
}
