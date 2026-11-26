import { userPK } from "../adapters/dynamodb/keys.ts";
import { createPushHandler } from "../lambdas/push.ts";
import { parseApnsSecret, parsePushSettings } from "../lambdas/config.ts";
import { userID } from "../domain/ids.ts";
import { ApnsPushSender } from "../push/apns-sender.ts";
import { PushNotifier } from "../push/notifier.ts";
import { RoutingPushSender } from "../push/routing-sender.ts";
import { Http2ApnsTransport } from "./apns-http2.ts";
import { pushAdapters } from "./dynamo-adapters.ts";
import { dynamoClient, environment, lazyHandler, now, secretReader } from "./runtime.ts";
import { webPushSender } from "./web-push.ts";

// Lambda `push` (gatilho DynamoDB Streams, só INSERT de `NOTIF#`). Ambiente: `TABLE_NAME`, `SECRET_ID` (segredo do APNs:
// APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY), `WEBPUSH_SECRET_ID` (chaves VAPID, lidas no primeiro envio
// web) e `WEBPUSH_SUBJECT`. Sem conteúdo em log.
export const handler = lazyHandler(async () => {
  const env = environment();
  const settings = parsePushSettings(env);
  const credentials = parseApnsSecret(await secretReader(env).read());
  const client = dynamoClient(settings.tableName);
  const notifier = new PushNotifier({
    directory: pushAdapters(client).directory,
    sender: new RoutingPushSender({
      apns: new ApnsPushSender({ credentials, transport: new Http2ApnsTransport(), now }),
      web: webPushSender(settings.webPush),
    }),
    names: async (id) => {
      const profile = await client.get({ key: { PK: userPK(userID(id)), SK: "PROFILE" }, consistentRead: false });
      const name = profile?.["name"];
      return typeof name === "string" ? name : null;
    },
  });
  return createPushHandler(notifier, (description) => { process.stderr.write(`push: registro falhou: ${description}\n`); });
});
