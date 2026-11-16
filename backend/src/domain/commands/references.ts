import type { StoreState } from "../store-state.ts";

/**
 * Tira do estado o que aponta para algo que já não existe: trocas cujas ocorrências sumiram (cômodo ou tarefa
 * apagados) e avisos que citam uma troca, tarefa ou cômodo inexistente. Roda no fim dos comandos que podem apagar
 * cômodos ou tarefas por outro caminho (último participante sai, cômodo excluído), para nada ficar pendurado.
 */
export function pruneDanglingReferences(state: StoreState): void {
  const occurrenceIDs = new Set(state.occurrences.map((o) => o.id));
  state.taskSwapRequests = state.taskSwapRequests.filter(
    (r) => occurrenceIDs.has(r.offeredOccurrenceID) && occurrenceIDs.has(r.requestedOccurrenceID),
  );
  const swapIDs = new Set(state.taskSwapRequests.map((r) => r.id));
  const definitionIDs = new Set(state.definitions.map((d) => d.id));
  const roomIDs = new Set(state.rooms.map((r) => r.id));
  state.notifications = state.notifications.filter((n) =>
    (n.swapRequestID === null || swapIDs.has(n.swapRequestID)) &&
    (n.taskDefinitionID === null || definitionIDs.has(n.taskDefinitionID)) &&
    (n.roomID === null || roomIDs.has(n.roomID))
  );
  state.roomAccessRequests = state.roomAccessRequests.filter((r) => roomIDs.has(r.roomID));
  state.roomRatings = state.roomRatings.filter((r) => roomIDs.has(r.roomID));
}
