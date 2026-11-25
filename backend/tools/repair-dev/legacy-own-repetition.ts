// Reparo de uma definição **antiga** na tabela DynamoDB **real** (`dev`). Só roda com autorização explícita do dono.
//
// Definições gravadas antes de `followsRoom` com política de calendário (`balancedAutomatically`) e intervalo diferente
// do cômodo não acompanham o cômodo: o app as mostra como "Repetição própria", mas o servidor as agenda como rodízio de
// calendário, com uma vez aberta por morador até ser concluída. O reparo faz o mesmo que `convertRepetition` para a
// repetição própria: tira as vezes não concluídas, grava `followsRoom: false` e `afterCompletion` com o mesmo intervalo
// e recria a tarefa (uma vez aberta). Concluídas e saldo não mudam.
//
//   TABLE_NAME=grupuxo-dev node tools/repair-dev/legacy-own-repetition.ts <houseID> <taskDefinitionID>          # simula
//   TABLE_NAME=grupuxo-dev node tools/repair-dev/legacy-own-repetition.ts <houseID> <taskDefinitionID> --apply  # grava
//   TABLE_NAME=grupuxo-dev node tools/repair-dev/legacy-own-repetition.ts <houseID> --all [--apply]   # todas da casa
//
// Só entram definições antigas (sem `followsRoom`), recorrentes, ativas, fora de `afterCompletion` e que não acompanham
// o cômodo; tudo numa transação da casa.

import { isCompleted, isActiveAssignment, type TaskDefinition } from "../../src/domain/entities.ts";
import type { TaskSchedulingService } from "../../src/domain/services/task-scheduling-service.ts";
import type { StoreState } from "../../src/domain/store-state.ts";
import { schedulingFor } from "../../src/domain/commands/context.ts";
import { houseID as toHouseID } from "../../src/domain/ids.ts";
import { houseAdapters } from "../../src/main/dynamo-adapters.ts";
import { dynamoClient, newID, now } from "../../src/main/runtime.ts";

class DryRun extends Error {}

const args = process.argv.slice(2);
const [house, target] = args;
const table = process.env["TABLE_NAME"];
if (house === undefined || target === undefined || table === undefined || table === "") {
  console.error("Uso: TABLE_NAME=… legacy-own-repetition.ts <houseID> <taskDefinitionID|--all> [--apply]");
  process.exit(2);
}
const apply = args.includes("--apply");
const { store } = houseAdapters(dynamoClient(table));
const date = now();
const day = (ms: number | null): string => (ms === null ? "—" : new Date(ms).toISOString().slice(0, 16));
const report: string[] = [];

try {
  await store.update(toHouseID(house), (state) => {
    report.length = 0; // a transação pode repetir num conflito de versão
    const scheduling = schedulingFor({ now: () => date, newID }, state, toHouseID(house));
    const ids = target === "--all"
      ? state.definitions.filter((d) => isLegacyOwn(d, scheduling, state)).map((d) => d.id)
      : [target];
    if (ids.length === 0) throw new Error("nenhuma definição antiga a reparar");
    for (const id of ids) repair(id, scheduling, state);
    if (!apply) throw new DryRun();
  });
  console.log(`Gravado:\n${report.join("\n")}`);
} catch (error) {
  if (!(error instanceof DryRun)) throw error;
  console.log(`Simulação (nada gravado; use --apply):\n${report.join("\n")}`);
}

function isLegacyOwn(definition: TaskDefinition, scheduling: TaskSchedulingService, state: StoreState): boolean {
  return definition.followsRoom === undefined && definition.kind === "recurring" && definition.endedAt === null &&
    definition.assignmentPolicy !== "afterCompletion" && definition.assignmentPolicy !== "selfAssigned" &&
    definition.recurrence.kind === "recurring" && !scheduling.isRoomLinked(definition, state);
}

