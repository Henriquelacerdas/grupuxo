import type { WebPushSettings } from "../lambdas/config.ts";
import { parseWebPushSecret } from "../lambdas/config.ts";
import { WebPushSender } from "../push/web-push-sender.ts";
import { now, secretReaderFor } from "./runtime.ts";

/**
 * Envio de Web Push com as chaves VAPID do segredo `WEBPUSH_SECRET_ID`, lidas no primeiro envio web (não na montagem do
 * handler): o APNs da Lambda `push` não depende do segredo do Web Push existir ou ter valor. Sem valor, o envio web
 * falha (`failed`) e o próximo tenta ler de novo.
 */
export function webPushSender(settings: WebPushSettings): WebPushSender {
  const reader = secretReaderFor(settings.secretID);
  return new WebPushSender({
    vapidKeys: async () => parseWebPushSecret(await reader.read()),
    subject: settings.subject,
    http: (url, init) => fetch(url, init),
    now,
  });
}
