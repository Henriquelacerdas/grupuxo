import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { createSeed } from "../src/adapters/in-memory/seed.ts";
import { houseMembers } from "../src/domain/commands/houses.ts";
import { roomParticipation, roomsFor } from "../src/domain/commands/rooms.ts";
import { notificationsFor } from "../src/domain/commands/notifications.ts";
import { createSwapRequest, swapCandidates } from "../src/domain/commands/swaps.ts";
import { completeTask, refreshSchedule, roomTasks, sporadicTasks, userTasks } from "../src/domain/commands/tasks.ts";
import type { CommandContext } from "../src/domain/commands/context.ts";
import { parseInstant } from "../src/domain/dates.ts";
import {
  houseDTO, myHouseDTO, notificationDTO, roomDTO, roomParticipationDTO, taskDefinitionDTO, taskItemDTO,
  taskSwapRequestDTO,
} from "../src/lambdas/api-dto.ts";
import { sequentialIDs } from "./support/state-json.ts";

// Contrato JSON da `api` (BACKEND.md seção 6.1). Os arquivos de `test/fixtures/api/` são o que o app decodifica (teste
// Swift em T4). Sem `API_FIXTURES=write` o teste compara com o que está no repositório; com ela, regrava.

const DIRECTORY = new URL("./fixtures/api/", import.meta.url);
const WRITE = process.env["API_FIXTURES"] === "write";
const NOW = parseInstant("2026-10-14T12:00:00Z");

function check(name: string, value: unknown): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const url = new URL(`${name}.json`, DIRECTORY);
  if (WRITE) {
    mkdirSync(DIRECTORY, { recursive: true });
    writeFileSync(url, text);
    return;
  }
  assert.equal(text, readFileSync(url, "utf8"), `${name}.json diverge do contrato; rode com API_FIXTURES=write e revise o diff`);
}

function world() {
  const newID = sequentialIDs();
  const seed = createSeed({ now: NOW, newID });
  const ctx: CommandContext = { now: () => NOW, newID };
  refreshSchedule(ctx, seed.state, seed.house.id, NOW);
  return { seed, ctx, state: seed.state };
}

test("contrato: casa, moradores e cômodos", () => {
  const { seed, state } = world();
  const marina = seed.users.marina.id;
  check("house", houseDTO(seed.house));
  check("me-house", myHouseDTO(seed.house, houseMembers(state, seed.house.id), roomsFor(state, seed.house.id, marina)));
  check("room", roomDTO(seed.rooms.kitchen));
});

test("contrato: participação no cômodo", () => {
  const { seed, ctx, state } = world();
  check("room-participation", roomParticipationDTO(roomParticipation(ctx, state, seed.rooms.kitchen.id, seed.users.marina.id, NOW)));
});

test("contrato: tarefas (pendente, concluída, esporádica) e definição", () => {
  const { seed, ctx, state } = world();
  const marina = seed.users.marina.id;
  const pending = userTasks(state, marina, seed.house.id, NOW).find((item) => item.occurrence.status === "assigned");
  assert.ok(pending !== undefined);
  check("task-item", taskItemDTO(pending));
  check("task-definition", taskDefinitionDTO(pending.definition));

  completeTask(ctx, state, pending.occurrence.id, marina, NOW);
  const done = roomTasks(state, pending.definition.roomID, marina).find((item) => item.occurrence.id === pending.occurrence.id);
  assert.ok(done !== undefined);
  check("task-item-completed", taskItemDTO(done));

  const sporadic = sporadicTasks(ctx, state, seed.house.id, marina, NOW).find((item) => item.definition.kind === "sporadic");
  assert.ok(sporadic !== undefined);
  check("task-item-sporadic", taskItemDTO(sporadic));
});

test("contrato: pedido de troca e notificação", () => {
  const { seed, ctx, state } = world();
  const marina = seed.users.marina.id;
  const offered = userTasks(state, marina, seed.house.id, NOW).find((item) => item.occurrence.status === "assigned");
  assert.ok(offered !== undefined);
  const [requested] = swapCandidates(state, marina, offered.occurrence.id, seed.house.id, NOW);
  assert.ok(requested !== undefined);
  const request = createSwapRequest(ctx, state, marina, offered.occurrence.id, requested.occurrence.id, NOW);
  check("task-swap-request", taskSwapRequestDTO(request));
  const [notification] = notificationsFor(state, request.receiverID);
  assert.ok(notification !== undefined);
  check("notification", notificationDTO(notification));
});
