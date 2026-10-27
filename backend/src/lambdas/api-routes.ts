import type { HouseSnapshotRepository } from "../domain/commands/house-snapshot.ts";
import type { Instant } from "../domain/dates.ts";
import type { House } from "../domain/entities.ts";
import { isDomainError } from "../domain/errors.ts";
import {
  houseID as toHouseID, notificationID, roomID as toRoomID, taskDefinitionID, taskOccurrenceID, taskSwapRequestID,
  userID as toUserID, type IDGenerator, type UserID,
} from "../domain/ids.ts";
import type {
  HouseRepository, NotificationRepository, RoomRepository, TaskRepository, TaskSwapRepository,
} from "../domain/repositories.ts";
import {
  CreateRoomUseCase, GetRoomParticipationUseCase, type CreateRoomInput,
} from "../domain/use-cases/houses-and-rooms.ts";
import {
  AcceptTaskSwapRequestUseCase, CreateTaskSwapRequestUseCase, GetIncomingTaskSwapRequestsUseCase,
  GetNotificationsUseCase, GetOutgoingTaskSwapRequestsUseCase, GetTaskSwapCandidatesUseCase,
  MarkNotificationAsReadUseCase, RejectTaskSwapRequestUseCase,
} from "../domain/use-cases/swaps-and-notifications.ts";
import {
  AddRoomMemberUseCase, ClaimSporadicTaskUseCase, CompleteTaskUseCase, CreateTaskUseCase, GetMyTasksUseCase,
  GetRoomTasksUseCase, GetSporadicTasksUseCase, ReleaseSporadicTaskUseCase, RemoveRoomMemberUseCase, newTaskDefinition,
} from "../domain/use-cases/tasks.ts";
import { DomainError } from "../domain/errors.ts";
import {
  houseSnapshotDTO, myHouseDTO, notificationDTO, roomDTO, roomParticipationDTO, taskDefinitionDTO, taskItemDTO, taskSwapRequestDTO,
} from "./api-dto.ts";
import { failure, json, jsonObject, noContent } from "./api-http.ts";
import {
  parseCreateHouse, parseCreateRoom, parseCreateSwap, parseCreateTask, parseFlag, parseJoinHouse, parseRange,
  parseRoomMember,
} from "./api-input.ts";
import { requireParam, type AppRouteName, type RouteParams } from "./api-router.ts";
import type { HttpApiResult } from "./events.ts";

// Rotas de casa, cômodo, tarefa, ocorrência, troca e notificação (BACKEND.md, seção 6.1). Aqui só há tradução: estreitar a entrada, chamar
// os casos de uso do domínio e montar o JSON. O `userID` vem do token (já resolvido por quem chama) e o `at` do relógio
// injetado; nenhuma regra de negócio mora neste arquivo.

export interface RouteDependencies {
  readonly snapshots: HouseSnapshotRepository;
  readonly houses: HouseRepository;
  readonly rooms: RoomRepository;
  readonly tasks: TaskRepository;
  readonly swaps: TaskSwapRepository;
  readonly notifications: NotificationRepository;
  readonly now: () => Instant;
  readonly newID: IDGenerator;
}

