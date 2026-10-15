import { CompleteTaskUseCase, GetMyTasksUseCase, GetRoomTasksUseCase, GetSporadicTasksUseCase } from "../domain/use-cases/tasks.ts";
import { composeWhatsAppWorker } from "../lambdas/compose.ts";
import { parseWorkerSecrets, parseWorkerSettings } from "../lambdas/config.ts";
import { createWorkerHandler } from "../lambdas/worker.ts";
import { houseAdapters, linkAdapters, whatsAppStores } from "./dynamo-adapters.ts";
import { dynamoClient, environment, http, lazyHandler, now, secretReader } from "./runtime.ts";

// Lambda `whatsapp-worker` (gatilho SQS FIFO). Ambiente: `SECRET_ID`, `TABLE_NAME`, `GEMINI_MODEL`,
// `WHATSAPP_GRAPH_VERSION`, `RATE_LIMIT_MAX_MESSAGES`, `RATE_LIMIT_WINDOW_SECONDS`, `BOT_PHONE_NUMBER`.
export const handler = lazyHandler(async () => {
  const env = environment();
  const settings = parseWorkerSettings(env);
  const secrets = parseWorkerSecrets(await secretReader(env).read());
  const client = dynamoClient(settings.tableName);
  const { houses, rooms, tasks } = houseAdapters(client);
  const { links, linker } = linkAdapters(client, settings.link);
  const { inbox, rateCounter, pending } = whatsAppStores(client, settings.rateLimit.windowSeconds);
  const worker = composeWhatsAppWorker({
    settings, secrets, http, now, inbox, links, linker, rateCounter,
    assistant: {
      houses, rooms,
      myTasks: new GetMyTasksUseCase(tasks, houses, now),
      roomTasks: new GetRoomTasksUseCase(tasks),
      sporadicTasks: new GetSporadicTasksUseCase(tasks),
      complete: new CompleteTaskUseCase(tasks, now),
      pending,
    },
  });
  // Só a descrição sem conteúdo (`describeFailure`); o Lambda leva o stderr ao CloudWatch.
  return createWorkerHandler(worker, (description) => { process.stderr.write(`worker: mensagem falhou: ${description}\n`); });
});
