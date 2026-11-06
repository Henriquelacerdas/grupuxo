import { listHouseIDs } from "../adapters/dynamodb/house-lister.ts";
import { createScheduledHandler } from "../lambdas/scheduled.ts";
import { parsePushSettings } from "../lambdas/config.ts";
import { houseAdapters } from "./dynamo-adapters.ts";
import { dynamoClient, environment, lazyHandler, now } from "./runtime.ts";

// Lambda `scheduled` (regra do EventBridge a cada hora). Ambiente: `TABLE_NAME`.
export const handler = lazyHandler(async () => {
  const settings = parsePushSettings({ SECRET_ID: "-", ...environment() });
  const client = dynamoClient(settings.tableName);
  const { houses } = houseAdapters(client);
  return createScheduledHandler({
    houseIDs: () => listHouseIDs(client),
    emit: (houseID, at) => houses.emitScheduledNotifications(houseID, at),
    now,
    onFailure: (description) => { process.stderr.write(`scheduled: casa falhou: ${description}\n`); },
  });
});
