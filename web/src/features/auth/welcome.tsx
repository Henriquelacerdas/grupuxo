"use client";

import { Clock, Repeat, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/provider";

// Boas-vindas (WelcomeView): na primeira visita, antes do login; depois, por Ajustes › "Como o Reveza funciona".

const SEEN_KEY = "reveza.hasSeenWelcome";

export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // armazenamento bloqueado: as boas-vindas voltam na próxima visita
  }
}

const FEATURES: readonly { icon: LucideIcon; tint: string; title: string; detail: string }[] = [
  { icon: Repeat, tint: "var(--room-orange)", title: "Cada cômodo tem a sua vez", detail: "A cada ciclo, cada cômodo passa para outra pessoa, como na lousa da república." },
  { icon: Zap, tint: "var(--room-purple)", title: "Divisão justa", detail: "As tarefas são divididas pelo esforço de cada uma. Ninguém fica sempre com a parte pesada." },
  { icon: Clock, tint: "var(--room-blue)", title: "Ninguém precisa cobrar ninguém", detail: "Lembretes na hora certa, e todo mundo vê o que já foi feito." },
];

export function WelcomeView({ onContinue }: { onContinue: () => void }) {
  const t = useT();
  return (
    <main className="flex min-h-dvh flex-col bg-card px-8 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),16px)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <h1 className="mt-14 text-center font-rounded text-[34px] font-bold leading-tight">{t("Boas-vindas ao Reveza")}</h1>
        <ul className="mt-12 flex flex-col gap-7">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="flex items-start gap-5">
              <feature.icon aria-hidden="true" size={28} className="mt-1 shrink-0" style={{ color: feature.tint }} />
              <div>
                <h2 className="font-rounded text-[17px] font-semibold">{t(feature.title)}</h2>
                <p className="mt-0.5 text-[15px] text-secondary">{t(feature.detail)}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex-1" />
        <Button size="large" className="mt-10" onClick={onContinue}>{t("Continuar")}</Button>
      </div>
    </main>
  );
}

/** Mostra as boas-vindas uma vez (por navegador) antes das telas de conta. */
export function WelcomeGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "welcome" | "done">("checking");
  useEffect(() => {
    // localStorage só existe no navegador: decidir aqui evita divergência com o HTML do servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(hasSeenWelcome() ? "done" : "welcome");
  }, []);
  if (state === "checking") return <div className="min-h-dvh bg-grouped" aria-hidden="true" />;
  if (state === "welcome") {
    return <WelcomeView onContinue={() => { markWelcomeSeen(); setState("done"); }} />;
  }
  return <>{children}</>;
}
