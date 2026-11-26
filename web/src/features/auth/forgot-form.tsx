"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/provider";
import { auth } from "@/lib/client/endpoints";
import { ApiError } from "@/lib/client/http";
import { AuthHeader, AuthScreen, CheckEmailHeader, Field, FieldGroup, Footnote } from "./auth-screen";
import { PASSWORD_RULES, authErrorMessage, normalizeEmail, withNext } from "./logic";

const codeOf = (error: unknown): string => (error instanceof ApiError ? error.code : "unknown");

type Step = "request" | "code" | "newPassword";

/** Esqueci a senha (ForgotPasswordView): e-mail → código → senha nova, e entra direto. */
export function ForgotForm({ next, initialEmail }: { next: string; initialEmail: string }) {
  const t = useT();
  const router = useRouter();
  const client = useQueryClient();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [working, setWorking] = useState(false);
  const address = normalizeEmail(email);
  const login = `${withNext("/login", next)}${address === "" ? "" : `${next === "/app" ? "?" : "&"}email=${encodeURIComponent(address)}`}`;

  const requestCode = async () => {
    if (address === "") { setMessage({ text: t("Informe o e-mail."), error: true }); return; }
    setMessage(null);
    setWorking(true);
    try {
      await auth.forgot(address);
      if (step === "code") setMessage({ text: t("Enviamos um novo código para {0}.", address), error: false });
      setStep("code");
    } catch (caught) {
      setMessage({ text: authErrorMessage(t, codeOf(caught), "forgot"), error: true });
    } finally {
      setWorking(false);
    }
  };

  const save = async () => {
    if (password === "") return;
    setMessage(null);
    setWorking(true);
    try {
      await auth.reset(address, code.trim(), password);
    } catch (caught) {
      setWorking(false);
      const failure = codeOf(caught);
      if (failure === "code_mismatch" || failure === "expired_code") setStep("code");
      setMessage({ text: authErrorMessage(t, failure, "reset"), error: true });
      return;
    }
    try {
      await auth.signIn(address, password);
      client.clear();
      router.replace(next);
    } catch (caught) {
      setWorking(false);
      const failure = codeOf(caught);
      if (failure === "invalid_credentials" || failure === "user_not_found") setMessage({ text: t("Senha alterada. Volte e entre com a senha nova."), error: false });
      else setMessage({ text: t("Senha alterada, mas não deu para entrar: {0}", authErrorMessage(t, failure, "signIn")), error: true });
    }
  };

  const footer = step === "request" ? (
    <Button size="large" type="submit" form="forgot-form" loading={working} disabled={address === ""}>{t("Enviar código")}</Button>
  ) : step === "code" ? (
    <>
      <Button size="large" type="submit" form="forgot-form" disabled={code.trim() === ""}>{t("Continuar")}</Button>
      <Button variant="plain" disabled={working} onClick={() => void requestCode()}>{t("Reenviar código")}</Button>
    </>
  ) : (
    <Button size="large" type="submit" form="forgot-form" loading={working} disabled={password === ""}>{t("Salvar e entrar")}</Button>
  );

  const submit = () => {
    if (working) return;
    if (step === "request") void requestCode();
    else if (step === "code") { if (code.trim() !== "") { setMessage(null); setStep("newPassword"); } }
    else void save();
  };

  return (
    <AuthScreen back={step === "newPassword" ? undefined : { href: login }} footer={footer}>
      {step === "request" && (
        <AuthHeader title={t("Esqueceu a senha?")} subtitle={t("Digite seu e-mail. Vamos mandar um código para você criar uma senha nova.")} />
      )}
      {step === "code" && <CheckEmailHeader email={address} />}
      {step === "newPassword" && (
        <>
          <button type="button" className="-ml-2 inline-flex min-h-[44px] items-center rounded-full px-2 text-[17px] text-accent hover:bg-fill" onClick={() => setStep("code")}>
            ‹ {t("Voltar")}
          </button>
          <AuthHeader title={t("Crie uma senha nova")} subtitle={t("Depois disso, você entra direto no Reveza.")} />
        </>
      )}
      <form id="forgot-form" className={step === "code" ? "mt-8" : ""} onSubmit={(event) => { event.preventDefault(); submit(); }} noValidate>
        {step !== "request" && <input type="email" name="email" autoComplete="username" value={address} readOnly hidden />}
        <FieldGroup>
          {step === "request" && (
            <Field label={t("E-mail")} type="email" name="email" autoComplete="username" inputMode="email" value={email} onChange={setEmail} autoFocus />
          )}
          {step === "code" && (
            <Field label={t("Código")} name="code" autoComplete="one-time-code" inputMode="numeric" value={code} onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} autoFocus center maxLength={6} />
          )}
          {step === "newPassword" && (
            <Field label={t("Senha nova")} type="password" name="new-password" autoComplete="new-password" value={password} onChange={setPassword} autoFocus />
          )}
        </FieldGroup>
        {step === "newPassword" && message === null && <Footnote text={t(PASSWORD_RULES)} />}
        {message !== null && <Footnote text={message.text} error={message.error} />}
      </form>
    </AuthScreen>
  );
}
