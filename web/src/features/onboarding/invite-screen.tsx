"use client";

import { useQuery } from "@tanstack/react-query";
import { House as HouseIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button, ErrorState, Spinner } from "@/components/ui";
import { useT } from "@/i18n/provider";
import { house } from "@/lib/client/endpoints";
import { ApiError, errorMessage } from "@/lib/client/http";
import { AuthScreen } from "@/features/auth/auth-screen";
import { savePendingInvite } from "./pending-invite";

/**
 * Convite por link. Sem sessão: guarda o código e leva ao cadastro/login com `next` de volta para cá. Com sessão
 * e sem casa: guarda o código e abre o app, onde o onboarding já vem no passo "Entrar com código" preenchido.
 */
export function InviteScreen({ code, signedIn }: { code: string | null; signedIn: boolean }) {
  const t = useT();

  useEffect(() => {
    if (code !== null) savePendingInvite(code);
  }, [code]);

  if (code === null) {
    return (
      <AuthScreen footer={<Link href="/app" className="inline-flex min-h-[50px] items-center justify-center rounded-full bg-accent-fill px-6 text-[17px] font-semibold text-on-accent">{t("Abrir o Reveza")}</Link>}>
        <Header title={t("Convite inválido")} subtitle={t("O código de convite tem 6 letras ou números. Confira o link com quem te mandou.")} />
      </AuthScreen>
    );
  }
  if (!signedIn) return <SignedOut code={code} />;
  return <SignedIn code={code} />;
}

function Header({ title, subtitle, code }: { title: string; subtitle: string; code?: string }) {
  const t = useT();
  return (
    <header className="flex flex-col items-center pt-14 text-center">
      <span aria-hidden="true" className="mb-4 inline-flex h-[68px] w-[68px] items-center justify-center rounded-full bg-accent-soft text-accent">
        <HouseIcon size={32} />
      </span>
      <h1 className="font-rounded text-[28px] font-bold leading-tight">{title}</h1>
      <p className="mt-2 text-[15px] text-secondary">{subtitle}</p>
      {code !== undefined && (
        <div className="mt-6 rounded-[var(--radius-control)] bg-card px-6 py-4" role="group" aria-label={`${t("Código da casa")}: ${code.split("").join(" ")}`}>
          <span aria-hidden="true" className="font-mono text-[28px] font-bold tracking-[0.3em]">{code}</span>
        </div>
      )}
    </header>
  );
}

function SignedOut({ code }: { code: string }) {
  const t = useT();
  const next = encodeURIComponent(`/invite/${code}`);
  return (
    <AuthScreen
      footer={(
        <>
          <Link href={`/signup?next=${next}`} className="inline-flex min-h-[50px] items-center justify-center rounded-full bg-accent-fill px-6 text-[17px] font-semibold text-on-accent">
            {t("Criar conta")}
          </Link>
          <Link href={`/login?next=${next}`} className="inline-flex min-h-[44px] items-center justify-center rounded-full px-5 text-[17px] font-semibold text-accent hover:bg-fill">
            {t("Já tenho uma conta")}
          </Link>
        </>
      )}
    >
      <Header code={code} title={t("Você foi convidado para uma casa no Reveza")} subtitle={t("Crie uma conta ou entre para participar do rodízio da casa.")} />
    </AuthScreen>
  );
}

function SignedIn({ code }: { code: string }) {
  const t = useT();
  const router = useRouter();
  const mine = useQuery({ queryKey: ["invite", "my-house"], queryFn: house.mine, retry: false, staleTime: 0 });
  const noHouse = mine.isError && mine.error instanceof ApiError && (mine.error.code === "no_house" || mine.error.code === "account_not_registered");

  useEffect(() => {
    // Sem casa: o onboarding do app lê o código guardado e abre em "Entrar com código".
    if (noHouse) router.replace("/app");
  }, [noHouse, router]);

  if (mine.isPending || noHouse) return <main className="min-h-dvh bg-grouped"><Spinner /></main>;
  if (mine.isError) return <main className="min-h-dvh bg-grouped"><ErrorState message={errorMessage(t, mine.error)} onRetry={() => void mine.refetch()} /></main>;

  const same = mine.data.house.accessCode.toUpperCase() === code;
  return (
    <AuthScreen footer={<Button size="large" onClick={() => router.replace("/app/house")}>{t("Abrir o Reveza")}</Button>}>
      {same
        ? <Header title={t("Você já está nesta casa")} subtitle={mine.data.house.name} />
        : <Header title={t("Você já faz parte de uma casa.")} subtitle={t("Para entrar em outra, saia da casa atual em Ajustes da casa.")} />}
    </AuthScreen>
  );
}
