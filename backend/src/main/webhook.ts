import { measure } from "../latency.ts";
import { whatsappLatency } from "./latency.ts";
import { SQSClient } from "@aws-sdk/client-sqs";
import { SqsMessageQueue } from "../adapters/aws/sqs-message-queue.ts";
import { parseWebhookSecrets } from "../lambdas/config.ts";
import { createWebhookHandler } from "../lambdas/webhook.ts";
import { WebhookHandler } from "../whatsapp/webhook/webhook-handler.ts";
import { SdkSqsClient } from "./aws-sdk.ts";
import { environment, lazyHandler, now, secretReader } from "./runtime.ts";

// Lambda `whatsapp-webhook` (Function URL). Ambiente: `SECRET_ID`, `QUEUE_URL`.
const readyHandler = lazyHandler(async () => whatsappLatency.scope.run("setup", async (observer) => measure(observer, "setupMs", async () => {
  const env = environment();
  const secrets = parseWebhookSecrets(await secretReader(env).read());
  const queue = new SqsMessageQueue({ client: new SdkSqsClient(new SQSClient({})), queueURL: env["QUEUE_URL"] });
  observer.outcome("success");
  return createWebhookHandler(new WebhookHandler(
    secrets, queue, now, whatsappLatency.observer, () => whatsappLatency.scope.invocationStartedAt?.() ?? now(),
  ));
})));

export const handler = (event: unknown) => whatsappLatency.scope.run("webhook", async (observer) => {
  const response = await readyHandler(event);
  observer.outcome(response.statusCode < 400 ? "success" : response.statusCode < 500 ? "rejected" : "failure");
  return response;
});
