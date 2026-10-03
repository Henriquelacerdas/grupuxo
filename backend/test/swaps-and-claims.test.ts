import assert from "node:assert/strict";
import { test } from "node:test";
import { isActiveAssignment, isCompleted, type TaskItem } from "../src/domain/entities.ts";
import { isDomainError } from "../src/domain/errors.ts";
import { absenceID, taskOccurrenceID, taskSwapRequestID, userID, type UserID } from "../src/domain/ids.ts";
import {
  AcceptTaskSwapRequestUseCase, CreateTaskSwapRequestUseCase, GetIncomingTaskSwapRequestsUseCase,
  GetNotificationsUseCase, GetOutgoingTaskSwapRequestsUseCase, GetTaskSwapCandidatesUseCase,
  MarkNotificationAsReadUseCase, RejectTaskSwapRequestUseCase,
} from "../src/domain/use-cases/swaps-and-notifications.ts";
import { ClaimSporadicTaskUseCase, GetSporadicTasksUseCase, ReleaseSporadicTaskUseCase } from "../src/domain/use-cases/tasks.ts";
import { activeOwner, uuid, World } from "./support/world.ts";

const code = (c: Parameters<typeof isDomainError>[1]) => (error: unknown) => isDomainError(error, c);

/** Duas ocorrências já disponíveis, de responsáveis diferentes, que podem ser trocadas entre si. */
async function swappablePair(world: World, env: ReturnType<World["env"]>) {
  const state = env.store.read((s) => s);
  const house = world.seed.house.id;
  for (const a of state.occurrences) {
    const owner = activeOwner(state, a);
    if (owner === undefined || a.availableAt > world.now || isCompleted(a)) continue;
    const candidates = await env.swaps.swapCandidates(owner, a.id, house, world.now);
    const b = candidates[0];
    if (b?.assignment) return { a, b: b.occurrence, requester: owner, receiver: b.assignment.userID };
  }
  throw new Error("a demonstração deveria ter um par trocável");
}

test("pedido de troca: criar, listar, notificar e aceitar troca os responsáveis", async () => {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const env = world.env();
  const { a, b, requester, receiver } = await swappablePair(world, env);
  const request = await new CreateTaskSwapRequestUseCase(env.swaps, () => world.now).execute(requester, a.id, b.id);
  assert.equal(request.status, "pending");
  assert.equal(request.receiverID, receiver);
  await assert.rejects(env.swaps.createRequest(requester, a.id, b.id, world.now), code("taskUnavailable")); // duplicado

  const house = world.seed.house.id;
  assert.deepEqual((await new GetIncomingTaskSwapRequestsUseCase(env.swaps).execute(receiver, house)).map((r) => r.id), [request.id]);
  assert.deepEqual((await new GetOutgoingTaskSwapRequestsUseCase(env.swaps).execute(requester, house)).map((r) => r.id), [request.id]);
  const inbox = await new GetNotificationsUseCase(env.notifications).execute(receiver);
  assert.deepEqual(inbox.map((n) => n.kind), ["taskSwapRequested"]);

  await assert.rejects(env.swaps.accept(request.id, requester, world.now), code("taskUnavailable")); // só o destinatário aceita
  const accepted = await new AcceptTaskSwapRequestUseCase(env.swaps, () => world.now).execute(request.id, receiver);
  assert.equal(accepted.status, "accepted");
  const state = env.store.read((s) => s);
  assert.equal(activeOwner(state, a), receiver);
  assert.equal(activeOwner(state, b), requester);
  assert.ok(state.assignments.every((x) => x.endedAt === null || x.endedAt >= x.assignedAt));
  assert.deepEqual((await env.notifications.notifications(requester)).map((n) => n.kind), ["taskSwapAccepted"]);
  await assert.rejects(env.swaps.accept(request.id, receiver, world.now), code("taskUnavailable")); // já resolvido
  await assert.rejects(env.swaps.reject(request.id, receiver, world.now), code("taskUnavailable"));
});

test("recusar um pedido avisa quem pediu e não altera responsáveis", async () => {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const env = world.env();
  const { a, b, requester, receiver } = await swappablePair(world, env);
  const before = env.store.read((s) => s.assignments);
  const request = await env.swaps.createRequest(requester, a.id, b.id, world.now);
  const rejected = await new RejectTaskSwapRequestUseCase(env.swaps, () => world.now).execute(request.id, receiver);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.resolvedAt, world.now);
  assert.deepEqual(env.store.read((s) => s.assignments), before);
  assert.deepEqual((await env.notifications.notifications(requester)).map((n) => n.kind), ["taskSwapRejected"]);
  await assert.rejects(env.swaps.reject(request.id, requester, world.now), code("taskUnavailable"));
});

