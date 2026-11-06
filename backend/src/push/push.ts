import type { Instant } from "../domain/dates.ts";
import type { AppNotificationKind } from "../domain/entities.ts";
import type { UserID } from "../domain/ids.ts";

// Notificações push (APNs). O servidor manda só dados: tipo, quem fez e o nome do assunto. O app monta a frase no
// idioma do aparelho (chaves `push.<kind>` do String Catalog). Nada aqui conhece AWS ou HTTP.

export type ApnsEnvironment = "sandbox" | "production";

export interface PushDevice {
  readonly token: string;
  readonly environment: ApnsEnvironment;
}

/** Preferências por morador (Ajustes › Notificações). Avisos diretos (troca, pedido de entrada) sempre chegam. */
export interface NotificationPreferences {
  /** "Lembrar das minhas tarefas" e o horário do lembrete diário (hora local da casa, 0 a 23). */
  readonly remindTasks: boolean;
  readonly reminderHour: number;
  readonly cycleTurned: boolean;
  /** "Atividade da casa": edições, exclusões, entradas e saídas. */
  readonly houseActivity: boolean;
  readonly weeklySummary: boolean;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  remindTasks: true, reminderHour: 9, cycleTurned: true, houseActivity: true, weeklySummary: true,
};

export function validPreferences(value: NotificationPreferences): boolean {
  return Number.isInteger(value.reminderHour) && value.reminderHour >= 0 && value.reminderHour <= 23;
}

/** Se o morador quer receber um aviso deste tipo como push. */
export function allowsPush(preferences: NotificationPreferences, kind: AppNotificationKind): boolean {
  switch (kind) {
    case "cycleTurned": return preferences.cycleTurned;
    case "weeklySummaryReady": return preferences.weeklySummary;
    case "taskEdited": case "taskDeleted": case "effortChanged": case "memberJoined": case "memberLeft": case "roomDeleted":
      return preferences.houseActivity;
    case "taskSwapRequested": case "taskSwapAccepted": case "taskSwapRejected":
    case "roomAccessRequested": case "roomAccessApproved": case "roomAccessDenied":
      return true;
  }
}

export interface PushMessage {
  readonly kind: AppNotificationKind;
  readonly actorName: string | null;
  readonly subjectName: string | null;
}

export type PushResult = "sent" | "invalidToken" | "failed";

export interface PushSender {
  send(device: PushDevice, message: PushMessage): Promise<PushResult>;
}

export interface PushDirectory {
  registerDevice(userID: UserID, device: PushDevice, at: Instant): Promise<void>;
  removeDevice(userID: UserID, token: string): Promise<void>;
  devices(userID: UserID): Promise<readonly PushDevice[]>;
  preferences(userID: UserID): Promise<NotificationPreferences>;
  setPreferences(userID: UserID, preferences: NotificationPreferences): Promise<void>;
}

/** Token do APNs: hexadecimal (64 caracteres hoje; aceita de 32 a 200 para não quebrar se o formato crescer). */
export const validDeviceToken = (token: string): boolean => /^[0-9a-fA-F]{32,200}$/.test(token);
