"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, ClipboardList, Star, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/ui";
import { house as houseAPI } from "@/lib/client/endpoints";
import { keys, useNow } from "@/lib/client/queries";
import { useHouse, useTextContext } from "../house-context";
import { RateWeekSheet } from "./rate-week-sheet";
import { submittedUntil } from "./storage";
import { closing, summaryComes } from "./text";
import { WeekSummarySheet, hasResultForMyRooms, useRatingSummary, useRoomLooks } from "./week-summary-sheet";

/**
 * Topo de Minhas tarefas (WeekRatingSection + WeekRatingSheetHost): "Avaliar a semana · Termina terça" enquanto a
 * avaliação está aberta, "Avaliação enviada · O resumo sai terça" depois de enviar e "Resumo da semana" quando o
 * resultado sai. Como no app, a sheet abre pelo cartão (não sozinha). Falha na carga não atrapalha a tela: o cartão
 * só não aparece.
 */
export function WeekRatingHost() {
  const ctx = useTextContext();
  const { t } = ctx;
  const { house, userID } = useHouse();
  const now = useNow();
  const looks = useRoomLooks();
  const pendingQuery = useQuery({ queryKey: keys.pendingRatings, queryFn: houseAPI.pendingRatings });
  const summaryQuery = useRatingSummary();
  const [rating, setRating] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const pending = pendingQuery.data ?? [];
  const hasPending = pending.length > 0;
  const hasSummary = summaryQuery.data !== undefined && hasResultForMyRooms(summaryQuery.data);
  const sentUntil = submittedUntil(house.id, userID, now);
  const closesAt = hasPending ? Math.min(...pending.map((item) => item.windowEnd)) : null;

  if (!hasPending && !hasSummary && sentUntil === null && !rating && !summaryOpen) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {hasPending && (
        <RatingCard icon={Star} title={t("Avaliar a semana")} subtitle={closesAt === null ? null : closing(ctx, closesAt)} active onSelect={() => setRating(true)} />
      )}
      {!hasPending && !hasSummary && sentUntil !== null && (
        <RatingCard icon={Check} title={t("Avaliação enviada")} subtitle={summaryComes(ctx, sentUntil)} active={false} />
      )}
      {hasSummary && (
        <RatingCard icon={ClipboardList} title={t("Resumo da semana")} subtitle={t("Veja como ficaram os cômodos")} active onSelect={() => setSummaryOpen(true)} />
      )}
      <RateWeekSheet open={rating} onOpenChange={setRating} pending={pending} looks={looks} />
      <WeekSummarySheet open={summaryOpen} onOpenChange={setSummaryOpen} />
    </div>
  );
}

function RatingCard({ icon: Icon, title, subtitle, active, onSelect }: {
  icon: LucideIcon; title: string; subtitle: string | null; active: boolean; onSelect?: () => void;
}) {
  const body = (
    <>
      <span aria-hidden="true" className={cx("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full", active ? "bg-accent-fill text-on-accent" : "bg-fill text-secondary")}>
        <Icon size={17} strokeWidth={2.5} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block font-semibold">{title}</span>
        {subtitle !== null && <span className="block text-[15px] text-secondary">{subtitle}</span>}
      </span>
      {onSelect !== undefined && <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-muted" />}
    </>
  );
  const classes = "flex w-full items-center gap-3 rounded-[var(--radius-card)] bg-card px-4 py-3";
  return onSelect === undefined
    ? <div className={classes}>{body}</div>
    : <button type="button" onClick={onSelect} className={cx(classes, "transition hover:bg-fill")}>{body}</button>;
}
