import type { AppNotification } from "../domain/entities.ts";
import { allowsPush, type PushDirectory, type PushSender } from "./push.ts";

/** Resolve o nome de um morador (para "Fulano editou…"); `null` se não achar. */
export type UserNames = (userID: AppNotification["recipientUserID"]) => Promise<string | null>;

/**
 * Entrega um aviso novo como push: respeita as preferências de quem recebe, manda para todos os aparelhos e tira os
 * tokens que o APNs recusou. Devolve quantos pushes saíram. Falha de um aparelho não impede os outros.
 */
export class PushNotifier {
  private readonly directory: PushDirectory;
  private readonly sender: PushSender;
  private readonly names: UserNames;

  constructor(options: { readonly directory: PushDirectory; readonly sender: PushSender; readonly names: UserNames }) {
    this.directory = options.directory;
    this.sender = options.sender;
    this.names = options.names;
  }

  async deliver(notification: Pick<AppNotification, "recipientUserID" | "kind" | "actorUserID" | "subjectName">): Promise<number> {
    const preferences = await this.directory.preferences(notification.recipientUserID);
    if (!allowsPush(preferences, notification.kind)) return 0;
    const devices = await this.directory.devices(notification.recipientUserID);
    if (devices.length === 0) return 0;
    const actorName = notification.actorUserID === null ? null : await this.names(notification.actorUserID);
    let sent = 0;
    for (const device of devices) {
      const result = await this.sender.send(device, { kind: notification.kind, actorName, subjectName: notification.subjectName });
      if (result === "sent") sent += 1;
      if (result === "invalidToken") await this.directory.removeDevice(notification.recipientUserID, device.token);
    }
    return sent;
  }
}
