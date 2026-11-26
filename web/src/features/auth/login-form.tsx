"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/provider";
import { auth } from "@/lib/client/endpoints";
import { ApiError } from "@/lib/client/http";
import { AppLogo, AuthScreen, Field, FieldGroup, Footnote, LegalNotice, TextLink, type LegalLinks } from "./auth-screen";
import { ConfirmStep } from "./confirm-step";
import { authErrorMessage, normalizeEmail, withNext } from "./logic";
import { WelcomeGate } from "./welcome";

/** Entrar (LoginView): e-mail e senha; conta nunca confirmada vai para o código. Login com a Apple fica no iPhone. */
export function LoginForm({ next, legal, initialEmail }: { next: string; legal: LegalLinks; initialEmail: string }) {
  const t = useT();
  const router = useRouter();
  const client = useQueryClient();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const enter = () => {
    client.clear();
    router.replace(next);
  };

  const signIn = async () => {
    const address = normalizeEmail(email);
    if (address === "" || password === "") { setError(t("Informe o e-mail e a senha.")); return; }
    setError(null);
    setWorking(true);
    try {
      await auth.signIn(address, password);
      enter();
    } catch (caught) {
      setWorking(false);
      const code = caught instanceof ApiError ? caught.code : "unknown";
      if (code === "user_not_confirmed") { setConfirming(true); return; }
      setError(authErrorMessage(t, code, "signIn"));
    }
  };

  if (confirming) {
    return <ConfirmStep email={normalizeEmail(email)} password={password} sendOnMount onBack={() => setConfirming(false)} onSignedIn={enter} />;
  }

  const query = normalizeEmail(email) === "" ? "" : `email=${encodeURIComponent(normalizeEmail(email))}`;
  const link = (path: string) => {
    const base = withNext(path, next);
    return query === "" ? base : `${base}${base.includes("?") ? "&" : "?"}${query}`;
  };

  return (
    <WelcomeGate>
      <AuthScreen>
        <header className="flex flex-col items-center pt-12 text-center">
          <AppLogo />
          <h1 className="mt-4 font-rounded text-[34px] font-bold">Reveza</h1>
          <p className="mt-2 text-[15px] text-secondary">{t("Entre para criar uma casa ou participar de uma que já existe.")}</p>
        </header>
        <form className="mt-8" onSubmit={(event) => { event.preventDefault(); if (!working) void signIn(); }} noValidate>
          <FieldGroup>
            <Field label={t("E-mail")} type="email" name="email" autoComplete="username" inputMode="email" value={email} onChange={setEmail} />
            <Field label={t("Senha")} type="password" name="password" autoComplete="current-password" value={password} onChange={setPassword} />
          </FieldGroup>
          {error !== null && <Footnote text={error} error />}
          <Button type="submit" size="large" className="mt-5" loading={working}>{t("Entrar com e-mail")}</Button>
        </form>
        <div className="mt-2 flex items-center justify-between">
          <TextLink href={link("/forgot-password")}>{t("Esqueci a senha")}</TextLink>
          <TextLink href={link("/signup")}>{t("Criar conta")}</TextLink>
        </div>
        <p className="mt-6 rounded-[var(--radius-control)] bg-card px-4 py-3 text-[13px] text-secondary">
          {t("Criou a conta com a Apple no iPhone? Esse login só funciona no app. Na web, entre com e-mail e senha.")}
        </p>
        <div className="mt-6"><LegalNotice legal={legal} /></div>
      </AuthScreen>
    </WelcomeGate>
  );
}
