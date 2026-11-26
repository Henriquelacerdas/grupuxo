"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Check } from "lucide-react";
import { useState } from "react";
import { Sheet } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { Avatar, EmptyState, ErrorState, Section, Spinner } from "@/components/ui";
import { useT } from "@/i18n/provider";
import { swaps, tasks } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { keys, useInvalidateHouse, useNow } from "@/lib/client/queries";
import { effortName, timing } from "@/lib/format/labels";
import { shortName } from "@/lib/format/names";
import { useHouse, useTextContext } from "@/features/house-context";
import { candidateGroups } from "./swap";

/** Pedir troca de uma ocorrência própria (TaskSwapView). `occurrenceID === null` = fechada. */
export function SwapSheet({ occurrenceID, onClose }: { occurrenceID: string | null; onClose: () => void }) {
  if (occurrenceID === null) return null;
  return <SwapSheetContent occurrenceID={occurrenceID} onClose={onClose} />;
}

function SwapSheetContent({ occurrenceID, onClose }: { occurrenceID: string; onClose: () => void }) {
  const t = useT();
  const ctx = useTextContext();
  const toast = useToast();
  const invalidate = useInvalidateHouse();
  const now = useNow();
  const { snapshot } = useHouse();
  const [selected, setSelected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const candidates = useQuery({ queryKey: keys.swapCandidates(occurrenceID), queryFn: () => tasks.swapCandidates(occurrenceID), staleTime: 0 });

  const offered = snapshot.myTasks.find((item) => item.occurrence.id === occurrenceID);
  const roomName = (roomID: string) => snapshot.home.rooms.find((room) => room.id === roomID)?.name;

  const send = async () => {
    if (selected === null || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await swaps.create(occurrenceID, selected);
      toast(t("Pedido de troca enviado"));
      await invalidate();
      onClose();
    } catch (error) {
      setSendError(errorMessage(t, error));
      setSending(false);
    }
  };

  let body;
  if (offered === undefined) {
    body = <ErrorState message={t("A tarefa oferecida não está mais disponível.")} />;
  } else if (candidates.isPending) {
    body = <Spinner label={t("Carregando tarefas…")} />;
  } else if (candidates.isError) {
    body = <ErrorState message={errorMessage(t, candidates.error)} onRetry={() => void candidates.refetch()} />;
  } else {
    const groups = candidateGroups(offered, candidates.data);
    const offeredSummary = [
      roomName(offered.definition.roomID),
      effortName(t, offered.occurrence.effort),
      timing(ctx, offered.occurrence.availableAt, offered.occurrence.dueAt, now)?.text,
    ].filter((part): part is string => part !== undefined).join(" · ");
    body = (
      <>
        <Section title={t("Sua tarefa")}>
          <div className="px-4 py-3">
            <p className="font-rounded text-[17px] font-semibold">{offered.definition.name}</p>
            <p className="text-[15px] text-secondary">{offeredSummary}</p>
          </div>
        </Section>
        {groups.length === 0 && (
          <EmptyState icon={ArrowLeftRight} title={t("Nenhuma troca disponível")} message={t("Não há tarefas que você possa pedir em troca agora.")} />
        )}
        {groups.map((group, index) => (
          <Section
            key={group.effort}
            title={(
              <span className="flex items-center gap-2">
                {effortName(t, group.effort)}
                {group.isSameEffort && <span className="rounded-full bg-accent-fill px-2 py-0.5 text-[11px] font-semibold normal-case text-on-accent">{t("Mesmo esforço")}</span>}
              </span>
            )}
            {...(group.isSameEffort
              ? { footer: t("Trocar por uma tarefa de mesmo esforço é o mais justo.") }
              : index === groups.length - 1 ? { footer: t("A pessoa precisa aceitar. Tarefa do ciclo: a troca vale até o fim do ciclo. Tarefa geral: fica com quem recebeu até ser feita.") } : {})}
          >
            <div role="radiogroup" aria-label={effortName(t, group.effort)} className="[&>*+*]:border-t [&>*+*]:border-separator">
              {group.items.map((candidate) => {
                const isSelected = selected === candidate.occurrence.id;
                const summary = [candidate.assignee === null ? undefined : shortName(candidate.assignee.name), roomName(candidate.definition.roomID)]
                  .filter((part): part is string => part !== undefined).join(" · ");
                return (
                  <button
                    key={candidate.occurrence.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={sending}
                    onClick={() => setSelected(candidate.occurrence.id)}
                    className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-fill"
                  >
                    {candidate.assignee !== null && <Avatar name={candidate.assignee.name} photoURL={candidate.assignee.photoURL} />}
                    <span className="min-w-0 flex-1">
                      <span className="block">{candidate.definition.name}</span>
                      <span className="block text-[15px] text-secondary">{summary}</span>
                    </span>
                    {isSelected && <Check aria-hidden="true" size={20} className="text-accent" strokeWidth={2.5} />}
                  </button>
                );
              })}
            </div>
          </Section>
        ))}
        {sendError !== null && (
          <p role="alert" className="px-4 text-[13px] text-danger">{t("Não foi possível pedir a troca")}: {sendError}</p>
        )}
      </>
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open && !sending) onClose(); }}
      title={t("Pedir troca")}
      cancel={{ label: t("Fechar") }}
      {...(offered !== undefined && candidates.isSuccess ? { confirm: { label: t("Pedir troca"), onSelect: () => void send(), disabled: selected === null, loading: sending } } : {})}
    >
      {body}
    </Sheet>
  );
}
