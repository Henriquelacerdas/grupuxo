"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Share } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { Avatar, Button, Section } from "@/components/ui";
import { useT } from "@/i18n/provider";
import { house as houseAPI } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { useInvalidateHouse } from "@/lib/client/queries";
import { useHouse } from "../house-context";
import { copyText, shareInvite } from "./invite";
import { attemptLeave, firstLeaveStep, type LeaveOptions } from "./leave";

type LeaveDialog = "confirmLeave" | "confirmRooms" | "confirmHouse" | null;

/** Ajustes da casa (HouseSettingsView): nome, convite, moradores e sair da casa. */
export function HouseSettings() {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const router = useRouter();
  const { house, snapshot, userID } = useHouse();
  const members = snapshot.home.members;
  const isLastMember = members.length <= 1;
  const [dialog, setDialog] = useState<LeaveDialog>(null);
  const [copied, setCopied] = useState(false);

  const leave = useMutation({
    mutationFn: (options: LeaveOptions) => attemptLeave(houseAPI.leave, options),
    onSuccess: async (outcome) => {
      if (outcome.kind === "left") {
        // Sem casa, o portão de `/app` mostra o onboarding (criar ou entrar).
        router.push("/app");
        await client.resetQueries({ predicate: (query) => query.queryKey[0] !== "session" });
      } else if (outcome.kind === "failed") {
        toast(errorMessage(t, outcome.error), "error");
      } else {
        setDialog(outcome.kind);
      }
    },
  });

  const copy = async () => {
    if (await copyText(house.accessCode)) setCopied(true);
    else toast(t("Não foi possível copiar o convite."), "error");
  };
  const share = async () => {
    const result = await shareInvite(t, house);
    if (result === "copied") toast(t("Convite copiado"));
    else if (result === "failed") toast(t("Não foi possível copiar o convite."), "error");
  };

  return (
    <>
      <Link href="/app/house" className="-ml-2 inline-flex min-h-[44px] items-center gap-0.5 px-2 text-[17px] text-accent">
        <ChevronLeft aria-hidden="true" size={22} />
        {t("Casa")}
      </Link>
      <h1 className="mb-5 mt-1 font-rounded text-[34px] font-bold leading-tight tracking-tight">{t("Ajustes da casa")}</h1>

      <HouseNameSection key={house.name} houseID={house.id} currentName={house.name} />

      <Section title={t("Convite")} footer={t("Quem tiver o código pode entrar na casa pelo app.")}>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="select-all font-mono text-[24px] font-bold tracking-[0.2em]">{house.accessCode}</p>
            <p className="text-[12px] text-secondary">{t("Código da casa")}</p>
          </div>
          <Button size="small" variant="secondary" onClick={() => void copy()}>{copied ? t("Copiado") : t("Copiar")}</Button>
          <button
            type="button"
            onClick={() => void share()}
            aria-label={t("Compartilhar código")}
            title={t("Compartilhar código")}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-accent transition hover:bg-fill"
          >
            <Share aria-hidden="true" size={20} />
          </button>
        </div>
      </Section>

      <Section title={t("Moradores")} footer={isLastMember ? t("Ninguém entrou ainda. Mande o código acima para quem mora com você.") : undefined}>
        {members.map((member) => {
          const isMe = member.id.toLowerCase() === userID;
          return (
            <div key={member.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
              <Avatar name={member.name} photoURL={member.photoURL} />
              <span className="min-w-0 flex-1 truncate">{isMe ? t("Você") : member.name}</span>
            </div>
          );
        })}
      </Section>

      <Section footer={isLastMember ? t("Você é a única pessoa da casa. Se sair, a casa é apagada.") : t("Ao sair, você deixa todos os cômodos da casa.")}>
        <button
          type="button"
          disabled={leave.isPending}
          onClick={() => setDialog(firstLeaveStep(members.length))}
          className="flex min-h-[48px] w-full items-center justify-center bg-danger-soft px-4 text-[17px] text-danger transition hover:brightness-105 disabled:opacity-50"
        >
          {t("Sair da casa")}
        </button>
      </Section>

      <ConfirmDialog
        open={dialog === "confirmLeave"}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        title={t("Sair da {0}?", house.name)}
        message={t("Ao sair, você deixa todos os cômodos da casa.")}
        actions={[{ label: t("Sair da casa"), destructive: true, onSelect: () => leave.mutate({ confirmRoomDeletion: false, confirmHouseDeletion: false }) }]}
      />
      <ConfirmDialog
        open={dialog === "confirmRooms"}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        title={t("Cômodos serão excluídos")}
        message={t("Você é o último participante de algum cômodo. Se sair, o cômodo e as tarefas dele serão excluídos.")}
        actions={[{ label: t("Sair e excluir os cômodos"), destructive: true, onSelect: () => leave.mutate({ confirmRoomDeletion: true, confirmHouseDeletion: false }) }]}
      />
      <ConfirmDialog
        open={dialog === "confirmHouse"}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        title={t("Sair e apagar a casa?")}
        message={t("Você é a única pessoa da {0}. A casa, os cômodos e as tarefas serão apagados. Não dá para desfazer.", house.name)}
        actions={[{ label: t("Apagar casa"), destructive: true, onSelect: () => leave.mutate({ confirmRoomDeletion: true, confirmHouseDeletion: true }) }]}
      />
    </>
  );
}

/** Nome editável (EditableNameSection): "Salvar" aparece quando muda; vazio não chega ao servidor. */
function HouseNameSection({ houseID, currentName }: { houseID: string; currentName: string }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateHouse();
  const id = useId();
  const [draft, setDraft] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const trimmed = draft.trim();
  const dirty = trimmed !== currentName;
  const rename = useMutation({
    mutationFn: (name: string) => houseAPI.rename(houseID, name),
    onSuccess: async () => { setError(null); await invalidate(); },
    onError: (failure) => { setDraft(currentName); toast(errorMessage(t, failure), "error"); },
  });
  const commit = () => {
    if (!dirty || rename.isPending) return;
    if (trimmed === "") { setError(t("A casa precisa de um nome. Se você sair agora, o nome anterior será salvo.")); return; }
    setError(null);
    rename.mutate(trimmed);
  };
  return (
    <Section title={t("Nome da casa")} footer={error === null ? undefined : <span className="text-danger">{error}</span>}>
      <div className="flex min-h-[48px] items-center gap-2 px-4">
        <label htmlFor={id} className="sr-only">{t("Nome da casa")}</label>
        <input
          id={id}
          value={draft}
          maxLength={80}
          disabled={rename.isPending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") commit(); }}
          placeholder={t("Nome da casa")}
          className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-muted"
        />
        {dirty && <Button size="small" variant="plain" loading={rename.isPending} onClick={commit}>{t("Salvar")}</Button>}
      </div>
    </Section>
  );
}
