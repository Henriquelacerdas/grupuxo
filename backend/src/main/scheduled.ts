import { listHouseIDs } from "../adapters/dynamodb/house-lister.ts";
import { createScheduledHandler } from "../lambdas/scheduled.ts";
import { parsePushSettings } from "../lambdas/config.ts";
import { houseAdapters } from "./dynamo-adapters.ts";
import { dynamoClient, environment, lazyHandler, now } from "./runtime.ts";

// Lambda `scheduled` (regra do EventBridge a cada hora). Ambiente: `TABLE_NAME`.
// O orçamento deixa folga para o timeout da função (120 s em infra/lambdas.tf): a última casa começada ainda termina.
const CONCURRENCY = 8;
const TIME_BUDGET_MS = 90_000;

export const handler = lazyHandler(async () => {
  const settings = parsePushSettings({ SECRET_ID: "-", ...environment() });
  const client = dynamoClient(settings.tableName);
  const { houses } = houseAdapters(client);
  return createScheduledHandler({
    houseIDs: () => listHouseIDs(client),
    emit: (houseID, at) => houses.emitScheduledNotifications(houseID, at),
    now,
    concurrency: CONCURRENCY,
    timeBudgetMs: TIME_BUDGET_MS,
    onFailure: (description) => { process.stderr.write(`scheduled: casa falhou: ${description}\n`); },
  });
});