test("trocas inválidas são rejeitadas: ocorrência própria, inexistente e de quem não é o dono", async () => {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const env = world.env();
  const { a, b, requester, receiver } = await swappablePair(world, env);
  await assert.rejects(env.swaps.createRequest(receiver, a.id, b.id, world.now), code("taskUnavailable")); // oferece o que não é seu
  await assert.rejects(env.swaps.createRequest(requester, a.id, a.id, world.now), code("taskUnavailable"));
  await assert.rejects(env.swaps.createRequest(requester, a.id, taskOccurrenceID(uuid(998)), world.now), code("entityNotFound"));
  await assert.rejects(env.swaps.swapCandidates(userID(uuid(999)), a.id, world.seed.house.id, world.now), code("taskUnavailable"));
  await assert.rejects(env.swaps.accept(taskSwapRequestID(uuid(997)), receiver, world.now), code("entityNotFound"));
});

test("candidatos a troca vêm ordenados por prazo e nunca incluem tarefas do próprio solicitante", async () => {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const env = world.env();
  const { a, requester } = await swappablePair(world, env);
  const candidates: TaskItem[] = await new GetTaskSwapCandidatesUseCase(env.swaps, () => world.now).execute(requester, a.id, world.seed.house.id);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((c) => c.assignment?.userID !== requester && c.occurrence.id !== a.id));
  const due = candidates.map((c) => c.occurrence.dueAt ?? Infinity);
  assert.deepEqual([...due].sort((x, y) => x - y), due);
});

test("notificações: marcar como lida é idempotente e só vale para o destinatário", async () => {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const env = world.env();
  const { a, b, requester, receiver } = await swappablePair(world, env);
  await env.swaps.createRequest(requester, a.id, b.id, world.now);
  const notification = (await env.notifications.notifications(receiver))[0];
  assert.ok(notification !== undefined);
  const markRead = new MarkNotificationAsReadUseCase(env.notifications, () => world.now);
  await assert.rejects(markRead.execute(notification.id, requester), code("entityNotFound"));
  await markRead.execute(notification.id, receiver, 111);
  await markRead.execute(notification.id, receiver, 222);
  assert.equal((await env.notifications.notifications(receiver))[0]?.readAt, 111);
});

test("esporádica: assumir, impedir que outro assuma e devolver", async () => {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const env = world.env();
  const { users, house } = world.seed;
  const claim = new ClaimSporadicTaskUseCase(env.tasks, () => world.now);
  const release = new ReleaseSporadicTaskUseCase(env.tasks);
  const listing = new GetSporadicTasksUseCase(env.tasks);
  const [item] = await listing.execute(house.id, users.leo.id);
  assert.ok(item !== undefined);
  assert.equal(item.assignment, null);
  assert.ok(item.suggestedAssignee !== null); // sugestão pela menor carga da semana
  const id = item.occurrence.id;

  await claim.execute(id, users.leo.id);
  await claim.execute(id, users.leo.id); // idempotente
  await assert.rejects(claim.execute(id, users.bia.id), code("taskUnavailable"));
  await release.execute(id, users.bia.id); // quem não é responsável: sem efeito
  assert.equal(env.store.read((s) => s.occurrences.find((o) => o.id === id)?.status), "assigned");

  await release.execute(id, users.leo.id);
  const state = env.store.read((s) => s);
  assert.equal(state.occurrences.find((o) => o.id === id)?.status, "available");
  assert.ok(!state.assignments.some((x) => x.occurrenceID === id && isActiveAssignment(x)));
  await claim.execute(id, users.bia.id); // agora outro pode assumir
  assert.equal(activeOwner(env.store.read((s) => s), id), users.bia.id);
  await assert.rejects(claim.execute(id, userID(uuid(999))), code("taskUnavailable"));
});

test("quem está de férias não pode assumir uma esporádica", async () => {
  const world = new World({ timezone: "America/Sao_Paulo" });
  const env = world.env();
  const { users, house } = world.seed;
  const membership = env.store.read((s) => s.houseMemberships.find((m) => m.userID === users.rafa.id));
  assert.ok(membership !== undefined);
  env.store.update((s) => {
    s.absences.push({ id: absenceID(world.newID()), membershipID: membership.id, startsAt: world.now - 1000, endsAt: world.now + 1000, reason: null });
  });
  const [item] = await new GetSporadicTasksUseCase(env.tasks).execute(house.id, users.leo.id);
  assert.ok(item !== undefined);
  const absent: UserID = users.rafa.id;
  await assert.rejects(env.tasks.claim(item.occurrence.id, absent, world.now), code("taskUnavailable"));
});