export interface RouteRequest {
  readonly user: UserID;
  readonly params: RouteParams;
  readonly query: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

const badRequest = (): HttpApiResult => failure(400, "bad_request");
const notFound = (): HttpApiResult => failure(404, "not_found");
const noHouse = (): HttpApiResult => failure(404, "no_house");
const alreadyInHouse = (): HttpApiResult => failure(409, "already_in_house");

export function createRouteHandlers(deps: RouteDependencies): (name: AppRouteName, request: RouteRequest) => Promise<HttpApiResult> {
  const { houses, rooms, tasks, swaps, notifications, now, newID } = deps;
  const createRoom = new CreateRoomUseCase(rooms, houses, now, newID);
  const participation = new GetRoomParticipationUseCase(rooms, now);
  const myTasks = new GetMyTasksUseCase(tasks, houses, now);
  const roomTasks = new GetRoomTasksUseCase(tasks);
  const createTask = new CreateTaskUseCase(tasks, now);
  const completion = new CompleteTaskUseCase(tasks, now);
  const addRoomMember = new AddRoomMemberUseCase(tasks, now);
  const removeRoomMember = new RemoveRoomMemberUseCase(tasks, now);
  const sporadicTasks = new GetSporadicTasksUseCase(tasks);
  const claim = new ClaimSporadicTaskUseCase(tasks, now);
  const release = new ReleaseSporadicTaskUseCase(tasks);
  const candidates = new GetTaskSwapCandidatesUseCase(swaps, now);
  const createSwap = new CreateTaskSwapRequestUseCase(swaps, now);
  const incomingSwaps = new GetIncomingTaskSwapRequestsUseCase(swaps);
  const outgoingSwaps = new GetOutgoingTaskSwapRequestsUseCase(swaps);
  const acceptSwap = new AcceptTaskSwapRequestUseCase(swaps, now);
  const rejectSwap = new RejectTaskSwapRequestUseCase(swaps, now);
  const myNotifications = new GetNotificationsUseCase(notifications);
  const markAsRead = new MarkNotificationAsReadUseCase(notifications, now);

  /** A casa do morador (regra v1: uma por morador). Lê o `GSI1`, que é eventualmente consistente. */
  async function currentHouse(user: UserID): Promise<House | null> {
    const found = [...(await houses.houses(user))].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return found[0] ?? null;
  }

  async function houseResponse(status: number, house: House, user: UserID): Promise<HttpApiResult> {
    const members = await houses.members(house.id);
    return json(status, myHouseDTO(house, members, await rooms.rooms(house.id, user)));
  }

  /** O cômodo existe e é de uma casa do morador; senão `entityNotFound` (404), igual a um cômodo que não existe. */
  async function requireRoom(request: RouteRequest): Promise<ReturnType<typeof toRoomID>> {
    const roomID = toRoomID(requireParam(request.params, "roomID"));
    await rooms.room(roomID, request.user);
    return roomID;
  }

  /** A ocorrência é de uma casa do morador; senão `entityNotFound` (404), igual a uma que não existe. */
  async function requireOccurrence(request: RouteRequest): Promise<{
    readonly occurrenceID: ReturnType<typeof taskOccurrenceID>; readonly houseID: ReturnType<typeof toHouseID>;
  }> {
    const occurrenceID = taskOccurrenceID(requireParam(request.params, "occurrenceID"));
    return { occurrenceID, houseID: await tasks.houseOfOccurrence(occurrenceID, request.user) };
  }

  return async (name, request) => {
    const { user, query } = request;
    switch (name) {
      case "houseSnapshot": {
        const house = await currentHouse(user);
        if (house === null) return noHouse();
        try {
          return json(200, houseSnapshotDTO(await deps.snapshots.snapshot(house.id, user, now())));
        } catch (error) {
          if (isDomainError(error, "entityNotFound")) return noHouse();
          throw error;
        }
      }
      case "myHouse": {
        const house = await currentHouse(user);
        if (house === null) return noHouse();
        try {
          return await houseResponse(200, house, user);
        } catch (error) {
          // O índice ainda mostrava uma casa de que o morador já saiu: para ele, não há casa.
          if (isDomainError(error, "entityNotFound")) return noHouse();
          throw error;
        }
      }
      case "createHouse": {
        const body = jsonObject(request.body);
        const input = body === null ? null : parseCreateHouse(body);
        if (input === null) return badRequest();
        if (await currentHouse(user) !== null) return alreadyInHouse();
        return houseResponse(201, await houses.create(user, input.name, input.timezone, now()), user);
      }
      case "joinHouse": {
        const body = jsonObject(request.body);
        const input = body === null ? null : parseJoinHouse(body);
        if (input === null) return badRequest();
        if (await currentHouse(user) !== null) return alreadyInHouse();
        return houseResponse(200, await houses.joinByCode(user, input.code, now()), user);
      }
      case "leaveHouse": {
        const confirmRooms = parseFlag(query, "confirmRoomDeletion");
        const confirmHouse = parseFlag(query, "confirmHouseDeletion");
        if (confirmRooms === null || confirmHouse === null) return badRequest();
        const house = await currentHouse(user);
        if (house === null) return noHouse();
        await houses.leave(user, house.id, now(), confirmRooms, confirmHouse);
        return noContent();
      }

      case "createRoom": {
        const houseID = toHouseID(requireParam(request.params, "houseID"));
        if (!(await houses.memberIDs(houseID)).includes(user)) return notFound();
        const body = jsonObject(request.body);
        const parsed = body === null ? null : parseCreateRoom(body);
        if (parsed === null) return badRequest();
        if (parsed.participantIDs === "invalid") throw new DomainError("invalidRoomParticipants");
        const input: { -readonly [K in keyof CreateRoomInput]: CreateRoomInput[K] } = {
          name: parsed.name, houseID, creatorUserID: user, visibility: parsed.visibility,
        };
        if (parsed.category !== undefined) input.category = parsed.category;
        if (parsed.periodicity !== undefined) input.periodicity = parsed.periodicity;
        if (parsed.responsibleCount !== undefined) input.responsibleCount = parsed.responsibleCount;
        if (parsed.icon !== undefined) input.icon = parsed.icon;
        if (parsed.color !== undefined) input.color = parsed.color;
        // Contrato: o criador entra sempre, mesmo que não esteja na lista.
        if (parsed.participantIDs !== null) input.selectedParticipantIDs = new Set([...parsed.participantIDs, user]);
        return json(201, roomDTO(await createRoom.execute(input)));
      }
      case "roomParticipation":
        return json(200, roomParticipationDTO(await participation.execute(toRoomID(requireParam(request.params, "roomID")), user)));
      case "addRoomMember": {
        const roomID = await requireRoom(request);
        const body = jsonObject(request.body);
        const target = body === null ? null : parseRoomMember(body);
        if (target === null) return badRequest();
        await addRoomMember.execute(target, roomID);
        return noContent();
      }
      case "removeRoomMember": {
        const roomID = await requireRoom(request);
        const confirmDeletion = parseFlag(query, "confirmDeletion");
        if (confirmDeletion === null) return badRequest();
        await removeRoomMember.execute(toUserID(requireParam(request.params, "userID")), roomID, { confirmDeletion });
        return noContent();
      }

      case "myTasks": {
        const range = parseRange(query);
        if (range === null) return badRequest();
        const house = await currentHouse(user);
        if (house === null) return noHouse();
        return json(200, { tasks: (await myTasks.execute(user, house.id, range)).map(taskItemDTO) });
      }
      case "roomTasks": {
        const roomID = await requireRoom(request);
        return json(200, { tasks: (await roomTasks.execute(roomID, user)).map(taskItemDTO) });
      }
      case "createTask": {
        const roomID = await requireRoom(request);
        const body = jsonObject(request.body);
        const parsed = body === null ? null : parseCreateTask(body);
        if (parsed === null) return badRequest();
        const definition = newTaskDefinition(taskDefinitionID(newID()), { ...parsed, roomID });
        return json(201, taskDefinitionDTO(await createTask.execute(definition, user)));
      }
      case "taskDefinition": {
        const definition = await tasks.definition(
          toRoomID(requireParam(request.params, "roomID")), taskDefinitionID(requireParam(request.params, "taskID")), user,
        );
        return json(200, taskDefinitionDTO(definition));
      }
      case "endTask": {
        const roomID = toRoomID(requireParam(request.params, "roomID"));
        const taskID = taskDefinitionID(requireParam(request.params, "taskID"));
        // Ler a definição primeiro dá 404 uniforme para quem não é da casa ou não vê a tarefa.
        await tasks.definition(roomID, taskID, user);
        await tasks.endTask(roomID, taskID, user, now());
        return noContent();
      }

      case "completeOccurrence":
      case "reopenOccurrence": {
        const occurrenceID = taskOccurrenceID(requireParam(request.params, "occurrenceID"));
        await tasks.houseOfOccurrence(occurrenceID, user);
        await completion.execute(occurrenceID, user, { isCompleted: name === "completeOccurrence" });
        return noContent();
      }
      case "mySporadicTasks": {
        const house = await currentHouse(user);
        if (house === null) return noHouse();
        return json(200, { tasks: (await sporadicTasks.execute(house.id, user)).map(taskItemDTO) });
      }
      case "claimOccurrence": {
        const { occurrenceID } = await requireOccurrence(request);
        await claim.execute(occurrenceID, user);
        return noContent();
      }
      case "releaseOccurrence": {
        const { occurrenceID } = await requireOccurrence(request);
        await release.execute(occurrenceID, user);
        return noContent();
      }

      case "swapCandidates": {
        const { occurrenceID, houseID } = await requireOccurrence(request);
        return json(200, { tasks: (await candidates.execute(user, occurrenceID, houseID)).map(taskItemDTO) });
      }
      case "createSwap": {
        const body = jsonObject(request.body);
        const input = body === null ? null : parseCreateSwap(body);
        if (input === null) return badRequest();
        // As duas ocorrências precisam ser de uma casa do morador: senão 404, igual a inexistente.
        await tasks.houseOfOccurrence(input.offered, user);
        await tasks.houseOfOccurrence(input.requested, user);
        return json(201, taskSwapRequestDTO(await createSwap.execute(user, input.offered, input.requested)));
      }
      case "mySwaps": {
        const house = await currentHouse(user);
        if (house === null) return noHouse();
        const [incoming, outgoing] = await Promise.all([
          incomingSwaps.execute(user, house.id), outgoingSwaps.execute(user, house.id),
        ]);
        return json(200, { incoming: incoming.map(taskSwapRequestDTO), outgoing: outgoing.map(taskSwapRequestDTO) });
      }
      case "acceptSwap":
      case "rejectSwap": {
        const swapID = taskSwapRequestID(requireParam(request.params, "swapID"));
        // Só quem está na troca a enxerga; o domínio decide quem pode responder (403 para quem a pediu).
        const house = await currentHouse(user);
        if (house === null) return notFound();
        const [incoming, outgoing] = await Promise.all([
          incomingSwaps.execute(user, house.id), outgoingSwaps.execute(user, house.id),
        ]);
        if (![...incoming, ...outgoing].some((swap) => swap.id === swapID)) return notFound();
        const resolved = name === "acceptSwap" ? await acceptSwap.execute(swapID, user) : await rejectSwap.execute(swapID, user);
        return json(200, taskSwapRequestDTO(resolved));
      }

      case "myNotifications":
        return json(200, { notifications: (await myNotifications.execute(user)).map(notificationDTO) });
      case "readNotification":
        await markAsRead.execute(notificationID(requireParam(request.params, "notificationID")), user);
        return noContent();
    }
  };
}
