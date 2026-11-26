import { localDateTime, type Instant } from "../domain/dates.ts";
import type { HousePendingTasks } from "../domain/commands/tasks.ts";
import type { UserID } from "../domain/ids.ts";
import type { PushDirectory, PushSender } from "./push.ts";

/** Um lembrete por morador e dia local da casa: `claim` devolve `false` se o dia já foi reivindicado. */
export interface ReminderClaims {
  claim(userID: UserID, localDay: string, at: Instant): Promise<boolean>;
}

const pad = (value: number, length: number): string => String(value).padStart(length, "0");

/**
 * Lembrete diário das tarefas pendentes, **só por Web Push** (no iPhone ele é uma notificação local agendada pelo app;
 * o APNs nunca recebe `dailyTasks`). Para cada morador com pendências, "Lembrar das minhas tarefas" ligado e
 * `reminderHour` igual à hora local da casa, reivindica o dia (`ReminderClaims`, idempotente: a rodada repetida ou a
 * hora que se repete na saída do horário de verão não mandam de novo) e manda `dailyTasks { count }` aos aparelhos web.
 * A reivindicação vem antes do envio: falha de envio perde o lembrete daquele dia, nunca o duplica. Devolve quantos
 * pushes saíram.
 */
export class DailyTaskReminder {
  private readonly directory: PushDirectory;
  private readonly sender: PushSender;
  private readonly claims: ReminderClaims;

  constructor(options: { readonly directory: PushDirectory; readonly sender: PushSender; readonly claims: ReminderClaims }) {
    this.directory = options.directory;
    this.sender = options.sender;
    this.claims = options.claims;
  }

  async remind(house: HousePendingTasks, at: Instant): Promise<number> {
    const local = localDateTime(house.timezone, at);
    const day = `${pad(local.year, 4)}-${pad(local.month, 2)}-${pad(local.day, 2)}`;
    let sent = 0;
    for (const member of house.members) {
      if (member.pending === 0) continue;
      const preferences = await this.directory.preferences(member.userID);
      if (!preferences.remindTasks || preferences.reminderHour !== local.hour) continue;
      const devices = (await this.directory.devices(member.userID)).filter((device) => device.kind === "web");
      if (devices.length === 0) continue;
      if (!(await this.claims.claim(member.userID, day, at))) continue;
      for (const device of devices) {
        const result = await this.sender.send(device, { kind: "dailyTasks", count: member.pending });
        if (result === "sent") sent += 1;
        if (result === "invalidToken") await this.directory.removeDevice(member.userID, { kind: "web", endpoint: device.endpoint });
      }
    }
    return sent;
  }
}
