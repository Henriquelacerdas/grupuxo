import type { Instant } from "../dates.ts";
import type { House, Room, RoomParticipation, TaskItem, User } from "../entities.ts";
import { DomainError } from "../errors.ts";
import type { HouseID, UserID } from "../ids.ts";
import type { StoreState } from "../store-state.ts";
import type { CommandContext } from "./context.ts";
import { houseMembers } from "./houses.ts";
import { roomParticipation, roomsFor } from "./rooms.ts";
import { roomTasks, sporadicTasks, taskItems, userTasks } from "./tasks.ts";

/** Uma leitura da casa alimenta as telas, preservando as mesmas políticas das consultas individuais. */
export interface HouseSnapshot {
  readonly userID: UserID;
  readonly house: House;
  readonly members: readonly User[];
  readonly rooms: readonly Room[];
  readonly participations: readonly RoomParticipation[];
  readonly roomTasks: readonly TaskItem[];
  readonly myTasks: readonly TaskItem[];
  readonly sporadicTasks: readonly TaskItem[];
}

export interface HouseSnapshotRepository {
  snapshot(houseID: HouseID, userID: UserID, at: Instant): Promise<HouseSnapshot>;
}

/** A escala deve estar atualizada antes desta consulta. Não expõe estado interno nem tarefas privadas. */
export function houseSnapshot(
  ctx: CommandContext, state: StoreState, houseID: HouseID, userID: UserID, at: Instant,
): HouseSnapshot {
  const rooms = roomsFor(state, houseID, userID); // Confere a participação na casa antes de montar o resultado.
  const house = state.houses.find((candidate) => candidate.id === houseID);
  if (house === undefined) throw new DomainError("entityNotFound");
  const items = taskItems(state);
  return {
    userID, house, members: houseMembers(state, houseID), rooms,
    participations: rooms.map((room) => roomParticipation(ctx, state, room.id, userID, at)),
    roomTasks: rooms.flatMap((room) => roomTasks(state, room.id, userID, items)),
    myTasks: userTasks(state, userID, houseID, at, items),
    sporadicTasks: sporadicTasks(ctx, state, houseID, userID, at, items),
  };
}
