import assert from "node:assert/strict";
import { test } from "node:test";
import { recurring } from "../../src/domain/value-objects.ts";
import { isCompleted, type TaskItem } from "../../src/domain/entities.ts";
import { taskSwapRequestID, type TaskOccurrenceID } from "../../src/domain/ids.ts";
import type { StoreState } from "../../src/domain/store-state.ts";
import {
  CreateRoomUseCase,
} from "../../src/domain/use-cases/houses-and-rooms.ts";
import type { RepositoryEnv } from "../contract/repositories.ts";
import { normalizedState } from "../support/normalize.ts";
import { World } from "../support/world.ts";
import { dynamoEnvironment, inMemoryEnvironment } from "./environment.ts";

// Teste diferencial: a mesma sequência de operações roda no adaptador em memória e no DynamoDB (cliente falso),
// com mundos idênticos (relógio e IDs determinísticos). Cada passo registra o resultado devolvido e o estado
// inteiro da casa; as duas listas precisam ser iguais.

const WEEK = 7 * 24 * 3_600_000;

function outcome(result: unknown): unknown {
  return result === undefined ? null : JSON.parse(JSON.stringify(result));
}

async function script(world: World, env: RepositoryEnv): Promise<unknown[]> {
  const { users, house, rooms } = world.seed;
  const log: unknown[] = [];
  const step = async (name: string, run: () => Promise<unknown>): Promise<void> => {
    let result: unknown;
    try {
      result = await run();
    } catch (error) {
      result = { error: error instanceof Error ? `${error.name}:${error.message}` : "?" };
    }
    log.push({ name, result: outcome(result), state: normalizedState(await env.state()) });
  };

  await step("minhas tarefas de Marina", () => env.tasks.tasks(users.marina.id, house.id));
  const open = (await env.tasks.tasks(users.marina.id, house.id)).find((item) => !isCompleted(item.occurrence));
  await step("concluir", async () => open && env.tasks.complete(open.occurrence.id, users.marina.id, world.now));
  await step("concluir de novo", async () => open && env.tasks.complete(open.occurrence.id, users.marina.id, world.now));
  await step("reabrir", async () => open && env.tasks.reopen(open.occurrence.id, users.marina.id));
  const [sporadic] = await env.tasks.sporadicTasks(house.id, users.leo.id);
  await step("esporádicas", () => env.tasks.sporadicTasks(house.id, users.bia.id));
  await step("assumir", async () => sporadic && env.tasks.claim(sporadic.occurrence.id, users.leo.id, world.now));
  await step("assumir por outro", async () => sporadic && env.tasks.claim(sporadic.occurrence.id, users.bia.id, world.now));
  await step("devolver", async () => sporadic && env.tasks.release(sporadic.occurrence.id, users.leo.id));

  // Primeira ocorrência disponível, de alguém, que tenha candidato a troca (como `swappablePair` do contrato).
  let owned: { readonly userID: typeof users.leo.id; readonly occurrenceID: TaskOccurrenceID } | undefined;
  let candidates: TaskItem[] = [];
  for (const assignment of (await env.state()).assignments) {
    if (assignment.endedAt !== null || assignment.supersededAt !== null) continue;
    const occurrence = (await env.state()).occurrences.find((o) => o.id === assignment.occurrenceID);
    if (occurrence === undefined || occurrence.availableAt > world.now || isCompleted(occurrence)) continue;
    const found = await env.swaps.swapCandidates(assignment.userID, assignment.occurrenceID, house.id, world.now);
    if (found[0]?.assignment) {
      owned = { userID: assignment.userID, occurrenceID: assignment.occurrenceID };
      candidates = found;
      break;
    }
  }
  const wanted = candidates[0];
  await step("candidatos", async () => candidates);
  let requestID: string | undefined;
  await step("pedir troca", async () => {
    if (owned === undefined || wanted === undefined) return null;
    const request = await env.swaps.createRequest(owned.userID, owned.occurrenceID, wanted.occurrence.id, world.now);
    requestID = request.id;
    return request;
  });
  await step("pedidos recebidos", async () => wanted?.assignment && env.swaps.incomingRequests(wanted.assignment.userID, house.id));
  await step("notificações", async () => wanted?.assignment && env.notifications.notifications(wanted.assignment.userID));
  await step("aceitar troca", async () => {
    if (requestID === undefined || wanted?.assignment === null || wanted === undefined) return null;
    return env.swaps.accept(taskSwapRequestID(requestID), wanted.assignment.userID, world.now);
  });
  const requester = owned?.userID ?? users.leo.id;
  await step("notificações de quem pediu", () => env.notifications.notifications(requester));
  await step("marcar como lida", async () => {
    const first = (await env.notifications.notifications(requester))[0];
    return first && env.notifications.markAsRead(first.id, requester, world.now);
  });

  await step("criar tarefa", () => env.tasks.create(world.definition(rooms.kitchen.id, { name: "Limpar geladeira", effort: 2, recurrence: recurring("weekly", 2) }), users.marina.id, world.now));
  await step("criar cômodo", () => new CreateRoomUseCase(env.rooms, env.houses, () => world.now, world.newID).execute({
    name: "Varanda", houseID: house.id, creatorUserID: users.marina.id, visibility: "common",
  }));
  await step("cômodos", () => env.rooms.rooms(house.id, users.rafa.id));
  await step("participação", () => env.rooms.participation(rooms.kitchen.id, users.rafa.id, world.now));
  await step("tarefas do cômodo", () => env.tasks.roomTasks(rooms.kitchen.id, users.rafa.id));
  await step("sair do cômodo privado", () => env.tasks.removeMember(users.bia.id, rooms.privateOffice.id, world.now, true));
  await step("entrar no cômodo privado", () => env.tasks.addMember(users.leo.id, rooms.privateOffice.id, world.now));

  for (let weeks = 1; weeks <= 3; weeks += 1) {
    world.now += WEEK;
    await step(`semana +${weeks}: escala`, () => env.tasks.refreshSchedule(house.id, world.now));
    await step(`semana +${weeks}: minhas tarefas`, () => env.tasks.tasks(users.rafa.id, house.id));
  }
  await step("moradores", () => env.houses.members(house.id));
  await step("casas do morador", () => env.houses.houses(users.rafa.id));
  return log;
}

