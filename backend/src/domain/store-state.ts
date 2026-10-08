import { cloneSchedulingState, type AppNotification, type House, type SchedulingState, type TaskSwapRequest, type User } from "./entities.ts";

/** Estado completo de um armazenamento (hoje em memória; no futuro, o que o DynamoDB carrega por casa). */
export interface StoreState extends SchedulingState {
  users: User[];
  houses: House[];
  taskSwapRequests: TaskSwapRequest[];
  notifications: AppNotification[];
}

export function cloneStoreState(state: StoreState): StoreState {
  return {
    ...cloneSchedulingState(state),
    users: [...state.users],
    houses: [...state.houses],
    taskSwapRequests: [...state.taskSwapRequests],
    notifications: [...state.notifications],
  };
}
