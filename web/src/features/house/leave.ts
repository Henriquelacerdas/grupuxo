import { ApiError } from "@/lib/client/http";

// Sair da casa (HouseSettingsView + RemoteHouseSession.leaveHouse): o servidor responde 409 quando a saída
// apagaria cômodos ou a casa; o app confirma e repete com a query correspondente.

export interface LeaveOptions { readonly confirmRoomDeletion: boolean; readonly confirmHouseDeletion: boolean }

export type LeaveOutcome =
  | { readonly kind: "left" }
  | { readonly kind: "confirmRooms" }
  | { readonly kind: "confirmHouse" }
  | { readonly kind: "failed"; readonly error: unknown };

export async function attemptLeave(leave: (rooms: boolean, house: boolean) => Promise<void>, options: LeaveOptions): Promise<LeaveOutcome> {
  try {
    await leave(options.confirmRoomDeletion, options.confirmHouseDeletion);
    return { kind: "left" };
  } catch (error) {
    if (error instanceof ApiError && error.code === "house_deletion_confirmation_required") return { kind: "confirmHouse" };
    if (error instanceof ApiError && error.code === "room_deletion_confirmation_required") return { kind: "confirmRooms" };
    return { kind: "failed", error };
  }
}

/** Primeira pergunta: último morador vai direto para "apagar a casa"; senão, "Sair da <casa>?". */
export const firstLeaveStep = (memberCount: number): "confirmHouse" | "confirmLeave" => (memberCount <= 1 ? "confirmHouse" : "confirmLeave");
