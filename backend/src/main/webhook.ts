import { SQSClient } from "@aws-sdk/client-sqs";
import { SqsMessageQueue } from "../adapters/aws/sqs-message-queue.ts";
import { parseWebhookSecrets } from "../lambdas/config.ts";
import { createWebhookHandler } from "../lambdas/webhook.ts";
import { WebhookHandler } from "../whatsapp/webhook/webhook-handler.ts";
import { SdkSqsClient } from "./aws-sdk.ts";
import { environment, lazyHandler, now, secretReader } from "./runtime.ts";

// Lambda `whatsapp-webhook` (Function URL). Ambiente: `SECRET_ID`, `QUEUE_URL`.
export const handler = lazyHandler(async () => {
  const env = environment();
  const secrets = parseWebhookSecrets(await secretReader(env).read());
  const queue = new SqsMessageQueue({ client: new SdkSqsClient(new SQSClient({})), queueURL: env["QUEUE_URL"] });
  return createWebhookHandler(new WebhookHandler(secrets, queue, now));
});
