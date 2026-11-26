import { ArrowLeftRight, Clock, Repeat, Smartphone, Zap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { messagesFor } from "@/i18n/load";
import { format, pickLocale, type Arg } from "@/i18n/messages";
import { hasSession } from "@/server/auth";
import { headers } from "next/headers";

// Página pública: o que é o Reveza, entrar pela web e o link da App Store (sem URL configurada, o botão some).
export default async function Landing() {
  const locale = pickLocale((await headers()).get("accept-language"));
  const messages = messagesFor(locale);
  const t = (key: string, ...args: Arg[]) => format(locale, messages, key, args);
  const signedIn = await hasSession();
  const appStore = process.env["NEXT_PUBLIC_APP_STORE_URL"] ?? "";
  const privacy = process.env["NEXT_PUBLIC_PRIVACY_POLICY_URL"] ?? "";
  const terms = process.env["NEXT_PUBLIC_TERMS_URL"] ?? "";

  const features = [
    { icon: Repeat, title: t("Cada cômodo tem a sua vez"), detail: t("A cada ciclo, cada cômodo passa para outra pessoa, como na lousa da república.") },
    { icon: Zap, title: t("Divisão justa"), detail: t("As tarefas são divididas pelo esforço de cada uma. Ninguém fica sempre com a parte pesada.") },
    { icon: Clock, title: t("Ninguém precisa cobrar ninguém"), detail: t("Lembretes na hora certa, e todo mundo vê o que já foi feito.") },
    { icon: ArrowLeftRight, title: t("Trocas sem bagunça"), detail: t("Não vai dar esta semana? Peça para trocar a tarefa com outra pessoa da casa.") },
  ];

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 lg:px-8">
        <span className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon.svg" alt="" width={36} height={36} />
          <span className="font-rounded text-[22px] font-bold">Reveza</span>
        </span>
        <Link href={signedIn ? "/app" : "/login"} className="inline-flex min-h-[44px] items-center rounded-full px-4 font-semibold text-accent hover:bg-fill">
          {signedIn ? t("Abrir o Reveza") : t("Entrar")}
        </Link>
      </header>

      <main>
        <section className="mx-auto grid max-w-5xl items-center gap-10 px-4 pb-16 pt-6 lg:grid-cols-[1.1fr_1fr] lg:px-8 lg:pt-12">
          <div>
            <h1 className="font-rounded text-[40px] font-bold leading-[1.05] tracking-tight lg:text-[56px]">{t("A casa em dia, sem ninguém cobrar ninguém.")}</h1>
            <p className="mt-4 max-w-xl text-[19px] text-secondary">
              {t("Cada cômodo da casa passa para uma pessoa diferente a cada ciclo, e as tarefas dele vão junto.")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={signedIn ? "/app" : "/signup"} className="inline-flex min-h-[50px] items-center justify-center rounded-full bg-accent-fill px-7 text-[17px] font-semibold text-on-accent hover:brightness-110">
                {t("Usar na web")}
              </Link>
              {appStore !== "" && (
                <a href={appStore} rel="noopener" className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-full bg-label px-7 text-[17px] font-semibold text-grouped hover:opacity-90">
                  <Smartphone aria-hidden="true" size={20} />
                  {t("Baixar na App Store")}
                </a>
              )}
            </div>
            <p className="mt-4 text-[15px] text-secondary">{t("Funciona no navegador do celular e do computador. No iPhone, também tem o app.")}</p>
          </div>
          <div className="flex justify-center gap-4">
            <Image src="/images/casa.png" alt={t("Tela Casa do Reveza com os cômodos e quem cuida de cada um")} width={280} height={608} priority className="w-[46%] max-w-[280px] rounded-[28px] shadow-xl" />
            <Image src="/images/resumo-da-semana.png" alt={t("Tela Resumo da semana do Reveza")} width={280} height={608} className="mt-10 w-[46%] max-w-[280px] rounded-[28px] shadow-xl" />
          </div>
        </section>

        <section aria-labelledby="como-funciona" className="bg-card py-16">
          <div className="mx-auto max-w-5xl px-4 lg:px-8">
            <h2 id="como-funciona" className="font-rounded text-[28px] font-bold">{t("Como o Reveza funciona")}</h2>
            <ul className="mt-8 grid gap-8 sm:grid-cols-2">
              {features.map((feature) => (
                <li key={feature.title} className="flex gap-4">
                  <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <feature.icon aria-hidden="true" size={24} />
                  </span>
                  <span>
                    <span className="block text-[19px] font-semibold">{feature.title}</span>
                    <span className="mt-1 block text-[17px] text-secondary">{feature.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-8 text-[15px] text-secondary lg:px-8">
        <span>© {new Date().getFullYear()} Reveza</span>
        {privacy !== "" && <a className="hover:text-label" href={privacy}>{t("Política de Privacidade")}</a>}
        {terms !== "" && <a className="hover:text-label" href={terms}>{t("Termos de Uso")}</a>}
      </footer>
    </div>
  );
}
