"use client";

import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { useT } from "@/i18n/provider";

/** Ícone branco num quadrado arredondado colorido (SettingsIcon do app). */
export function SettingsIcon({ icon: Icon, tint }: { icon: LucideIcon; tint: string }) {
  return (
    <span aria-hidden="true" className="inline-flex h-[29px] w-[29px] shrink-0 items-center justify-center rounded-[7px] text-white" style={{ background: tint }}>
      <Icon size={17} strokeWidth={2.25} />
    </span>
  );
}

const rowClasses = "flex min-h-[48px] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-fill";

/** Linha que leva a outra tela (com a seta) ou a um link externo. */
export function LinkRow({ href, icon, tint, children, value, external = false }: {
  href: string; icon?: LucideIcon; tint?: string; children: ReactNode; value?: ReactNode; external?: boolean;
}) {
  const body = (
    <>
      {icon !== undefined && <SettingsIcon icon={icon} tint={tint ?? "var(--accent-fill)"} />}
      <span className="min-w-0 flex-1">{children}</span>
      {value !== undefined && value !== null && <span className="shrink-0 text-secondary">{value}</span>}
      <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-muted" />
    </>
  );
  if (external) return <a href={href} target={href.startsWith("mailto:") ? undefined : "_blank"} rel="noopener noreferrer" className={rowClasses}>{body}</a>;
  return <Link href={href} className={rowClasses}>{body}</Link>;
}

/** Linha só de leitura: título à esquerda, valor à direita (LabeledContent). */
export function ValueRow({ icon, tint, label, value }: { icon?: LucideIcon; tint?: string; label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-h-[48px] items-center gap-3 px-4 py-2.5">
      {icon !== undefined && <SettingsIcon icon={icon} tint={tint ?? "var(--accent-fill)"} />}
      <span className="min-w-0 flex-1">{label}</span>
      <span className="min-w-0 truncate text-right text-secondary">{value}</span>
    </div>
  );
}

/** Botão de linha inteira (centralizado, como "Sair da conta"). */
export function ActionRow({ children, onClick, destructive = false, disabled = false }: {
  children: ReactNode; onClick: () => void; destructive?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cx(rowClasses, "justify-center disabled:opacity-50", destructive ? "text-danger" : "text-accent")}>
      {children}
    </button>
  );
}

/** Título da subtela com o "voltar" para Ajustes (a barra de navegação do app). */
export function SubpageHeader({ title, back = "/app/settings", backLabel }: { title: string; back?: string; backLabel?: string }) {
  const t = useT();
  return (
    <header className="mb-5 pt-2">
      <Link href={back} className="-ml-2 inline-flex min-h-[44px] items-center gap-0.5 rounded-full pr-3 text-[17px] text-accent hover:bg-fill">
        <ChevronLeft aria-hidden="true" size={24} />
        {backLabel ?? t("Ajustes")}
      </Link>
      <h1 className="font-rounded text-[34px] font-bold leading-tight tracking-tight">{title}</h1>
    </header>
  );
}

/** "Copiar" → "Copiado" por um instante (CopyCodeButton). */
export function CopyButton({ value, label, accessibleLabel }: { value: string; label?: string; accessibleLabel?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={accessibleLabel}
      onClick={() => { void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined); }}
      className="inline-flex min-h-[44px] shrink-0 items-center"
    >
      <span className="rounded-full bg-accent-soft px-3 py-1.5 text-[15px] text-accent">{copied ? t("Copiado") : (label ?? t("Copiar"))}</span>
      <span className="sr-only" aria-live="polite">{copied ? t("Copiado") : ""}</span>
    </button>
  );
}
