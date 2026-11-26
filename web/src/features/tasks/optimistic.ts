import type { HouseSnapshot, TaskItem } from "@/lib/api/types";

// Prévia visual de concluir/desmarcar (OptimisticTaskCompletions do app): saldo, sucessores e atribuições continuam
// sendo do servidor. Trava por ocorrência; falha restaura a linha; só uma recarga depois da última escrita substitui
// as prévias confirmadas.

export interface CompletionState {
  readonly pending: ReadonlySet<string>;
  readonly overrides: ReadonlyMap<string, TaskItem>;
}

export const NO_COMPLETIONS: CompletionState = { pending: new Set(), overrides: new Map() };

/** A mesma ocorrência com a conclusão invertida. */
export function toggled(item: TaskItem, userID: string, at: number): TaskItem {
  const completing = item.occurrence.status !== "completed";
  return {
    ...item,
    occurrence: {
      ...item.occurrence,
      status: completing ? "completed" : "assigned",
      completedAt: completing ? at : null,
      completedByUserID: completing ? userID : null,
    },
  };
}

export function begin(state: CompletionState, item: TaskItem, userID: string, at: number): CompletionState {
  const id = item.occurrence.id;
  return {
    pending: new Set([...state.pending, id]),
    overrides: new Map([...state.overrides, [id, toggled(item, userID, at)]]),
  };
}

/** Fim de uma escrita; com `restoring`, a linha volta ao que era (a escrita falhou). */
export function finish(state: CompletionState, id: string, restoring?: TaskItem): CompletionState {
  const pending = new Set(state.pending);
  pending.delete(id);
  const overrides = new Map(state.overrides);
  if (restoring !== undefined) overrides.set(id, restoring);
  return { pending, overrides };
}

/** Recarga iniciada depois de todas as escritas: as prévias saem e vale o servidor. */
export function acceptReload(state: CompletionState): CompletionState {
  return state.pending.size === 0 ? NO_COMPLETIONS : state;
}

export function applyToItem(state: CompletionState, item: TaskItem): TaskItem {
  return state.overrides.get(item.occurrence.id) ?? item;
}

export function applyToSnapshot(state: CompletionState, snapshot: HouseSnapshot): HouseSnapshot {
  if (state.overrides.size === 0) return snapshot;
  const map = (items: readonly TaskItem[]) => items.map((item) => applyToItem(state, item));
  return { ...snapshot, myTasks: map(snapshot.myTasks), roomTasks: map(snapshot.roomTasks), sporadicTasks: map(snapshot.sporadicTasks) };
}
