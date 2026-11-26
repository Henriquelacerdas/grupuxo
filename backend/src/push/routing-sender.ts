import type { ApnsDevice, PushDevice, PushMessage, PushResult, PushSender, WebPushDevice } from "./push.ts";

/**
 * Escolhe o envio pelo tipo do aparelho: APNs para o iPhone, Web Push para o navegador. O lembrete diário
 * (`dailyTasks`) nunca vai para o APNs. Sem envio configurado para um tipo, o push daquele aparelho falha
 * (`failed`, o aparelho fica) e os outros seguem.
 */
export class RoutingPushSender implements PushSender {
  private readonly apns: PushSender<ApnsDevice> | null;
  private readonly web: PushSender<WebPushDevice> | null;

  constructor(options: { readonly apns: PushSender<ApnsDevice> | null; readonly web: PushSender<WebPushDevice> | null }) {
    this.apns = options.apns;
    this.web = options.web;
  }

  async send(device: PushDevice, message: PushMessage): Promise<PushResult> {
    if (device.kind === "apns") {
      if (message.kind === "dailyTasks" || this.apns === null) return "failed";
      return this.apns.send(device, message);
    }
    return this.web === null ? "failed" : this.web.send(device, message);
  }
}
