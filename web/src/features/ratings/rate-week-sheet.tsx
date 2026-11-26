"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog, Sheet } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { useT } from "@/i18n/provider";
import { RATING_TAGS, type PendingRating, type RatingLevel, type RatingTag } from "@/lib/api/types";
import { rooms } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { useHouse } from "../house-context";
import { Card, LevelPill, RoomTitle, TagChip, type RoomLook } from "./parts";
import { rememberSubmitted } from "./storage";
import { LEVELS, levelTitle, tagOptions, tagTitle, tagsQuestion } from "./text";

interface Draft { readonly level: RatingLevel | null; readonly tags: ReadonlySet<RatingTag> }
const EMPTY: Draft = { level: null, tags: new Set() };

/**
 * "Avaliar a semana" (RateWeekSheet): um cartão por cômodo com os três níveis e, depois de escolher, as tags
 * opcionais. Fechar não grava; "Enviar" manda só os cômodos com nível escolhido.
 */
export function RateWeekSheet({ open, onOpenChange, pending, looks }: {
  open: boolean; onOpenChange: (open: boolean) => void; pending: readonly PendingRating[]; looks: ReadonlyMap<string, RoomLook>;
}) {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const { house, userID } = useHouse();
  const [drafts, setDrafts] = useState<ReadonlyMap<string, Draft>>(new Map());
  const [failure, setFailure] = useState<string | null>(null);

  const draft = (roomID: string): Draft => drafts.get(roomID) ?? EMPTY;
  const update = (roomID: string, next: Draft) => setDrafts((current) => new Map(current).set(roomID, next));

  const select = (roomID: string, level: RatingLevel) => {
    const allowed = new Set(tagOptions(level));
    // Cada nível tem as suas tags: ao trocar de lado, as marcadas antes saem.
    update(roomID, { level, tags: new Set([...draft(roomID).tags].filter((tag) => allowed.has(tag))) });
  };
  const toggle = (roomID: string, tag: RatingTag) => {
    const current = draft(roomID);
    const tags = new Set(current.tags);
    if (tags.has(tag)) tags.delete(tag);
    else tags.add(tag);
    update(roomID, { ...current, tags });
  };

  const submit = useMutation({
    mutationFn: async () => {
      for (const item of pending) {
        const chosen = draft(item.roomID);
        if (chosen.level === null) continue;
        await rooms.rate(item.roomID, item.periodStartISO, chosen.level, RATING_TAGS.filter((tag) => chosen.tags.has(tag)));
      }
    },
    onSuccess: () => {
      const windowEnd = Math.max(...pending.map((item) => item.windowEnd));
      if (Number.isFinite(windowEnd)) rememberSubmitted(house.id, userID, windowEnd);
      setDrafts(new Map());
      toast(t("Avaliação enviada"));
      onOpenChange(false);
    },
    onError: (error) => setFailure(errorMessage(t, error)),
    onSettled: () => client.invalidateQueries({ queryKey: ["ratings"] }),
  });

  const canSubmit = !submit.isPending && pending.some((item) => draft(item.roomID).level !== null);

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => { if (!submit.isPending) onOpenChange(next); }}
        title={t("Avaliar a semana")}
        cancel={{ label: t("Fechar") }}
        confirm={{ label: t("Enviar"), onSelect: () => submit.mutate(), disabled: !canSubmit, loading: submit.isPending }}
      >
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="font-rounded text-[22px] font-bold">{t("Como ficaram os cômodos?")}</h3>
            <p className="text-[15px] text-secondary">{t("Sua avaliação é anônima. Você não avalia o cômodo que cuidou.")}</p>
          </div>
          {pending.map((item) => {
            const chosen = draft(item.roomID);
            return (
              <Card key={item.roomID} className="flex flex-col gap-3.5 px-4 pb-4 pt-3.5">
                <RoomTitle name={item.roomName} look={looks.get(item.roomID)} />
                <div role="group" aria-label={item.roomName} className="flex flex-wrap gap-2">
                  {LEVELS.map((level) => (
                    <LevelPill key={level} title={levelTitle(t, level)} selected={chosen.level === level} onSelect={() => select(item.roomID, level)} />
                  ))}
                </div>
                {chosen.level !== null && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[13px] text-secondary">{tagsQuestion(t, chosen.level)}</p>
                    <div className="flex flex-wrap gap-x-2">
                      {tagOptions(chosen.level).map((tag) => (
                        <TagChip key={tag} title={tagTitle(t, tag)} selected={chosen.tags.has(tag)} onToggle={() => toggle(item.roomID, tag)} />
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
          <p className="text-[13px] text-secondary">
            {t("Entram só os cômodos cujo ciclo terminou nesta semana. O resultado de cada cômodo só aparece com 2 avaliações ou mais, e ninguém vê quem avaliou.")}
          </p>
        </div>
      </Sheet>
      <ConfirmDialog
        open={failure !== null}
        onOpenChange={(next) => { if (!next) setFailure(null); }}
        title={t("Não foi possível enviar")}
        {...(failure !== null ? { message: failure } : {})}
        actions={[]}
        cancelLabel={t("OK")}
      />
    </>
  );
}

