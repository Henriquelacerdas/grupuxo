import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoreState } from "../../src/domain/store-state.ts";
import { absenceID, houseID as toHouseID, roomID as toRoomID, taskOccurrenceID, taskSwapRequestID, userID, type UserID } from "../../src/domain/ids.ts";
import { isActiveAssignment, isCompleted, isCurrentMember, type TaskItem } from "../../src/domain/entities.ts";
import { isDomainError } from "../../src/domain/errors.ts";
import type {
  HouseRepository, NotificationRepository, RoomRepository, TaskRepository, TaskSwapRepository,
} from "../../src/domain/repositories.ts";
import {
  AcceptTaskSwapRequestUseCase, CreateTaskSwapRequestUseCase, GetIncomingTaskSwapRequestsUseCase,
  GetNotificationsUseCase, GetOutgoingTaskSwapRequestsUseCase, GetTaskSwapCandidatesUseCase,
  MarkNotificationAsReadUseCase, RejectTaskSwapRequestUseCase,
} from "../../src/domain/use-cases/swaps-and-notifications.ts";
import {
  AddHouseMemberUseCase, CreateRoomUseCase, GetHouseMembersUseCase, RemoveHouseMemberUseCase,
} from "../../src/domain/use-cases/houses-and-rooms.ts";
import { ClaimSporadicTaskUseCase, CompleteTaskUseCase, GetSporadicTasksUseCase, ReleaseSporadicTaskUseCase } from "../../src/domain/use-cases/tasks.ts";
import { activeOwner, uuid, World } from "../support/world.ts";

// Contrato dos repositórios do domínio: a mesma bateria roda contra o adaptador em memória e contra o DynamoDB
// (cliente falso). Só usa os repositórios; para olhar o estado e prepará-lo usa `state()` e `update()`.

export interface RepositoryEnv {
  readonly world: World;
  readonly houses: HouseRepository;
  readonly rooms: RoomRepository;
  readonly tasks: TaskRepository;
  readonly swaps: TaskSwapRepository;
  readonly notifications: NotificationRepository;
  /** Estado inteiro da casa de demonstração. */
  state(): Promise<StoreState>;
  /** Altera o estado fora das regras do domínio (preparação de cenário). */
  update(fn: (draft: StoreState) => void): Promise<void>;
}

/** `state`: estado inicial diferente da demonstração do mundo (por exemplo, sem tarefas). */
export type RepositoryEnvFactory = (world: World, state?: StoreState) => Promise<RepositoryEnv>;

const code = (c: Parameters<typeof isDomainError>[1]) => (error: unknown) => isDomainError(error, c);
const SAO_PAULO = "America/Sao_Paulo";

/**
 * `withoutTasks`: casa sem tarefas. Trocar moradores replaneja a escala inteira (na demonstração, mais de 100 itens
 * mudam, o que o DynamoDB não aceita numa transação: ver "Limites" em BACKEND.md seção 4); sem tarefas o comando
 * é pequeno e prova o resto do comportamento.
 */
async function setup(make: RepositoryEnvFactory, options: { readonly withoutTasks?: boolean } = {}) {
  const world = new World({ timezone: SAO_PAULO });
  const env = await make(world, options.withoutTasks === true ? world.cleanState() : undefined);
  return { world, env, ...world.seed, now: () => world.now };
}

