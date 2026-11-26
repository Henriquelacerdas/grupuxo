"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/provider";
import { auth } from "@/lib/client/endpoints";
import { ApiError } from "@/lib/client/http";
import { AuthScreen, CheckEmailHeader, Field, FieldGroup, Footnote } from "./auth-screen";
import { authErrorMessage } from "./logic";

function code(error: unknown): string {
  return error instanceof ApiError ? error.code : "unknown";
}

/**
 * Confirmar o e-mail com o código (ConfirmSignUpView). Com a senha em mãos, entra direto e segue para `next`;
 * `sendOnMount` manda um código novo ao abrir (conta criada e nunca confirmada, vinda do login).
 */
export function ConfirmStep({ email, password, sendOnMount = false, onBack, onSignedIn }: {
  email: string; password: string | null; sendOnMount?: boolean; onBack: () => void; onSignedIn: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const sent = useRef(false);

  const resend = async () => {
    setWorking(true);
    try {
      await auth.resend(email);
      setMessage({ text: t("Enviamos um novo código para {0}.", email), error: false });
    } catch (error) {
      setMessage({ text: authErrorMessage(t, code(error), "resend"), error: true });
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    if (!sendOnMount || sent.current) return;
    sent.current = true;
    void resend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendOnMount]);

  const confirm = async () => {
    const trimmed = value.trim();
    if (trimmed === "") { setMessage({ text: t("Informe o e-mail e o código."), error: true }); return; }
    setWorking(true);
    setMessage(null);
    try {
      await auth.confirm(email, trimmed);
    } catch (error) {
      setWorking(false);
      setMessage({ text: authErrorMessage(t, code(error), "confirm"), error: true });
      return;
    }
    setConfirmed(true);
    if (password === null || password === "") {
      setWorking(false);
      setMessage({ text: t("Conta confirmada! Você já pode fazer login."), error: false });
      return;
    }
    try {
      await auth.signIn(email, password);
      setMessage({ text: t("Conta confirmada!"), error: false });
      onSignedIn();
    } catch (error) {
      setWorking(false);
      const failure = code(error);
      if (failure === "invalid_credentials" || failure === "user_not_found") {
        setMessage({ text: t("Conta confirmada! Volte e entre com seu e-mail e senha."), error: false });
      } else {
        setMessage({ text: t("Conta confirmada, mas não deu para entrar: {0}", authErrorMessage(t, failure, "signIn")), error: true });
      }
    }
  };

  return (
    <AuthScreen
      footer={confirmed && !working ? (
        <Button size="large" onClick={onBack}>{t("Voltar para o login")}</Button>
      ) : (
        <>
          <Button size="large" type="submit" form="confirm-form" loading={working} disabled={value.trim() === ""}>{t("Continuar")}</Button>
          <Button variant="plain" disabled={working} onClick={() => void resend()}>{t("Reenviar código")}</Button>
        </>
      )}
    >
      <CheckEmailHeader email={email} />
      <form id="confirm-form" className="mt-8" onSubmit={(event) => { event.preventDefault(); if (!working) void confirm(); }}>
        <FieldGroup>
          <Field
            label={t("Código")}
            value={value}
            onChange={(next) => { setValue(next.replace(/\D/g, "").slice(0, 6)); }}
            autoComplete="one-time-code"
            inputMode="numeric"
            name="code"
            autoFocus
            disabled={confirmed}
            center
            maxLength={6}
          />
        </FieldGroup>
        {message !== null && <Footnote text={message.text} error={message.error} />}
      </form>
    </AuthScreen>
  );
}
