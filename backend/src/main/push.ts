import { DynamoPushDirectory } from "../adapters/dynamodb/push-directory.ts";
import { userPK } from "../adapters/dynamodb/keys.ts";
import { createPushHandler } from "../lambdas/push.ts";
import { parseApnsSecret, parsePushSettings } from "../lambdas/config.ts";
import { userID } from "../domain/ids.ts";
import { ApnsPushSender } from "../push/apns-sender.ts";
import { PushNotifier } from "../push/notifier.ts";
import { Http2ApnsTransport } from "./apns-http2.ts";
import { dynamoClient, environment, lazyHandler, now, secretReader } from "./runtime.ts";

// Lambda `push` (gatilho DynamoDB Streams, só INSERT de `NOTIF#`). Ambiente: `TABLE_NAME` e `SECRET_ID` (segredo do APNs:
// APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY). Sem conteúdo em log.
export const handler = lazyHandler(async () => {
  const env = environment();
  const settings = parsePushSettings(env);
  const credentials = parseApnsSecret(await secretReader(env).read());
  const client = dynamoClient(settings.tableName);
  const notifier = new PushNotifier({
    directory: new DynamoPushDirectory({ client }),
    sender: new ApnsPushSender({ credentials, transport: new Http2ApnsTransport(), now }),
    names: async (id) => {
      const profile = await client.get({ key: { PK: userPK(userID(id)), SK: "PROFILE" }, consistentRead: false });
      const name = profile?.["name"];
      return typeof name === "string" ? name : null;
    },
  });
  return createPushHandler(notifier, (description) => { process.stderr.write(`push: registro falhou: ${description}\n`); });
});
