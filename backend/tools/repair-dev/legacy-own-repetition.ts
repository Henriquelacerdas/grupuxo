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

import { isCompleted, isActiveAssignment, type TaskDefinition } from "../../src/domain/entities.ts";
import { schedulingFor } from "../../src/domain/commands/context.ts";
import { houseID as toHouseID } from "../../src/domain/ids.ts";
import { houseAdapters } from "../../src/main/dynamo-adapters.ts";
import { dynamoClient, newID, now } from "../../src/main/runtime.ts";

class DryRun extends Error {}

const [house, task, flag] = process.argv.slice(2);
const table = process.env["TABLE_NAME"];
if (house === undefined || task === undefined || table === undefined || table === "") {
  console.error("Uso: TABLE_NAME=… legacy-own-repetition.ts <houseID> <taskDefinitionID> [--apply]");
  process.exit(2);
}
const apply = flag === "--apply";
const { store } = houseAdapters(dynamoClient(table));
const date = now();
const day = (ms: number | null): string => (ms === null ? "—" : new Date(ms).toISOString().slice(0, 16));
const report: string[] = [];

try {
  await store.update(toHouseID(house), (state) => {
    const scheduling = schedulingFor({ now: () => date, newID }, state, toHouseID(house));
    const index = state.definitions.findIndex((d) => d.id === task);
    const definition = state.definitions[index];
    if (definition === undefined) throw new Error("tarefa não encontrada");
    if (definition.kind !== "recurring" || definition.endedAt !== null || definition.assignmentPolicy === "afterCompletion" ||
      definition.recurrence.kind !== "recurring" || scheduling.isRoomLinked(definition, state)) {
      throw new Error("a tarefa não é uma definição antiga de repetição própria; nada a reparar");
    }
    const owner = (occurrenceID: string): string =>
      state.assignments.filter((a) => a.occurrenceID === occurrenceID && isActiveAssignment(a)).map((a) => a.userID.slice(0, 8)).join(",") || "—";
    const removed = state.occurrences.filter((o) => o.taskDefinitionID === definition.id && !isCompleted(o));
    const removedIDs = new Set<string>(removed.map((o) => o.id));
    const swaps = state.taskSwapRequests.filter((s) =>
      s.status === "pending" && (removedIDs.has(s.offeredOccurrenceID) || removedIDs.has(s.requestedOccurrenceID))
    );
    if (swaps.length > 0) throw new Error(`${swaps.length} troca(s) pendente(s) citam essas vezes; resolva antes`);
    for (const o of removed) report.push(`  remove ${o.id.slice(0, 8)} abre ${day(o.availableAt)} prazo ${day(o.dueAt)} de ${owner(o.id)}`);

    state.occurrences = state.occurrences.filter((o) => !removedIDs.has(o.id));
    state.assignments = state.assignments.filter((a) => !removedIDs.has(a.occurrenceID));
    state.definitions.splice(index, 1);
    const converted: TaskDefinition = {
      ...definition, followsRoom: false, assignmentPolicy: "afterCompletion", calendarAnchor: null,
    };
    scheduling.create(converted, date, state);
    for (const o of state.occurrences.filter((o) => o.taskDefinitionID === definition.id && !isCompleted(o))) {
      report.push(`  cria   ${o.id.slice(0, 8)} abre ${day(o.availableAt)} prazo ${day(o.dueAt)} de ${owner(o.id)}`);
    }
    if (!apply) throw new DryRun();
  });
  console.log(`Gravado. "${task}":\n${report.join("\n")}`);
} catch (error) {
  if (!(error instanceof DryRun)) throw error;
  console.log(`Simulação (nada gravado; use --apply):\n${report.join("\n")}`);
}
