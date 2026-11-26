"use client";

import { ArrowDown, ArrowUp, Lock } from "lucide-react";
import { useState } from "react";
import { RoomIcon } from "@/components/icons";
import { ConfirmDialog, Sheet } from "@/components/sheet";
import { Section } from "@/components/ui";
import { useT } from "@/i18n/provider";
import type { Room } from "@/lib/api/types";
import { move } from "./order";

/** "Reordenar" (ReordenarComodosView): subir/descer no lugar do arrastar do iOS; salva só na sessão. */
export function ReorderSheet({ open, onOpenChange, rooms, onSave }: {
  open: boolean; onOpenChange: (open: boolean) => void; rooms: readonly Room[]; onSave: (ids: readonly string[]) => void;
}) {
  const t = useT();
  const [order, setOrder] = useState<readonly Room[]>(rooms);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [opened, setOpened] = useState(open);
  if (open !== opened) {
    setOpened(open);
    if (open) setOrder(rooms);
  }
  const dirty = order.some((room, index) => room.id !== rooms[index]?.id);
  const close = () => (dirty ? setConfirmDiscard(true) : onOpenChange(false));

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => (next ? onOpenChange(true) : close())}
        title={t("Reordenar")}
        cancel={{ label: t("Cancelar"), onSelect: close }}
        confirm={{ label: t("Salvar ordem"), onSelect: () => { onSave(order.map((room) => room.id)); onOpenChange(false); } }}
      >
        <Section footer={t("Arraste para mudar a ordem em que os cômodos aparecem na aba Casa.")}>
          {order.map((room, index) => (
            <div key={room.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
              <RoomIcon icon={room.icon} color={room.color} size={32} />
              <span className="min-w-0 flex-1 truncate">{room.name}</span>
              {room.visibility === "privateRoom" && <Lock aria-label={t("Cômodo privado")} size={15} className="text-secondary" />}
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-accent hover:bg-fill disabled:opacity-30"
                aria-label={t("Mover {0} para cima", room.name)}
                disabled={index === 0}
                onClick={() => setOrder((current) => move(current, index, index - 1))}
              >
                <ArrowUp aria-hidden="true" size={20} />
              </button>
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-accent hover:bg-fill disabled:opacity-30"
                aria-label={t("Mover {0} para baixo", room.name)}
                disabled={index === order.length - 1}
                onClick={() => setOrder((current) => move(current, index, index + 1))}
              >
                <ArrowDown aria-hidden="true" size={20} />
              </button>
            </div>
          ))}
        </Section>
      </Sheet>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t("Descartar alterações?")}
        message={t("Ao descartar, a ordem dos cômodos continua como estava.")}
        actions={[{ label: t("Descartar"), destructive: true, onSelect: () => onOpenChange(false) }]}
      />
    </>
  );
}
