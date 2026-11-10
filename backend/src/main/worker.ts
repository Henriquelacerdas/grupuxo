import { measure } from "../latency.ts";
import { whatsappLatency } from "./latency.ts";
import { CompleteTaskUseCase, GetMyTasksUseCase, GetRoomTasksUseCase, GetSporadicTasksUseCase } from "../domain/use-cases/tasks.ts";
import { composeWhatsAppWorker } from "../lambdas/compose.ts";
import { parseWorkerSecrets, parseWorkerSettings } from "../lambdas/config.ts";
import { createWorkerHandler, describeFailure } from "../lambdas/worker.ts";
import { houseAdapters, linkAdapters, whatsAppStores } from "./dynamo-adapters.ts";
import { dynamoClient, environment, http, lazyHandler, now, secretReader, sleep } from "./runtime.ts";

// Lambda `whatsapp-worker` (gatilho SQS FIFO). Ambiente: `SECRET_ID`, `TABLE_NAME`, `GEMINI_MODEL`,
// `WHATSAPP_GRAPH_VERSION`, `RATE_LIMIT_MAX_MESSAGES`, `RATE_LIMIT_WINDOW_SECONDS`, `BOT_PHONE_NUMBER`.
const readyHandler = lazyHandler(async () => whatsappLatency.scope.run("setup", async (observer) => measure(observer, "setupMs", async () => {
  const env = environment();
  const settings = parseWorkerSettings(env);
  const secrets = parseWorkerSecrets(await secretReader(env).read());
  const client = dynamoClient(settings.tableName);
  const { houses, rooms, tasks } = houseAdapters(client, whatsappLatency.observer);
  const { links, linker } = linkAdapters(client, settings.link);
  const { inbox, rateCounter, pending } = whatsAppStores(client, settings.rateLimit.windowSeconds);
  const worker = composeWhatsAppWorker({
    settings, secrets, http, now, sleep, inbox, links, linker, rateCounter, latency: whatsappLatency.observer,
    assistant: {
      houses, rooms,
      myTasks: new GetMyTasksUseCase(tasks, houses, now),
      roomTasks: new GetRoomTasksUseCase(tasks),
      sporadicTasks: new GetSporadicTasksUseCase(tasks),
      complete: new CompleteTaskUseCase(tasks, now),
      pending,
      // A mensagem do morador cai no aviso genérico; aqui fica só o motivo, sem conteúdo (`describeFailure`).
      onGeminiFailure: (error) => { process.stderr.write(`worker: gemini falhou: ${describeFailure(error)}\n`); },
    },
  });
  // Só a descrição sem conteúdo (`describeFailure`); o Lambda leva o stderr ao CloudWatch.
  observer.outcome("success");
  return createWorkerHandler(worker, (description) => { process.stderr.write(`worker: mensagem falhou: ${description}\n`); }, whatsappLatency.scope);
})));

export const handler = (event: unknown) => whatsappLatency.scope.run("batch", async (observer) => {
  const response = await readyHandler(event);
  observer.outcome(response.batchItemFailures.length === 0 ? "success" : "failure");
  return response;
});
