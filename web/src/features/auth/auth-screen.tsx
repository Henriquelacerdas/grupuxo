"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { useT } from "@/i18n/provider";
import { parseLinks } from "./logic";

// Peças das telas de entrada (AuthComponents.swift): coluna única centrada, campos agrupados e ações embaixo.

export interface LegalLinks { readonly terms: string | null; readonly privacy: string | null }

export function AuthScreen({ children, footer, back }: { children: ReactNode; footer?: ReactNode; back?: { href: string; label?: string } | undefined }) {
  const t = useT();
  return (
    <main className="flex min-h-dvh flex-col bg-grouped px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),16px)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        {back !== undefined && (
          <Link href={back.href} className="-ml-2 inline-flex min-h-[44px] items-center self-start rounded-full px-2 text-[17px] text-accent hover:bg-fill">
            ‹ {back.label ?? t("Voltar")}
          </Link>
        )}
        <div className="flex-1">{children}</div>
        {footer !== undefined && <div className="mt-8 flex flex-col items-stretch gap-3">{footer}</div>}
      </div>
    </main>
  );
}

export function AppLogo({ size = 72 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/icons/icon.svg" alt="" width={size} height={size} className="rounded-[22%] shadow-[0_3px_8px_rgba(0,0,0,0.12)]" />
  );
}

export function AuthHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6 mt-6">
      <h1 className="font-rounded text-[28px] font-bold leading-tight">{title}</h1>
      {subtitle !== undefined && <p className="mt-2 text-[15px] text-secondary">{subtitle}</p>}
    </header>
  );
}

/** "Confira seu e-mail": check verde e o endereço para onde o código foi. */
export function CheckEmailHeader({ email }: { email: string }) {
  const t = useT();
  return (
    <header className="flex flex-col items-center pt-12 text-center">
      <span aria-hidden="true" className="mb-3 inline-flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[var(--room-green)] text-white">
        <Check size={34} strokeWidth={2.5} />
      </span>
      <h1 className="font-rounded text-[22px] font-bold">{t("Confira seu e-mail")}</h1>
      <p className="mt-2 text-[16px] text-secondary">{t("Mandamos um código para {0}. Se não chegar, olhe o spam.", email)}</p>
    </header>
  );
}

/** Grupo de campos com separador (o `AuthFieldGroup` do app). Cada campo tem rótulo visível acima do grupo. */
export function FieldGroup({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-[var(--radius-control)] bg-card [&>*+*]:border-t [&>*+*]:border-separator">{children}</div>;
}

export function Field({
  label, value, onChange, type = "text", autoComplete, inputMode, autoFocus, name, disabled, placeholder, className, maxLength, center,
}: {
  label: string; value: string; onChange: (value: string) => void; type?: "text" | "email" | "password";
  autoComplete?: string; inputMode?: "text" | "email" | "numeric"; autoFocus?: boolean; name?: string; disabled?: boolean;
  placeholder?: string; className?: string; maxLength?: number; center?: boolean;
}) {
  const id = useId();
  return (
    <div className={cx("flex flex-col px-4 py-2", className)}>
      <label htmlFor={id} className="text-[13px] text-secondary">{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        autoCapitalize={type === "text" ? undefined : "none"}
        autoCorrect="off"
        spellCheck={false}
        className={cx("min-h-[32px] w-full bg-transparent text-[17px] text-label outline-none placeholder:text-muted disabled:opacity-60", center === true && "text-center font-mono text-[20px] tracking-[0.2em]")}
      />
    </div>
  );
}

/** Texto curto abaixo dos campos: dica (cinza) ou erro (vermelho), anunciado ao leitor de tela. */
export function Footnote({ text, error = false }: { text: string; error?: boolean }) {
  return (
    <p role={error ? "alert" : "status"} className={cx("mt-2 px-4 text-[13px]", error ? "text-danger" : "text-secondary")}>
      {text}
    </p>
  );
}

/** "Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade" (sem as duas URLs, a frase curta). */
export function LegalNotice({ legal }: { legal: LegalLinks }) {
  const t = useT();
  if (legal.terms === null || legal.privacy === null) {
    return <p className="text-center text-[12px] text-secondary">{t("Ao continuar, você concorda com a Política de Privacidade.")}</p>;
  }
  const parts = parseLinks(t("Ao continuar, você concorda com os [Termos de Uso]({0}) e a [Política de Privacidade]({1}).", legal.terms, legal.privacy));
  return (
    <p className="text-center text-[12px] text-secondary">
      {parts.map((part, index) => part.href === undefined
        ? <span key={index}>{part.text}</span>
        : <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">{part.text}</a>)}
    </p>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-[44px] items-center rounded-full px-2 text-[16px] text-accent hover:bg-fill">
      {children}
    </Link>
  );
}
