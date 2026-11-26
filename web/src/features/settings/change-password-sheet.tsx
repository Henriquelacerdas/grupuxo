"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Sheet } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { TextField } from "@/components/ui";
import { useT } from "@/i18n/provider";
import { auth } from "@/lib/client/endpoints";
import { ApiError, errorMessage } from "@/lib/client/http";
import type { Translate } from "@/lib/format/labels";

export const PASSWORD_RULES = "Pelo menos 6 caracteres, com uma letra minúscula.";

/** Mensagem do erro ao trocar a senha (AuthService.changePassword). */
export function changePasswordMessage(t: Translate, error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "invalid_credentials": return t("A senha atual não confere.");
      case "invalid_password": return t("Senha fraca. {0}", t(PASSWORD_RULES));
      case "invalid_parameter": return t("Senha fraca. {0}", t(PASSWORD_RULES));
      case "limit_exceeded": return t("Muitas tentativas seguidas. Espere alguns minutos e tente de novo.");
      default: break;
    }
  }
  return errorMessage(t, error);
}

/** Ajustes › Conta › Alterar senha (ChangePasswordView). Só para quem entrou com e-mail e senha. */
export function ChangePasswordSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [proposed, setProposed] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const reset = () => { setCurrent(""); setProposed(""); setConfirmation(""); setMessage(null); };
  const change = useMutation({
    mutationFn: () => auth.changePassword(current, proposed),
    onSuccess: () => {
      reset();
      toast(t("Senha alterada"));
      onOpenChange(false);
    },
    onError: (error) => setMessage(changePasswordMessage(t, error)),
  });

  const canSave = current !== "" && proposed !== "" && confirmation !== "" && !change.isPending;
  const save = () => {
    if (!canSave) return;
    if (proposed !== confirmation) { setMessage(t("As senhas novas não são iguais.")); return; }
    if (proposed === current) { setMessage(t("A senha nova precisa ser diferente da atual.")); return; }
    setMessage(null);
    change.mutate();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (change.isPending) return; if (!next) reset(); onOpenChange(next); }}
      title={t("Alterar senha")}
      confirm={{ label: t("Salvar"), onSelect: save, disabled: !canSave, loading: change.isPending }}
    >
      <form onSubmit={(event) => { event.preventDefault(); save(); }} noValidate>
        <TextField label={t("Senha atual")} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <TextField label={t("Senha nova")} type="password" autoComplete="new-password" value={proposed} onChange={(e) => setProposed(e.target.value)} />
        <TextField
          label={t("Repita a senha nova")}
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          error={message}
          hint={t(PASSWORD_RULES)}
        />
        <button type="submit" className="sr-only" tabIndex={-1}>{t("Salvar")}</button>
      </form>
    </Sheet>
  );
}