/** Duas ocorrências já disponíveis, de responsáveis diferentes, que podem ser trocadas entre si. */
async function swappablePair(world: World, env: RepositoryEnv) {
  const state = await env.state();
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

export function repositoryContract(name: string, make: RepositoryEnvFactory): void {
  test(`${name}: pedido de troca: criar, listar, notificar e aceitar troca os responsáveis`, async () => {
    const { world, env } = await setup(make);
    const { a, b, requester, receiver } = await swappablePair(world, env);
    const request = await new CreateTaskSwapRequestUseCase(env.swaps, () => world.now).execute(requester, a.id, b.id);
    assert.equal(request.status, "pending");
    assert.equal(request.receiverID, receiver);
    await assert.rejects(env.swaps.createRequest(requester, a.id, b.id, world.now), code("taskUnavailable"));

    const house = world.seed.house.id;
    assert.deepEqual((await new GetIncomingTaskSwapRequestsUseCase(env.swaps).execute(receiver, house)).map((r) => r.id), [request.id]);
    assert.deepEqual((await new GetOutgoingTaskSwapRequestsUseCase(env.swaps).execute(requester, house)).map((r) => r.id), [request.id]);
    assert.deepEqual((await new GetNotificationsUseCase(env.notifications).execute(receiver)).map((n) => n.kind), ["taskSwapRequested"]);

    await assert.rejects(env.swaps.accept(request.id, requester, world.now), code("taskUnavailable"));
    const accepted = await new AcceptTaskSwapRequestUseCase(env.swaps, () => world.now).execute(request.id, receiver);
    assert.equal(accepted.status, "accepted");
    const state = await env.state();
    assert.equal(activeOwner(state, a), receiver);
    assert.equal(activeOwner(state, b), requester);
    assert.deepEqual((await env.notifications.notifications(requester)).map((n) => n.kind), ["taskSwapAccepted"]);
    await assert.rejects(env.swaps.accept(request.id, receiver, world.now), code("taskUnavailable"));
    await assert.rejects(env.swaps.reject(request.id, receiver, world.now), code("taskUnavailable"));
  });

  test(`${name}: recusar um pedido avisa quem pediu e não altera responsáveis`, async () => {
    const { world, env } = await setup(make);
    const { a, b, requester, receiver } = await swappablePair(world, env);
    const before = (await env.state()).assignments;
    const request = await env.swaps.createRequest(requester, a.id, b.id, world.now);
    const rejected = await new RejectTaskSwapRequestUseCase(env.swaps, () => world.now).execute(request.id, receiver);
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.resolvedAt, world.now);
    assert.deepEqual((await env.state()).assignments, before);
    assert.deepEqual((await env.notifications.notifications(requester)).map((n) => n.kind), ["taskSwapRejected"]);
    await assert.rejects(env.swaps.reject(request.id, requester, world.now), code("taskUnavailable"));
  });

  test(`${name}: trocas inválidas são rejeitadas e IDs inexistentes não gravam nada`, async () => {
    const { world, env } = await setup(make);
    const { a, b, requester, receiver } = await swappablePair(world, env);
    await assert.rejects(env.swaps.createRequest(receiver, a.id, b.id, world.now), code("taskUnavailable"));
    await assert.rejects(env.swaps.createRequest(requester, a.id, a.id, world.now), code("taskUnavailable"));
    await assert.rejects(env.swaps.createRequest(requester, a.id, taskOccurrenceID(uuid(998)), world.now), code("entityNotFound"));
    await assert.rejects(env.swaps.swapCandidates(userID(uuid(999)), a.id, world.seed.house.id, world.now), code("taskUnavailable"));
    await assert.rejects(env.swaps.accept(taskSwapRequestID(uuid(997)), receiver, world.now), code("entityNotFound"));
    await assert.rejects(env.tasks.complete(taskOccurrenceID(uuid(996)), receiver, world.now), code("entityNotFound"));
    await assert.rejects(env.tasks.claim(taskOccurrenceID(uuid(996)), receiver, world.now), code("entityNotFound"));
    await assert.rejects(env.rooms.participation(uuidRoom(995), receiver, world.now), code("entityNotFound"));
  });

  test(`${name}: candidatos a troca vêm ordenados por prazo e nunca incluem tarefas do solicitante`, async () => {
    const { world, env } = await setup(make);
    const { a, requester } = await swappablePair(world, env);
    const candidates: TaskItem[] = await new GetTaskSwapCandidatesUseCase(env.swaps, () => world.now).execute(requester, a.id, world.seed.house.id);
    assert.ok(candidates.length > 0);
    assert.ok(candidates.every((c) => c.assignment?.userID !== requester && c.occurrence.id !== a.id));
    const due = candidates.map((c) => c.occurrence.dueAt ?? Infinity);
    assert.deepEqual([...due].sort((x, y) => x - y), due);
  });

  test(`${name}: notificações: marcar como lida é idempotente e só vale para o destinatário`, async () => {
    const { world, env } = await setup(make);
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

  test(`${name}: esporádica: assumir, impedir que outro assuma e devolver`, async () => {
    const { world, env, users, house } = await setup(make);
    const claim = new ClaimSporadicTaskUseCase(env.tasks, () => world.now);
    const release = new ReleaseSporadicTaskUseCase(env.tasks);
    const [item] = await new GetSporadicTasksUseCase(env.tasks).execute(house.id, users.leo.id);
    assert.ok(item !== undefined);
    assert.equal(item.assignment, null);
    assert.ok(item.suggestedAssignee !== null);
    const id = item.occurrence.id;

    await claim.execute(id, users.leo.id);
    await claim.execute(id, users.leo.id);
    await assert.rejects(claim.execute(id, users.bia.id), code("taskUnavailable"));
    await release.execute(id, users.bia.id);
    assert.equal((await env.state()).occurrences.find((o) => o.id === id)?.status, "assigned");

    await release.execute(id, users.leo.id);
    const state = await env.state();
    assert.equal(state.occurrences.find((o) => o.id === id)?.status, "available");
    assert.ok(!state.assignments.some((x) => x.occurrenceID === id && isActiveAssignment(x)));
    await claim.execute(id, users.bia.id);
    assert.equal(activeOwner(await env.state(), id), users.bia.id);
    await assert.rejects(claim.execute(id, userID(uuid(999))), code("taskUnavailable"));
  });

  test(`${name}: quem está de férias não pode assumir uma esporádica`, async () => {
    const { world, env, users, house } = await setup(make);
    const membership = (await env.state()).houseMemberships.find((m) => m.userID === users.rafa.id);
    assert.ok(membership !== undefined);
    await env.update((s) => {
      s.absences.push({ id: absenceID(world.newID()), membershipID: membership.id, startsAt: world.now - 1000, endsAt: world.now + 1000, reason: null });
    });
    const [item] = await new GetSporadicTasksUseCase(env.tasks).execute(house.id, users.leo.id);
    assert.ok(item !== undefined);
    const absent: UserID = users.rafa.id;
    await assert.rejects(env.tasks.claim(item.occurrence.id, absent, world.now), code("taskUnavailable"));
  });

  test(`${name}: concluir uma tarefa a marca como concluída e repetir não altera nada (idempotente)`, async () => {
    const { world, env, users, house } = await setup(make);
    const mine = await env.tasks.tasks(users.marina.id, house.id);
    const open = mine.find((item) => !isCompleted(item.occurrence));
    assert.ok(open !== undefined);
    const complete = new CompleteTaskUseCase(env.tasks, () => world.now);
    await complete.execute(open.occurrence.id, users.marina.id);
    const after = await env.state();
    const done = after.occurrences.find((o) => o.id === open.occurrence.id);
    assert.equal(done?.status, "completed");
    assert.equal(done?.completedByUserID, users.marina.id);
    assert.equal(done?.completedAt, world.now);
    await complete.execute(open.occurrence.id, users.marina.id);
    assert.deepEqual(await env.state(), after);
  });

  test(`${name}: adiciona morador só com o nome aparado, nos cômodos comuns`, async () => {
    const { world, env, house, users, rooms } = await setup(make, { withoutTasks: true });
    const user = await new AddHouseMemberUseCase(env.houses, () => world.now).execute("  Nova Moradora \n", house.id, users.marina.id);
    assert.equal(user.name, "Nova Moradora");
    assert.equal(user.email, null);
    assert.ok((await env.houses.memberIDs(house.id)).includes(user.id));
    const state = await env.state();
    const common = state.rooms.filter((r) => r.houseID === house.id && r.visibility === "common").map((r) => r.id);
    assert.ok(!state.roomMemberships.some((m) => m.roomID === rooms.privateOffice.id && m.userID === user.id));
    assert.ok(common.every((roomID) => state.roomMemberships.some((m) => m.roomID === roomID && m.userID === user.id && isCurrentMember(m))));
    assert.ok(state.users.some((u) => u.id === user.id && u.name === "Nova Moradora"));
  });

  test(`${name}: rejeita nome em branco sem alterar os moradores`, async () => {
    const { world, env, house, users } = await setup(make);
    const before = await env.houses.members(house.id);
    await assert.rejects(new AddHouseMemberUseCase(env.houses, () => world.now).execute(" \n ", house.id, users.marina.id), code("invalidResidentName"));
    assert.deepEqual(await env.houses.members(house.id), before);
  });

  test(`${name}: remover encerra a participação nos cômodos e preserva o histórico do usuário`, async () => {
    const { world, env, house, users } = await setup(make, { withoutTasks: true });
    const before = await env.state();
    const user = before.houseMemberships.find((m) => m.houseID === house.id && m.userID !== users.marina.id)?.userID;
    assert.ok(user !== undefined);
    await new RemoveHouseMemberUseCase(env.houses, () => world.now).execute(user, house.id, users.marina.id);
    const after = await env.state();
    assert.ok(!after.houseMemberships.some((m) => m.houseID === house.id && m.userID === user));
    const roomIDs = new Set(after.rooms.filter((r) => r.houseID === house.id).map((r) => r.id));
    assert.ok(!after.roomMemberships.some((m) => roomIDs.has(m.roomID) && m.userID === user && isCurrentMember(m)));
    assert.ok(after.users.some((u) => u.id === user));
    await assert.rejects(
      new RemoveHouseMemberUseCase(env.houses, () => world.now).execute(users.marina.id, house.id, users.marina.id), code("cannotRemoveCurrentUser"),
    );
  });

  test(`${name}: o perfil lista os moradores ordenados por nome e as casas do morador`, async () => {
    const { env, house, users } = await setup(make);
    const members = await new GetHouseMembersUseCase(env.houses).execute(house.id, users.marina.id);
    assert.deepEqual(members.map((u) => u.name), ["Bia", "Leo", "Marina", "Rafa"]);
    assert.deepEqual((await env.houses.houses(users.marina.id)).map((h) => h.id), [house.id]);
    assert.deepEqual(await env.houses.houses(userID(uuid(999))), []);
    assert.deepEqual(await env.houses.house(house.id), house);
    await assert.rejects(env.houses.house(houseIDFor(994)), code("entityNotFound"));
  });

  test(`${name}: o cômodo salva aparência, nome aparado e moradores escolhidos`, async () => {
    const { world, env, house } = await setup(make);
    const members = await env.houses.members(house.id);
    const creator = members[0];
    const second = members[1];
    assert.ok(creator !== undefined && second !== undefined);
    const room = await new CreateRoomUseCase(env.rooms, env.houses, () => world.now, world.newID).execute({
      name: "  Quarto azul  ", houseID: house.id, creatorUserID: creator.id, visibility: "privateRoom",
      responsibleCount: members.length, icon: "bed.double.fill", color: "purple",
      selectedParticipantIDs: new Set([creator.id, second.id]),
    });
    const stored = await env.rooms.room(room.id, creator.id);
    assert.equal(stored.name, "Quarto azul");
    assert.equal(stored.icon, "bed.double.fill");
    assert.equal(stored.color, "purple");
    const participation = await env.rooms.participation(room.id, second.id, world.now);
    assert.ok(participation.isMember);
    assert.equal(participation.memberCount, 2);
    assert.ok((await env.rooms.rooms(house.id, creator.id)).some((r) => r.id === room.id));
  });

  test(`${name}: cômodo privado começa só com o criador e exige nome e participantes válidos`, async () => {
    const { world, env, house, users } = await setup(make);
    const useCase = new CreateRoomUseCase(env.rooms, env.houses, () => world.now, world.newID);
    const room = await useCase.execute({ name: "Quarto", houseID: house.id, creatorUserID: users.marina.id, visibility: "privateRoom" });
    const info = await env.rooms.participation(room.id, users.marina.id, world.now);
    assert.equal(info.memberCount, 1);
    assert.ok(info.isMember);
    await assert.rejects(useCase.execute({ name: "  ", houseID: house.id, creatorUserID: users.marina.id, visibility: "common" }), code("invalidRoomName"));
    await assert.rejects(
      useCase.execute({ name: "X", houseID: house.id, creatorUserID: users.marina.id, visibility: "privateRoom", selectedParticipantIDs: new Set([users.leo.id]) }),
      code("invalidRoomParticipants"),
    );
  });

  test(`${name}: encerrar tarefa mantém a vez atual e o histórico, remove as futuras e recusa trocas pendentes`, async () => {
    const { world, env, users, rooms } = await setup(make, { withoutTasks: true });
    const ending = await env.tasks.create(world.definition(rooms.kitchen.id, { name: "Encerrar" }), users.marina.id, world.now);
    const other = await env.tasks.create(world.definition(rooms.kitchen.id, { name: "Outra" }), users.marina.id, world.now);
    const created = await env.state();
    const endingOccurrences = created.occurrences.filter((o) => o.taskDefinitionID === ending.id);
    const otherOccurrences = created.occurrences.filter((o) => o.taskDefinitionID === other.id);
    const [current, future] = endingOccurrences;
    const [otherCurrent] = otherOccurrences;
    assert.ok(current !== undefined && future !== undefined && otherCurrent !== undefined);
    const endedAt = world.now + 1000;
    const requester = activeOwner(created, current);
    const receiver = activeOwner(created, otherCurrent);
    assert.ok(requester !== undefined && receiver !== undefined);
    const swap = (offered: TaskItem["occurrence"], requested: TaskItem["occurrence"]) => ({
      id: taskSwapRequestID(world.newID()), requesterID: requester, receiverID: receiver, offeredOccurrenceID: offered.id,
      requestedOccurrenceID: requested.id, status: "pending" as const, createdAt: world.now, resolvedAt: null,
    });
    const onRemoved = swap(current, future);
    const onKept = swap(current, otherCurrent);
    await env.update((draft) => {
      draft.taskSwapRequests.push(onRemoved, onKept);
    });

    await assert.rejects(env.tasks.endTask(rooms.kitchen.id, ending.id, userID(uuid(999)), endedAt), code("taskUnavailable"));
    await assert.rejects(env.tasks.endTask(rooms.bathroom.id, ending.id, users.marina.id, endedAt), code("entityNotFound"));
    await env.tasks.endTask(rooms.kitchen.id, ending.id, users.marina.id, endedAt);

    const after = await env.state();
    const kept = after.occurrences.filter((o) => o.taskDefinitionID === ending.id).filter((o) => o.availableAt <= endedAt);
    assert.equal(after.occurrences.filter((o) => o.taskDefinitionID === ending.id).length, kept.length);
    assert.ok(kept.some((o) => o.id === current.id));
    assert.ok(!after.assignments.some((a) => a.occurrenceID === future.id));
    assert.equal(after.definitions.find((d) => d.id === ending.id)?.endedAt, endedAt);
    assert.deepEqual(after.occurrences.filter((o) => o.taskDefinitionID === other.id), otherOccurrences);
    assert.equal(after.taskSwapRequests.find((r) => r.id === onRemoved.id)?.status, "rejected");
    assert.equal(after.taskSwapRequests.find((r) => r.id === onRemoved.id)?.resolvedAt, endedAt);
    assert.equal(after.taskSwapRequests.find((r) => r.id === onKept.id)?.status, "pending");
    const notices = (await env.notifications.notifications(requester)).filter((n) => n.kind === "taskSwapRejected");
    assert.deepEqual(notices.map((n) => n.swapRequestID), [onRemoved.id]);

    // Idempotente: repetir não muda nada, nem a data de encerramento.
    await env.tasks.endTask(rooms.kitchen.id, ending.id, users.marina.id, endedAt + 5000);
    assert.deepEqual(await env.state(), after);
  });

  test(`${name}: avançar semanas materializa a escala uma vez e repetir não grava de novo`, async () => {
    const { world, env, house, users } = await setup(make);
    world.now += 3 * 7 * 24 * 3_600_000;
    await env.tasks.refreshSchedule(house.id, world.now);
    const first = await env.state();
    await env.tasks.refreshSchedule(house.id, world.now);
    assert.deepEqual(await env.state(), first);
    assert.ok((await env.tasks.tasks(users.marina.id, house.id)).length > 0);
    assert.deepEqual(await env.state(), first);
  });
}

function uuidRoom(n: number) {
  return toRoomID(uuid(n));
}

function houseIDFor(n: number) {
  return toHouseID(uuid(n));
}
