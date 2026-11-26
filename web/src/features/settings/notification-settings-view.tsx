"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { ConfirmDialog } from "@/components/sheet";
import { Section, Spinner, Toggle } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { NotificationPreferences } from "@/lib/api/types";
import { me } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { keys } from "@/lib/client/queries";
import { disablePush, enablePush, isPushEnabled, pushState, type PushState } from "@/lib/client/web-push";
import { SubpageHeader } from "./parts";
import { usePreferencesQuery } from "./queries";

const subscribeNothing = (): (() => void) => () => undefined;
const serverPushState = (): PushState => "unsupported";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * Ajustes › Notificações (NotificationSettingsView). Push neste navegador, avisos por tipo e, no lugar dos lembretes
 * que o iPhone agenda sozinho, o resumo diário e o aviso de novo ciclo enviados pelo servidor a este navegador.
 * Pedidos de troca e de entrada sempre chegam.
 */
export function NotificationSettingsView() {
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const preferences = usePreferencesQuery();
  const [failure, setFailure] = useState<string | null>(null);
  // A permissão é do navegador: lida a cada render (no servidor, "sem suporte", e a seção não aparece).
  const browser = useSyncExternalStore(subscribeNothing, pushState, serverPushState);
  const [subscribed, setSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const hourID = useId();

  useEffect(() => {
    if (browser === "granted") void isPushEnabled().then(setSubscribed, () => setSubscribed(false));
  }, [browser]);

  const update = useMutation({
    mutationFn: (next: NotificationPreferences) => me.setPreferences(next),
    onMutate: async (next) => {
      await client.cancelQueries({ queryKey: keys.preferences });
      client.setQueryData(keys.preferences, next);
    },
    onSuccess: (saved) => client.setQueryData(keys.preferences, saved),
    onError: (error) => {
      setFailure(errorMessage(t, error));
      // O interruptor volta ao que o servidor tem.
      void client.invalidateQueries({ queryKey: keys.preferences });
    },
  });

  const change = (patch: Partial<NotificationPreferences>) => {
    const current = preferences.data;
    if (current === undefined || update.isPending) return;
    update.mutate({ ...current, ...patch });
  };

  const turnOnBrowser = async () => {
    setPushBusy(true);
    try {
      setSubscribed((await enablePush()) === "granted");
    } catch (error) {
      setFailure(errorMessage(t, error));
    } finally {
      setPushBusy(false);
    }
  };
  const turnOffBrowser = async () => {
    setPushBusy(true);
    await disablePush();
    setSubscribed(false);
    setPushBusy(false);
  };

  const hourLabel = (hour: number) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(Date.UTC(2026, 0, 1, hour));
  const current = preferences.data;
  const serverPush = browser !== "unsupported";

  return (
    <>
      <SubpageHeader title={t("Notificações")} />

      {browser === "default" && (
        <Section footer={t("O Reveza avisa quando algo muda na casa. Você escolhe quais avisos abaixo.")}>
          <button type="button" disabled={pushBusy} onClick={() => void turnOnBrowser()} className="flex min-h-[48px] w-full items-center px-4 text-left text-accent transition hover:bg-fill disabled:opacity-50">
            {t("Ativar notificações")}
          </button>
        </Section>
      )}
      {browser === "granted" && (
        <Section footer={t("Os avisos chegam a este navegador mesmo com o Reveza fechado.")}>
          <Toggle
            label={t("Receber neste navegador")}
            checked={subscribed}
            disabled={pushBusy}
            onChange={(next) => void (next ? turnOnBrowser() : turnOffBrowser())}
          />
        </Section>
      )}
      {browser === "denied" && (
        <Section>
          <p className="px-4 py-3 text-[15px] text-secondary">{t("Para receber alertas do Reveza, permita as notificações deste site nas configurações do navegador.")}</p>
        </Section>
      )}
      {browser === "needsInstall" && (
        <Section>
          <p className="px-4 py-3 text-[15px] text-secondary">{t("No iPhone, os avisos chegam depois de adicionar o Reveza à Tela de Início: toque em Compartilhar e em Adicionar à Tela de Início, e abra o Reveza por lá.")}</p>
        </Section>
      )}

      {preferences.isPending ? <Spinner /> : current === undefined ? null : (
        <>
          <Section title={t("Avisos")} footer={t("Pedidos de troca e de entrada em cômodo sempre chegam.")}>
            <Toggle label={t("Atividade da casa")} checked={current.houseActivity} disabled={update.isPending} onChange={(houseActivity) => change({ houseActivity })} />
            <Toggle label={t("Resumo da semana")} checked={current.weeklySummary} disabled={update.isPending} onChange={(weeklySummary) => change({ weeklySummary })} />
          </Section>

          {serverPush && (
            <>
              <Section title={t("Resumo diário")} footer={t("Todo dia, no horário escolhido (no fuso da casa), o Reveza manda a este navegador a lista das suas tarefas pendentes.")}>
                <Toggle label={t("Resumo diário das minhas tarefas")} checked={current.remindTasks} disabled={update.isPending} onChange={(remindTasks) => change({ remindTasks })} />
                {current.remindTasks && (
                  <div className="flex min-h-[48px] items-center gap-3 px-4 py-2">
                    <label htmlFor={hourID} className="flex-1">{t("Horário do resumo")}</label>
                    <select
                      id={hourID}
                      value={current.reminderHour}
                      disabled={update.isPending}
                      onChange={(event) => change({ reminderHour: Number(event.target.value) })}
                      className="min-h-[36px] rounded-[8px] bg-fill px-3 text-[17px] text-label"
                    >
                      {HOURS.map((hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                    </select>
                  </div>
                )}
              </Section>

              <Section title={t("Novo ciclo")} footer={t("No dia em que o ciclo de um cômodo seu recomeça, o Reveza avisa neste navegador que as próximas atividades já estão disponíveis.")}>
                <Toggle label={t("Avisar quando o ciclo virar")} checked={current.cycleTurned} disabled={update.isPending} onChange={(cycleTurned) => change({ cycleTurned })} />
              </Section>
            </>
          )}
        </>
      )}

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
