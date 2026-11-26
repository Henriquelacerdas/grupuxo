import { listHouseIDs } from "../adapters/dynamodb/house-lister.ts";
import { createScheduledHandler } from "../lambdas/scheduled.ts";
import { parseScheduledSettings } from "../lambdas/config.ts";
import { DailyTaskReminder } from "../push/daily-reminder.ts";
import { RoutingPushSender } from "../push/routing-sender.ts";
import { houseAdapters, pushAdapters } from "./dynamo-adapters.ts";
import { dynamoClient, environment, lazyHandler, now } from "./runtime.ts";
import { webPushSender } from "./web-push.ts";

// Lambda `scheduled` (regra do EventBridge a cada hora). Ambiente: `TABLE_NAME`, `WEBPUSH_SECRET_ID` e `WEBPUSH_SUBJECT`
// (lembrete diário por Web Push; o APNs não entra aqui).
// O orçamento deixa folga para o timeout da função (120 s em infra/lambdas.tf): a última casa começada ainda termina.
const CONCURRENCY = 8;
const TIME_BUDGET_MS = 90_000;

export const handler = lazyHandler(async () => {
  const settings = parseScheduledSettings(environment());
  const client = dynamoClient(settings.tableName);
  const { houses, tasks } = houseAdapters(client);
  const { directory, claims } = pushAdapters(client);
  const reminder = new DailyTaskReminder({
    directory, claims, sender: new RoutingPushSender({ apns: null, web: webPushSender(settings.webPush) }),
  });
  return createScheduledHandler({
    houseIDs: () => listHouseIDs(client),
    emit: (houseID, at) => houses.emitScheduledNotifications(houseID, at),
    remind: async (houseID, at) => reminder.remind(await tasks.pendingTaskCounts(houseID, at), at),
    now,
    concurrency: CONCURRENCY,
    timeBudgetMs: TIME_BUDGET_MS,
    onFailure: (description) => { process.stderr.write(`scheduled: casa falhou: ${description}\n`); },
  });
});
