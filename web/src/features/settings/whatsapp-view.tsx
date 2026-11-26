"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, MessageCircle } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/sheet";
import { Button, Section, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { WhatsAppLink } from "@/lib/api/types";
import { me } from "@/lib/client/endpoints";
import { ApiError, errorMessage } from "@/lib/client/http";
import { keys } from "@/lib/client/queries";
import { CopyButton, SubpageHeader } from "./parts";
import { useWhatsAppQuery } from "./queries";

/**
 * Ajustes › WhatsApp (WhatsAppConnectionSection). "Conectar" gera o link `wa.me` com a mensagem pronta; enviar essa
 * mensagem é o aceite do morador. O estado volta a ser lido ao voltar para a aba (o número só aparece depois do envio).
 */
export function WhatsAppView() {
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const status = useWhatsAppQuery();
  const [link, setLink] = useState<WhatsAppLink | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const connect = useMutation({
    mutationFn: () => me.linkWhatsApp(),
    onMutate: () => setActionError(null),
    onSuccess: (created) => {
      setLink(created);
      window.open(created.url, "_blank", "noopener,noreferrer");
    },
    onError: (error) => {
      setActionError(errorMessage(t, error));
      if (error instanceof ApiError && error.code === "already_linked") void client.invalidateQueries({ queryKey: keys.whatsApp });
    },
  });

  const disconnect = useMutation({
    mutationFn: () => me.unlinkWhatsApp(),
    onMutate: () => setActionError(null),
    onSuccess: () => { setLink(null); client.setQueryData(keys.whatsApp, { linked: false }); },
    onError: (error) => setActionError(errorMessage(t, error)),
  });

  const busy = connect.isPending || disconnect.isPending;
  const expires = link === null ? null : new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(link.expiresAt);

  let content;
  if (status.isPending) {
    content = <Spinner label={t("Carregando…")} />;
  } else if (status.isError) {
    content = (
      <div className="flex flex-col items-start gap-2 px-4 py-3">
        <p>{errorMessage(t, status.error)}</p>
        <Button variant="secondary" size="small" onClick={() => void status.refetch()}>{t("Tentar novamente")}</Button>
      </div>
    );
  } else if (status.data.linked) {
    content = (
      <>
        <div className="flex items-center gap-3 px-4 py-3">
          <CircleCheck aria-hidden="true" size={22} className="text-success" />
          <div>
            <p className="text-success">{t("WhatsApp conectado")}</p>
            <p className="text-[13px] text-secondary">{status.data.phone}</p>
          </div>
        </div>
        <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="flex min-h-[48px] w-full items-center px-4 text-left text-danger transition hover:bg-fill disabled:opacity-50">
          {t("Desconectar")}
        </button>
      </>
    );
  } else {
    content = (
      <>
        <button type="button" disabled={busy} onClick={() => connect.mutate()} className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-accent transition hover:bg-fill disabled:opacity-50">
          <MessageCircle aria-hidden="true" size={20} />
          {t("Conectar WhatsApp")}
        </button>
        {link !== null && (
          <div className="flex flex-col gap-2 px-4 py-3">
            <p className="text-[15px] text-secondary">{t("Envie a mensagem que aparece no WhatsApp para concluir. O link vale até {0}.", expires ?? "")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center rounded-full bg-accent-fill px-4 font-semibold text-on-accent">
                {t("Abrir o WhatsApp")}
              </a>
              <CopyButton value={link.url} label={t("Copiar link")} />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <SubpageHeader title={t("WhatsApp")} />
      <Section
        title={t("WhatsApp")}
        footer={t("No WhatsApp, o Reveza te responde quais são suas tarefas e marca como feitas. Ele só responde quando você escreve.")}
      >
        {content}
        {actionError !== null && <p role="alert" className="px-4 py-3 text-danger">{actionError}</p>}
      </Section>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("Desconectar o WhatsApp?")}
        message={t("Você pode conectar de novo quando quiser.")}
        actions={[{ label: t("Desconectar"), destructive: true, onSelect: () => disconnect.mutate() }]}
      />
    </>
  );
}
