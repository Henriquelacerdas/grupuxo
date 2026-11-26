"use client";

import type { QueryClient } from "@tanstack/react-query";
import { auth } from "./endpoints";
import { disablePush } from "./web-push";

/** Preferências do navegador que são da conta (somem no logout, como o `AuthService.signOut` do app). */
export const ACCOUNT_STORAGE_PREFIX = "reveza.account.";

export function clearAccountStorage(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(ACCOUNT_STORAGE_PREFIX)) localStorage.removeItem(key);
    sessionStorage.clear();
  } catch {
    // armazenamento bloqueado: nada a limpar
  }
}

/** Sair: tira o push deste navegador, revoga a sessão, limpa o cache e volta ao login. */
export async function signOut(client: QueryClient, destination = "/login"): Promise<void> {
  await disablePush();
  await auth.signOut().catch(() => undefined);
  client.clear();
  clearAccountStorage();
  window.location.assign(destination);
}
