"use client";

import { useCallback, useRef, useState } from "react";
import type { HouseSnapshot, TaskItem } from "@/lib/api/types";
import { tasks } from "@/lib/client/endpoints";
import { useInvalidateHouse } from "@/lib/client/queries";
import { NO_COMPLETIONS, acceptReload, applyToSnapshot, begin, finish, type CompletionState } from "./optimistic";

/** Concluir/desmarcar com prévia imediata; a recarga depois da última escrita reconcilia com o servidor. */
export function useCompletions(userID: string, onError: (error: unknown) => void) {
  const [state, setState] = useState<CompletionState>(NO_COMPLETIONS);
  const current = useRef(state);
  const invalidate = useInvalidateHouse();
  const update = useCallback((change: (s: CompletionState) => CompletionState) => {
    current.current = change(current.current);
    setState(current.current);
  }, []);

  const toggle = useCallback(async (item: TaskItem) => {
    const id = item.occurrence.id;
    if (current.current.pending.has(id)) return;
    update((s) => begin(s, item, userID, Date.now()));
    try {
      if (item.occurrence.status === "completed") await tasks.reopen(id);
      else await tasks.complete(id);
      update((s) => finish(s, id));
    } catch (error) {
      update((s) => finish(s, id, item));
      onError(error);
    }
    if (current.current.pending.size === 0) {
      await invalidate();
      update(acceptReload);
    }
  }, [invalidate, onError, update, userID]);

  const apply = useCallback((snapshot: HouseSnapshot) => applyToSnapshot(state, snapshot), [state]);
  const isPending = useCallback((occurrenceID: string) => state.pending.has(occurrenceID), [state]);
  return { toggle, apply, isPending };
}
