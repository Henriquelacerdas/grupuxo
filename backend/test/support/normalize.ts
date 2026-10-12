import type { StoreState } from "../../src/domain/store-state.ts";

/** Estado com cada coleção ordenada por ID, para comparar o que veio de adaptadores diferentes. */
export function normalizedState(state: StoreState): unknown {
  const byID = <T extends { readonly id: string }>(items: readonly T[]) => [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    users: byID(state.users), houses: byID(state.houses), houseMemberships: byID(state.houseMemberships), rooms: byID(state.rooms),
    roomMemberships: byID(state.roomMemberships), definitions: byID(state.definitions), occurrences: byID(state.occurrences),
    assignments: byID(state.assignments), absences: byID(state.absences), swaps: byID(state.taskSwapRequests),
    notifications: byID(state.notifications),
  };
}
