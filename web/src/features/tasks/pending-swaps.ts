"use client";

import { useMemo } from "react";
import type { SwapRequest } from "@/lib/api/types";
import { useSwapsQuery } from "@/lib/client/queries";

/** Trocas que você pediu e ainda não foram respondidas, pela ocorrência oferecida. Falha só some com o aviso. */
export function usePendingSwaps(): ReadonlyMap<string, SwapRequest> {
  const swaps = useSwapsQuery();
  return useMemo(() => {
    const map = new Map<string, SwapRequest>();
    for (const swap of swaps.data?.outgoing ?? []) {
      if (swap.status === "pending" && !map.has(swap.offeredOccurrenceID.toLowerCase())) map.set(swap.offeredOccurrenceID.toLowerCase(), swap);
    }
    return map;
  }, [swaps.data]);
}