function repair(task: string, scheduling: TaskSchedulingService, state: StoreState): void {
  const index = state.definitions.findIndex((d) => d.id === task);
  const definition = state.definitions[index];
  if (definition === undefined) throw new Error("tarefa não encontrada");
  if (!isLegacyOwn(definition, scheduling, state)) {
    throw new Error(`${task.slice(0, 8)} não é uma definição antiga de repetição própria; nada a reparar`);
  }
  const owner = (occurrenceID: string): string =>
    state.assignments.filter((a) => a.occurrenceID === occurrenceID && isActiveAssignment(a)).map((a) => a.userID.slice(0, 8)).join(",") || "—";
  const removed = state.occurrences.filter((o) => o.taskDefinitionID === definition.id && !isCompleted(o));
  const removedIDs = new Set<string>(removed.map((o) => o.id));
  const swaps = state.taskSwapRequests.filter((s) =>
    s.status === "pending" && (removedIDs.has(s.offeredOccurrenceID) || removedIDs.has(s.requestedOccurrenceID))
  );
  if (swaps.length > 0) throw new Error(`${definition.name}: ${swaps.length} troca(s) pendente(s) citam essas vezes; resolva antes`);
  report.push(`${definition.name} (${definition.id.slice(0, 8)}):`);
  for (const o of removed) report.push(`  remove ${o.id.slice(0, 8)} abre ${day(o.availableAt)} prazo ${day(o.dueAt)} de ${owner(o.id)}`);

  // Quem está com a vez agora (a mais antiga já aberta) continua com ela; a fila segue a partir dele.
  const current = removed.filter((o) => o.availableAt <= date).sort((a, b) => a.availableAt - b.availableAt)
    .map((o) => state.assignments.find((a) => a.occurrenceID === o.id && isActiveAssignment(a))?.userID)
    .find((u) => u !== undefined);
  state.occurrences = state.occurrences.filter((o) => !removedIDs.has(o.id));
  state.assignments = state.assignments.filter((a) => !removedIDs.has(a.occurrenceID));
  state.definitions.splice(index, 1);
  const converted: TaskDefinition = { ...definition, followsRoom: false, assignmentPolicy: "afterCompletion", calendarAnchor: null };
  scheduling.create(converted, date, state);
  // A vez nova não abre antes da hora: um intervalo depois da última conclusão (regra da repetição própria) ou, sem
  // conclusão, quando abria a primeira das vezes removidas. Já passou? Abre agora.
  const lastCompletion = Math.max(-Infinity, ...state.occurrences
    .filter((o) => o.taskDefinitionID === definition.id && o.completedAt !== null).map((o) => o.completedAt ?? -Infinity));
  const firstRemoved = Math.min(Infinity, ...removed.map((o) => o.availableAt));
  const created = state.definitions.find((d) => d.id === definition.id);
  const planned = Number.isFinite(lastCompletion) && created !== undefined
    ? scheduling.ownNextOpening(lastCompletion, created)
    : Number.isFinite(firstRemoved) ? firstRemoved : date;
  if (planned > date && created !== undefined) {
    state.occurrences = state.occurrences.map((o) =>
      o.taskDefinitionID === definition.id && !isCompleted(o)
        ? { ...o, availableAt: planned, dueAt: scheduling.ownWindowEnd(planned, created) }
        : o
    );
  }
  const defIndex = state.definitions.findIndex((d) => d.id === definition.id);
  const queued = state.definitions[defIndex];
  const position = current === undefined || queued === undefined ? -1 : queued.rotationQueue.indexOf(current);
  if (current !== undefined && queued !== undefined && position >= 0) {
    const fresh = new Set(state.occurrences.filter((o) => o.taskDefinitionID === definition.id && !isCompleted(o)).map((o) => o.id));
    state.assignments = state.assignments.map((a) => (fresh.has(a.occurrenceID) && isActiveAssignment(a) ? { ...a, userID: current } : a));
    state.definitions[defIndex] = { ...queued, currentRotationIndex: (position + 1) % queued.rotationQueue.length };
  }
  for (const o of state.occurrences.filter((o) => o.taskDefinitionID === definition.id && !isCompleted(o))) {
    report.push(`  cria   ${o.id.slice(0, 8)} abre ${day(o.availableAt)} prazo ${day(o.dueAt)} de ${owner(o.id)}`);
  }
}
