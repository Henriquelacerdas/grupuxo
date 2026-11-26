"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/provider";
import { auth } from "@/lib/client/endpoints";
import { ApiError } from "@/lib/client/http";
import { AuthHeader, AuthScreen, Field, FieldGroup, Footnote, LegalNotice, TextLink, type LegalLinks } from "./auth-screen";
import { ConfirmStep } from "./confirm-step";
import { PASSWORD_RULES, authErrorMessage, normalizeEmail, withNext } from "./logic";
import { WelcomeGate } from "./welcome";

const codeOf = (error: unknown): string => (error instanceof ApiError ? error.code : "unknown");

/** Criar conta (SignUpView) e confirmar o e-mail. "Já existe" tenta entrar com a senha digitada, como o app. */
export function SignUpForm({ next, legal, initialEmail }: { next: string; legal: LegalLinks; initialEmail: string }) {
  const t = useT();
  const router = useRouter();
  const client = useQueryClient();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const address = normalizeEmail(email);
  const enter = () => {
    client.clear();
    router.replace(next);
  };
  const loginLink = (path: string) => {
    const base = withNext(path, next);
    return address === "" ? base : `${base}${base.includes("?") ? "&" : "?"}email=${encodeURIComponent(address)}`;
  };

  const signInAfterSignUp = async (existing: boolean) => {
    try {
      await auth.signIn(address, password);
      enter();
    } catch (caught) {
      setWorking(false);
      const code = codeOf(caught);
      if (code === "user_not_confirmed") { setConfirming(true); return; }
      if (code === "invalid_credentials" || code === "user_not_found") {
        if (existing) { setError(t("Esse e-mail já tem uma conta no Reveza.")); setEmailTaken(true); }
        else setError(t("Conta criada. Volte e entre com seu e-mail e senha."));
        return;
      }
      setError(authErrorMessage(t, code, "signIn"));
    }
  };

  const signUp = async () => {
    if (address === "" || password === "") { setError(t("Informe o e-mail e a senha.")); return; }
    setError(null);
    setWorking(true);
    try {
      const result = await auth.signUp(address, password);
      if (!result.confirmed) { setWorking(false); setConfirming(true); return; }
      await signInAfterSignUp(false);
    } catch (caught) {
      const code = codeOf(caught);
      // Comum depois de um cadastro sem confirmação: tenta entrar e, se faltar confirmar, leva ao código.
      if (code === "username_exists") { await signInAfterSignUp(true); return; }
      setWorking(false);
      setError(authErrorMessage(t, code, "signUp"));
    }
  };

  if (confirming) {
    return <ConfirmStep email={address} password={password} onBack={() => router.push(loginLink("/login"))} onSignedIn={enter} />;
  }

  return (
    <WelcomeGate>
      <AuthScreen
        back={{ href: loginLink("/login") }}
        footer={emailTaken ? (
          <>
            <Button size="large" onClick={() => router.push(loginLink("/login"))}>{t("Entrar com esse e-mail")}</Button>
            <TextLink href={loginLink("/forgot-password")}>{t("Esqueci a senha")}</TextLink>
          </>
        ) : (
          <>
            <Button size="large" type="submit" form="signup-form" loading={working} disabled={address === "" || password === ""}>{t("Criar conta")}</Button>
            <Button variant="plain" onClick={() => router.push(loginLink("/login"))}>{t("Já tenho uma conta")}</Button>
            <div className="mt-2"><LegalNotice legal={legal} /></div>
          </>
        )}
      >
        <AuthHeader title={t("Criar conta")} subtitle={t("Use um e-mail que você acessa. É por ele que você recupera a senha.")} />
        <form id="signup-form" onSubmit={(event) => { event.preventDefault(); if (!working) void signUp(); }} noValidate>
          <FieldGroup>
            <Field label={t("E-mail")} type="email" name="email" autoComplete="username" inputMode="email" value={email} onChange={(value) => { setEmail(value); setEmailTaken(false); setError(null); }} />
            <Field label={t("Senha")} type="password" name="new-password" autoComplete="new-password" value={password} onChange={setPassword} />
          </FieldGroup>
          {error !== null ? <Footnote text={error} error /> : <Footnote text={t(PASSWORD_RULES)} />}
        </form>
      </AuthScreen>
    </WelcomeGate>
  );
}
