import type { Instant } from "./dates.ts";
import type {
  AppNotification, House, Room, RoomMembership, RoomParticipation, TaskDefinition, TaskItem, TaskSwapRequest, User,
} from "./entities.ts";
import type {
  HouseID, NotificationID, RoomID, TaskDefinitionID, TaskOccurrenceID, TaskSwapRequestID, UserID,
} from "./ids.ts";
import type { LeaveHouseOutcome, VacationStatus } from "./commands/houses.ts";
import type { TaskDetailsPatch } from "./commands/tasks.ts";
import type { RoomPatch } from "./commands/rooms.ts";
import type { PendingRating, RatingInput, RatingResult } from "./commands/ratings.ts";

export interface HouseRepository {
  addMember(name: string, houseID: HouseID, requestedBy: UserID, at: Instant): Promise<User>;
  removeMember(userID: UserID, houseID: HouseID, requestedBy: UserID, at: Instant, confirmRoomDeletion: boolean): Promise<void>;
  /** Cria a casa com o fundador e o cômodo "Casa toda"; o código de convite vem de um gerador injetado no adaptador. */
  create(founderID: UserID, name: string, timezone: string, at: Instant): Promise<House>;
  /** Entra numa casa pelo código de convite (código inexistente ou malformado: `invalidAccessCode`). */
  joinByCode(userID: UserID, code: string, at: Instant): Promise<House>;
  /**
   * O próprio morador sai da casa. O último só sai com `confirmHouseDeletion` (senão
   * `houseDeletionConfirmationRequired`), e a casa é excluída inteira.
   */
  leave(
    userID: UserID, houseID: HouseID, at: Instant, confirmRoomDeletion: boolean, confirmHouseDeletion?: boolean,
  ): Promise<LeaveHouseOutcome>;
  /** Qualquer morador da casa muda o nome (`invalidHouseName`; quem não é da casa: `entityNotFound`). */
  rename(houseID: HouseID, requestedBy: UserID, name: string): Promise<House>;
  /**
   * Avisos que dependem do tempo, para a tarefa agendada: "o ciclo virou" e "o resumo da semana está pronto".
   * Idempotente (um aviso por pessoa e ciclo). Devolve quantos criou.
   */
  emitScheduledNotifications(houseID: HouseID, at: Instant): Promise<number>;
  /** Modo férias do morador (ausência sem data de volta). */
  vacation(userID: UserID, houseID: HouseID): Promise<VacationStatus>;
  /** Liga (a partir da próxima segunda) ou desliga o modo férias; idempotente. Replaneja a escala. */
  setVacation(userID: UserID, houseID: HouseID, on: boolean, at: Instant): Promise<VacationStatus>;
  house(id: HouseID): Promise<House>;
  houses(userID: UserID): Promise<House[]>;
  members(houseID: HouseID): Promise<User[]>;
  memberIDs(houseID: HouseID): Promise<UserID[]>;
}

export interface RoomRepository {
  participation(roomID: RoomID, requesting: UserID, at: Instant): Promise<RoomParticipation>;
  room(id: RoomID, requesting: UserID): Promise<Room>;
  rooms(houseID: HouseID, requesting: UserID): Promise<Room[]>;
  create(room: Room, memberships: readonly RoomMembership[]): Promise<Room>;
  /** Edita o cômodo (ver `updateRoom`): "Casa toda" é `wholeHouseProtected`; privado de que não participa, `entityNotFound`. */
  update(roomID: RoomID, patch: RoomPatch, requestedBy: UserID, at: Instant): Promise<Room>;
  /** Exclui o cômodo e tudo o que é dele; exige `confirmDeletion` (`deletionConfirmationRequired`). */
  delete(roomID: RoomID, requestedBy: UserID, at: Instant, confirmDeletion: boolean): Promise<void>;
  /** Cômodos privados da casa para os quais o morador tem pedido de entrada aberto. */
  pendingAccessRoomIDs(houseID: HouseID, userID: UserID): Promise<RoomID[]>;
  /** Pedidos abertos de um cômodo; só quem participa dele os vê. */
  accessRequests(roomID: RoomID, requesting: UserID): Promise<readonly RoomAccessRequestSummary[]>;
  /** Idempotente; `roomAccessNotRequestable` se o cômodo não é privado ou o morador já participa. */
  requestAccess(roomID: RoomID, userID: UserID, at: Instant): Promise<void>;
  /** Idempotente: cancelar sem pedido aberto não faz nada. */
  cancelAccess(roomID: RoomID, userID: UserID): Promise<void>;
  /** Um participante do cômodo aprova (o morador entra no cômodo) ou recusa; avisa quem pediu. */
  answerAccess(roomID: RoomID, requesterID: UserID, answeredBy: UserID, approve: boolean, at: Instant): Promise<void>;
  /** Cômodos cujo ciclo acabou e que o morador pode avaliar (não cuidou deles e ainda não avaliou). */
  pendingRatings(houseID: HouseID, userID: UserID, at: Instant): Promise<PendingRating[]>;
  /** Grava ou refaz a avaliação (anônima) dentro da janela de 2 dias depois do fim do ciclo. */
  rateRoom(roomID: RoomID, userID: UserID, input: RatingInput, at: Instant): Promise<void>;
  /** Resultado da semana dos cômodos de que o morador cuidou (só quando liberado: 2 avaliações ou janela fechada). */
  ratingSummary(houseID: HouseID, userID: UserID, at: Instant): Promise<RatingResult[]>;
}

