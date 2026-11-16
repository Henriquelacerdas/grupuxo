import {
  cloneSchedulingState, type AppNotification, type House, type RoomAccessRequest, type RoomRating, type SchedulingState,
  type TaskSwapRequest, type User,
} from "./entities.ts";

/** Estado completo de um armazenamento (hoje em memória; no futuro, o que o DynamoDB carrega por casa). */
export interface StoreState extends SchedulingState {
  users: User[];
  houses: House[];
  taskSwapRequests: TaskSwapRequest[];
  notifications: AppNotification[];
  roomAccessRequests: RoomAccessRequest[];
  roomRatings: RoomRating[];
}

export function cloneStoreState(state: StoreState): StoreState {
  return {
    ...cloneSchedulingState(state),
    users: [...state.users],
    houses: [...state.houses],
    taskSwapRequests: [...state.taskSwapRequests],
    notifications: [...state.notifications],
    roomAccessRequests: [...state.roomAccessRequests],
    roomRatings: [...state.roomRatings],
  };
}

/** Estado sem nenhuma entidade (ponto de partida para criar uma casa nova). */
export function emptyStoreState(): StoreState {
  return {
    users: [], houses: [], houseMemberships: [], rooms: [], roomMemberships: [], definitions: [], occurrences: [],
    assignments: [], absences: [], taskSwapRequests: [], notifications: [], roomAccessRequests: [], roomRatings: [],
  };
}
