// Benchmark local: cliente falso, sem rede, credenciais ou serviços externos.
import { performance } from "node:perf_hooks";
import { World } from "../../test/support/world.ts";
import { FakeDynamoClient } from "../../test/support/fake-dynamo-client.ts";
import { dynamoEnvironment } from "../../test/dynamodb/environment.ts";
import { taskAssignmentID, taskOccurrenceID } from "../../src/domain/ids.ts";
import { cloneStoreState } from "../../src/domain/store-state.ts";

const world = new World({ timezone: "America/Sao_Paulo" });
const state = cloneStoreState(world.seed.state);
const source = state.occurrences[0];
const owner = state.users[0];
if (source === undefined || owner === undefined) throw new Error("seed vazio");
// Histórico de tamanho próximo ao observado no dev, sem reexecutar o agendamento na preparação.
for (let index = 0; index < 1200; index++) {
  const id = taskOccurrenceID(world.newID());
  state.occurrences.push({ ...source, id, status: "completed", completedAt: world.now, completedByUserID: owner.id });
  state.assignments.push({
    id: taskAssignmentID(world.newID()), occurrenceID: id, userID: owner.id,
    assignedAt: world.now, endedAt: world.now, supersededAt: null,
  });
}
const client = new FakeDynamoClient({ pageSize: 5000 });
const env = await dynamoEnvironment(world, state, client);
await env.tasks.tasks(owner.id, world.seed.house.id);
async function measure(label: string, operation: () => Promise<unknown>) {
  const samples: number[] = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    await operation();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { label, medianMs: Number(samples[7]?.toFixed(2)), p90Ms: Number(samples[13]?.toFixed(2)) };
}
const output = [];
output.push(await measure("myTasks", () => env.tasks.tasks(owner.id, world.seed.house.id)));
output.push(await measure("houseScreenLegacy", async () => {
  await env.houses.members(world.seed.house.id);
  const rooms = await env.rooms.rooms(world.seed.house.id, owner.id);
  await env.tasks.sporadicTasks(world.seed.house.id, owner.id);
  for (const room of rooms) {
    await env.rooms.participation(room.id, owner.id, world.now);
    await env.tasks.roomTasks(room.id, owner.id);
  }
}));
output.push(await measure("houseSnapshot", () => env.tasks.snapshot(world.seed.house.id, owner.id, world.now)));
process.stdout.write(`${JSON.stringify({ items: client.snapshot().length, samples: output }, null, 2)}\n`);
