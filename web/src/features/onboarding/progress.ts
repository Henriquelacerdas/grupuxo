"use client";

import { useSyncExternalStore } from "react";

// O app-shell troca o onboarding pela casa assim que o snapshot responde 200. Depois de criar a casa, o snapshot
// já existe, mas os passos "Primeiros cômodos", "Convidar" e "Notificações" ainda faltam (o `isFinishing` do
// HouseGateView). Enquanto isto for verdadeiro, o app-shell continua mostrando o onboarding.

let finishing = false;
const listeners = new Set<() => void>();

export function setOnboardingFinishing(value: boolean): void {
  if (finishing === value) return;
  finishing = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOnboardingFinishing(): boolean {
  return useSyncExternalStore(subscribe, () => finishing, () => false);
}
