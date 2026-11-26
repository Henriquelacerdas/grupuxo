"use client";

import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/sheet";
import { useT } from "@/i18n/provider";

/** Alerta de erro do iOS ("Não foi possível…" + mensagem + OK). */
export function useAlert() {
  const t = useT();
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null);
  const show = useCallback((title: string, message: string) => setAlert({ title, message }), []);
  const node = (
    <ConfirmDialog
      open={alert !== null}
      onOpenChange={(open) => { if (!open) setAlert(null); }}
      title={alert?.title ?? ""}
      {...(alert !== null ? { message: alert.message } : {})}
      actions={[]}
      cancelLabel={t("OK")}
    />
  );
  return { show, node };
}

/** Cor do cômodo escurecida (claro) ou clareada (escuro) para texto com contraste AA. */
export const roomTextColor = (color: string): string => `color-mix(in srgb, var(--room-${color}) 55%, var(--label))`;