export interface RoomAccessRequestSummary {
  readonly userID: UserID;
  readonly requestedAt: Instant;
}

export interface TaskRepository {
  tasks(userID: UserID, houseID: HouseID): Promise<TaskItem[]>;
  roomTasks(roomID: RoomID, requesting: UserID): Promise<TaskItem[]>;
  sporadicTasks(houseID: HouseID, requesting: UserID): Promise<TaskItem[]>;
  /** Definição da tarefa do cômodo (inclusive encerrada); `entityNotFound` se não existir ou o morador não puder vê-la. */
  definition(roomID: RoomID, taskID: TaskDefinitionID, requesting: UserID): Promise<TaskDefinition>;
  /** Casa da ocorrência, se o morador for dela; `entityNotFound` caso contrário (igual a ocorrência inexistente). */
  houseOfOccurrence(occurrenceID: TaskOccurrenceID, requesting: UserID): Promise<HouseID>;
  create(definition: TaskDefinition, requestedBy: UserID, at: Instant): Promise<TaskDefinition>;
  /** Encerra a tarefa recorrente do cômodo (o cômodo escolhe a partição no DynamoDB, que não indexa definições): o histórico fica, as ocorrências futuras somem e as trocas pendentes que as citam são recusadas. */
  endTask(roomID: RoomID, taskID: TaskDefinitionID, requestedBy: UserID, at: Instant): Promise<void>;
  /**
   * Edita nome, descrição e esforço de uma tarefa **avulsa**; só quem a criou (e que ainda participa do cômodo).
   * Senão `taskUnavailable`; tarefa inexistente ou de outra casa, `entityNotFound`. Mudar o esforço atualiza o
   * `effortSnapshot` das ocorrências ainda não concluídas. Avisa quem acompanha o cômodo (menos quem editou).
   */
  updateTaskDetails(
    roomID: RoomID, taskID: TaskDefinitionID, patch: TaskDetailsPatch, requestedBy: UserID, at: Instant,
  ): Promise<TaskDefinition>;
  /**
   * Exclui de vez uma tarefa **avulsa** (definição, ocorrências, atribuições e as trocas que as citam, com as notificações
   * delas); só quem a criou. Mesmas regras de erro de `updateTaskDetails`.
   */
  deleteSporadicTask(roomID: RoomID, taskID: TaskDefinitionID, requestedBy: UserID, at: Instant): Promise<void>;
  refreshSchedule(houseID: HouseID, at: Instant): Promise<void>;
  addMember(userID: UserID, roomID: RoomID, at: Instant): Promise<void>;
  removeMember(userID: UserID, roomID: RoomID, at: Instant, confirmDeletion: boolean): Promise<void>;
  complete(occurrenceID: TaskOccurrenceID, by: UserID, at: Instant): Promise<void>;
  reopen(occurrenceID: TaskOccurrenceID, by: UserID): Promise<void>;
  claim(occurrenceID: TaskOccurrenceID, by: UserID, at: Instant): Promise<void>;
  release(occurrenceID: TaskOccurrenceID, by: UserID): Promise<void>;
}

export interface TaskSwapRepository {
  swapCandidates(requesterID: UserID, offering: TaskOccurrenceID, houseID: HouseID, at: Instant): Promise<TaskItem[]>;
  createRequest(
    requesterID: UserID, offered: TaskOccurrenceID, requested: TaskOccurrenceID, at: Instant,
  ): Promise<TaskSwapRequest>;
  incomingRequests(userID: UserID, houseID: HouseID): Promise<TaskSwapRequest[]>;
  outgoingRequests(userID: UserID, houseID: HouseID): Promise<TaskSwapRequest[]>;
  accept(requestID: TaskSwapRequestID, by: UserID, at: Instant): Promise<TaskSwapRequest>;
  reject(requestID: TaskSwapRequestID, by: UserID, at: Instant): Promise<TaskSwapRequest>;
  /** Quem pediu desiste de um pedido pendente (`cancelled`); os avisos do pedido saem. Outra pessoa ou já respondido: `taskUnavailable`. */
  cancel(requestID: TaskSwapRequestID, by: UserID, at: Instant): Promise<TaskSwapRequest>;
}

export interface NotificationRepository {
  notifications(userID: UserID): Promise<AppNotification[]>;
  markAsRead(notificationID: NotificationID, by: UserID, at: Instant): Promise<void>;
}
