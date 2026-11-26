"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/i18n/provider";
import { Button, cx } from "./ui";

/**
 * Sheet do iOS: no celular sobe de baixo (cantos de 24 pt), no desktop vira diálogo central. Barra com
 * "Cancelar" à esquerda, título no meio e a ação de confirmar à direita, como as sheets do app.
 */
export function Sheet({
  open, onOpenChange, title, description, children, cancel, confirm, size = "regular",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Botão da esquerda; padrão "Cancelar" (fecha). `null` some com ele. */
  cancel?: { label?: string; onSelect?: () => void } | null;
  confirm?: { label: string; onSelect: () => void; disabled?: boolean; loading?: boolean };
  size?: "regular" | "large";
}) {
  const t = useT();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade fixed inset-0 z-40 bg-[var(--overlay)]" />
        <Dialog.Content
          aria-describedby={description === undefined ? undefined : "sheet-description"}
          className={cx(
            "animate-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[var(--radius-card)] bg-grouped outline-none",
            "lg:inset-auto lg:left-1/2 lg:top-1/2 lg:max-h-[85dvh] lg:w-full lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[var(--radius-card)]",
            size === "large" ? "lg:max-w-2xl" : "lg:max-w-lg",
          )}
        >
          <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pb-2 pt-3">
            <div className="justify-self-start">
              {cancel !== null && (
                <Button variant="plain" size="small" onClick={() => (cancel?.onSelect ?? (() => onOpenChange(false)))()}>
                  {cancel?.label ?? t("Cancelar")}
                </Button>
              )}
            </div>
            <Dialog.Title className="truncate text-center text-[17px] font-semibold">{title}</Dialog.Title>
            <div className="justify-self-end">
              {confirm !== undefined && (
                <Button size="small" disabled={confirm.disabled ?? false} loading={confirm.loading ?? false} onClick={confirm.onSelect}>
                  {confirm.label}
                </Button>
              )}
            </div>
          </div>
          {description !== undefined && <Dialog.Description id="sheet-description" className="sr-only">{description}</Dialog.Description>}
          <div className="safe-bottom min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface ConfirmAction {
  readonly label: string;
  readonly onSelect: () => void;
  readonly destructive?: boolean;
}

/** Alerta/diálogo de confirmação do iOS (título, mensagem, ações e "Cancelar"). */
export function ConfirmDialog({ open, onOpenChange, title, message, actions, cancelLabel }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; message?: string; actions: readonly ConfirmAction[]; cancelLabel?: string;
}) {
  const t = useT();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade fixed inset-0 z-[70] bg-[var(--overlay)]" />
        <Dialog.Content
          role="alertdialog"
          aria-describedby={message === undefined ? undefined : "confirm-message"}
          className="animate-fade fixed left-1/2 top-1/2 z-[80] w-[calc(100%-48px)] max-w-[320px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[14px] bg-elevated text-center outline-none"
        >
          <div className="px-4 pb-4 pt-5">
            <Dialog.Title className="text-[17px] font-semibold">{title}</Dialog.Title>
            {message !== undefined && <Dialog.Description id="confirm-message" className="mt-1 text-[13px] text-label/80">{message}</Dialog.Description>}
          </div>
          <div className="flex flex-col border-t border-separator [&>*+*]:border-t [&>*+*]:border-separator">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={cx("min-h-[44px] text-[17px] transition hover:bg-fill", action.destructive === true ? "text-danger" : "text-accent")}
                onClick={() => { onOpenChange(false); action.onSelect(); }}
              >
                {action.label}
              </button>
            ))}
            <Dialog.Close className="min-h-[44px] text-[17px] font-semibold text-accent transition hover:bg-fill">{cancelLabel ?? t("Cancelar")}</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface MenuItem {
  readonly label: string;
  readonly icon?: LucideIcon;
  readonly onSelect: () => void;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
}

/** Menu da barra (o `Menu` do SwiftUI): botão com ícone e itens com ícone à direita. */
export function Menu({ label, trigger, items, align = "end" }: { label: string; trigger: ReactNode; items: readonly (MenuItem | "separator")[]; align?: "start" | "end" }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger aria-label={label} title={label} className="inline-flex h-11 min-w-11 items-center justify-center rounded-full text-accent transition hover:bg-fill">
        {trigger}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align={align} sideOffset={6} className="animate-fade z-50 min-w-[230px] overflow-hidden rounded-[14px] bg-elevated py-1 shadow-xl ring-1 ring-separator">
          {items.map((item, index) => item === "separator"
            ? <Dropdown.Separator key={`s${index}`} className="my-1 h-px bg-separator" />
            : (
              <Dropdown.Item
                key={item.label}
                disabled={item.disabled ?? false}
                onSelect={item.onSelect}
                className={cx(
                  "flex min-h-[44px] cursor-default items-center justify-between gap-6 px-4 text-[17px] outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-fill",
                  item.destructive === true ? "text-danger" : "text-label",
                )}
              >
                {item.label}
                {item.icon !== undefined && <item.icon aria-hidden="true" size={19} />}
              </Dropdown.Item>
            ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
