import { listHouseIDs } from "../adapters/dynamodb/house-lister.ts";
import { DynamoPushDirectory } from "../adapters/dynamodb/push-directory.ts";
import type { UserID } from "../domain/ids.ts";
import { createScheduledHandler } from "../lambdas/scheduled.ts";
import { parsePushSettings } from "../lambdas/config.ts";
import { houseAdapters } from "./dynamo-adapters.ts";
import { dynamoClient, environment, lazyHandler, now } from "./runtime.ts";

// Lambda `scheduled` (regra do EventBridge a cada hora). Ambiente: `TABLE_NAME`.
export const handler = lazyHandler(async () => {
  const settings = parsePushSettings({ SECRET_ID: "-", ...environment() });
  const client = dynamoClient(settings.tableName);
  const { houses } = houseAdapters(client);
  const directory = new DynamoPushDirectory({ client });
  return createScheduledHandler({
    houseIDs: () => listHouseIDs(client),
    reminderHours: async (houseID) => {
      const hours = new Map<UserID, number>();
      for (const id of await houses.memberIDs(houseID)) {
        const preferences = await directory.preferences(id);
        if (preferences.remindTasks && (await directory.devices(id)).length > 0) hours.set(id, preferences.reminderHour);
      }
      return hours;
    },
    emit: (houseID, at, reminderHours) => houses.emitScheduledNotifications(houseID, at, reminderHours),
    now,
    onFailure: (description) => { process.stderr.write(`scheduled: casa falhou: ${description}\n`); },
  });
});
