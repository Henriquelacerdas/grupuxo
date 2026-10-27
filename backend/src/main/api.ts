import { createApiHandler } from "../lambdas/api.ts";
import { composeCognitoVerifier } from "../lambdas/compose.ts";
import { parseApiSettings } from "../lambdas/config.ts";
import { houseAdapters, linkAdapters, userDirectory } from "./dynamo-adapters.ts";
import { dynamoClient, environment, http, lazyHandler, newID, now } from "./runtime.ts";

// Lambda `api` (Function URL). Ambiente: `TABLE_NAME`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `BOT_PHONE_NUMBER`.
export const handler = lazyHandler(async () => {
  const settings = parseApiSettings(environment());
  const client = dynamoClient(settings.tableName);
  const { houses, rooms, tasks, swaps, notifications } = houseAdapters(client);
  const { links, linker } = linkAdapters(client, settings.link);
  return createApiHandler({
    verifier: composeCognitoVerifier(settings, http, now),
    users: userDirectory(client),
    linker, links, houses, rooms, tasks, swaps, notifications, snapshots: tasks, now, newID,
  });
});