test("a mesma sequência de operações dá o mesmo resultado e o mesmo estado em memória e no DynamoDB", async () => {
  const memoryWorld = new World({ timezone: "America/Sao_Paulo" });
  const dynamoWorld = new World({ timezone: "America/Sao_Paulo" });
  const memory = await script(memoryWorld, inMemoryEnvironment(memoryWorld));
  const dynamo = await script(dynamoWorld, await dynamoEnvironment(dynamoWorld));
  assert.equal(dynamo.length, memory.length);
  memory.forEach((entry, index) => assert.deepEqual(dynamo[index], entry, `passo ${index}`));
});

test("a sequência exercita de fato os comandos: só os passos esperados terminam em erro", async () => {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const log = await script(world, inMemoryEnvironment(world));
  const entries = log.map((entry) => {
    assert.ok(typeof entry === "object" && entry !== null && "name" in entry && "result" in entry);
    return { name: String(entry.name), result: entry.result };
  });
  const failed = entries.filter((e) => typeof e.result === "object" && e.result !== null && "error" in e.result).map((e) => e.name);
  assert.deepEqual(failed, ["assumir por outro"]);
  const succeeded = (name: string) => entries.find((e) => e.name === name)?.result;
  assert.notEqual(succeeded("pedir troca"), null);
  assert.notEqual(succeeded("aceitar troca"), null);
  assert.notEqual(succeeded("criar tarefa"), null);
  assert.notEqual(succeeded("criar cômodo"), null);
});
