"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import * as endpoints from "./endpoints";

// Chaves e consultas compartilhadas. O snapshot é a carga principal (como o `MyHouseCache` do app): válido por
// 5 s, invalidado em toda mutação bem-sucedida, recarregado ao voltar para a aba e a cada 30 s com a aba visível.

export const keys = {
  session: ["session"],
  snapshot: ["snapshot"],
  notifications: ["notifications"],
  swaps: ["swaps"],
  preferences: ["preferences"],
  vacation: ["vacation"],
  whatsApp: ["whatsapp"],
  pendingRatings: ["ratings", "pending"],
  ratingSummary: ["ratings", "summary"],
  room: (roomID: string) => ["room", roomID] as const,
  roomTasks: (roomID: string) => ["room", roomID, "tasks"] as const,
  accessRequests: (roomID: string) => ["room", roomID, "access-requests"] as const,
  swapCandidates: (occurrenceID: string) => ["swap-candidates", occurrenceID] as const,
} as const;

export const POLL_MS = 30_000;

export function useSnapshotQuery() {
  return useQuery({ queryKey: keys.snapshot, queryFn: endpoints.house.snapshot, refetchInterval: POLL_MS });
}

export function useNotificationsQuery(enabled = true) {
  return useQuery({ queryKey: keys.notifications, queryFn: endpoints.notifications.list, refetchInterval: POLL_MS, enabled });
}

export function useSwapsQuery() {
  return useQuery({ queryKey: keys.swaps, queryFn: endpoints.swaps.mine, refetchInterval: POLL_MS });
}

export function useSessionQuery() {
  return useQuery({ queryKey: keys.session, queryFn: endpoints.auth.session, staleTime: 60_000 });
}

/** Depois de qualquer mutação na casa: tudo que depende da escala volta a ser buscado. */
export function invalidateHouse(client: QueryClient): Promise<void> {
  return client.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      return head !== "session" && head !== "preferences" && head !== "whatsapp";
    },
  });
}

export function useInvalidateHouse(): () => Promise<void> {
  const client = useQueryClient();
  return () => invalidateHouse(client);
}

/** "Agora" que anda de minuto em minuto (os rótulos "Termina hoje" mudam sem recarregar). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    const onVisible = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [intervalMs]);
  return now;
}
