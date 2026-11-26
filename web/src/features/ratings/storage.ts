"use client";

import { ACCOUNT_STORAGE_PREFIX } from "@/lib/client/account";

// "Já avaliei" não tem rota no servidor: o navegador lembra até a janela fechar (como o app, só neste aparelho).
// A chave tem o prefixo da conta, então some no logout.

const key = (houseID: string, userID: string): string => `${ACCOUNT_STORAGE_PREFIX}weekRating.submittedUntil.${houseID}.${userID}`;

export function submittedUntil(houseID: string, userID: string, now: number): number | null {
  try {
    const value = Number(localStorage.getItem(key(houseID, userID)) ?? "");
    return Number.isFinite(value) && value > now ? value : null;
  } catch {
    return null;
  }
}

export function rememberSubmitted(houseID: string, userID: string, windowEnd: number): void {
  try {
    localStorage.setItem(key(houseID, userID), String(windowEnd));
  } catch {
    // armazenamento bloqueado: a linha "Avaliação enviada" só não aparece
  }
}
