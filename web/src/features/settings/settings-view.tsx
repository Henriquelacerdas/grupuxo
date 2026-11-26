"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, House, Info, KeyRound, Plane, Send, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/sheet";
import { Avatar, PageTitle, Section, Toggle } from "@/components/ui";
import type { Vacation } from "@/lib/api/types";
import { me } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { invalidateHouse, keys, useNow } from "@/lib/client/queries";
import { fullDate } from "@/lib/format/dates";
import type { TextContext } from "@/lib/format/labels";
import { useHouse, useTextContext } from "../house-context";
import { LinkRow, CopyButton, ValueRow } from "./parts";
import { APP_VERSION, FEEDBACK_EMAIL, PRIVACY_URL, TERMS_URL, useVacationQuery, useWhatsAppQuery } from "./queries";

/** O que o rodapé do modo férias diz: quando começa, ou como voltar (VacationViewModel.footer). */
export function vacationFooter(ctx: TextContext, vacation: Vacation | undefined, now: number): string {
  if (vacation === undefined || !vacation.onVacation) return ctx.t("Você sai dos rodízios a partir do próximo ciclo e volta quando desligar.");
  if (vacation.startsAt !== null && vacation.startsAt > now) {
    return ctx.t("Você sai dos rodízios em {0}. Desligue para ficar.", fullDate(vacation.startsAt, ctx.locale, ctx.timeZone));
  }
  return ctx.t("Você está fora dos rodízios. Desligue para voltar a partir do próximo ciclo.");
}

/** Ajustes (ProfileView): conta, casa e convite, notificações e WhatsApp, férias, ajuda e sobre. */
export function SettingsView() {
  const ctx = useTextContext();
  const { t } = ctx;
  const { me: profile, house, snapshot } = useHouse();
  const client = useQueryClient();
  const now = useNow();
  const vacation = useVacationQuery();
  const whatsApp = useWhatsAppQuery();
  const [failure, setFailure] = useState<string | null>(null);

  const setVacation = useMutation({
    mutationFn: (on: boolean) => (on ? me.startVacation() : me.endVacation()),
    onSuccess: (result) => {
      client.setQueryData(keys.vacation, result);
      void invalidateHouse(client);
    },
    onError: (error) => {
      setFailure(errorMessage(t, error));
      void client.invalidateQueries({ queryKey: keys.vacation });
    },
  });

  const whatsAppValue = whatsApp.data === undefined ? undefined : whatsApp.data.linked ? t("Conectado") : t("Não conectado");
  const vacationOn = setVacation.isPending ? setVacation.variables : (vacation.data?.onVacation ?? false);
  const feedback = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(t("Sugestão para o Reveza"))}`;

  return (
    <>
      <PageTitle title={t("Ajustes")} />

      {profile !== undefined && (
        <Section>
          <Link href="/app/settings/account" className="flex min-h-[72px] items-center gap-4 px-4 py-3 transition hover:bg-fill">
            <Avatar name={profile.name} photoURL={profile.photoURL} size="profile" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-rounded text-[20px] font-bold">{profile.name}</span>
              <span className="block text-[15px] text-secondary">{t("Conta, foto e nome")}</span>
            </span>
            <span aria-hidden="true" className="text-muted">›</span>
          </Link>
        </Section>
      )}

      <Section title={t("Casa")}>
        <LinkRow href="/app/house/settings" icon={House} tint="var(--room-orange)" value={t("{0} pessoas", snapshot.home.members.length)}>
          {house.name}
        </LinkRow>
        <div className="flex min-h-[56px] items-center gap-3 px-4 py-2">
          <span aria-hidden="true" className="inline-flex h-[29px] w-[29px] shrink-0 items-center justify-center rounded-[7px] text-white" style={{ background: "var(--room-blue)" }}>
            <KeyRound size={17} strokeWidth={2.25} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] text-secondary">{t("Código para convidar")}</span>
            <span className="block select-all font-mono text-[20px] font-bold tracking-[0.2em]">{house.accessCode}</span>
          </span>
          <CopyButton value={house.accessCode} accessibleLabel={t("Copiar código")} />
        </div>
      </Section>

      <Section title={t("Você")}>
        <LinkRow href="/app/settings/notifications" icon={Bell} tint="var(--room-red)">{t("Notificações")}</LinkRow>
        <LinkRow href="/app/settings/whatsapp" icon={Send} tint="var(--room-green)" value={whatsAppValue}>{t("WhatsApp")}</LinkRow>
      </Section>

      <Section footer={vacationFooter(ctx, vacation.data, now)}>
        <Toggle
          label={<span className="flex items-center gap-3"><span aria-hidden="true" className="inline-flex h-[29px] w-[29px] items-center justify-center rounded-[7px] text-white" style={{ background: "var(--room-teal)" }}><Plane size={17} /></span>{t("Modo férias")}</span>}
          checked={vacationOn}
          disabled={vacation.isPending || setVacation.isPending}
          onChange={(next) => setVacation.mutate(next)}
        />
      </Section>

      <Section title={t("Ajuda")}>
        <LinkRow href="/welcome?next=/app/settings" icon={Info} tint="var(--room-gray)">{t("Como o Reveza funciona")}</LinkRow>
        <LinkRow href={feedback} icon={Star} tint="var(--room-purple)" external>{t("Enviar sugestão")}</LinkRow>
      </Section>

      <Section title={t("Sobre")}>
        {PRIVACY_URL !== null && <LinkRow href={PRIVACY_URL} external>{t("Política de Privacidade")}</LinkRow>}
        {TERMS_URL !== null && <LinkRow href={TERMS_URL} external>{t("Termos de Uso")}</LinkRow>}
        <ValueRow label={t("Versão")} value={APP_VERSION} />
      </Section>

      <ConfirmDialog
        open={failure !== null}
        onOpenChange={(next) => { if (!next) setFailure(null); }}
        title={t("Não foi possível atualizar")}
        {...(failure !== null ? { message: failure } : {})}
        actions={[]}
        cancelLabel={t("OK")}
      />
    </>
  );
}
