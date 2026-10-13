import { InProcessMessageQueue } from "../adapters/local/in-process-queue.ts";
import { LocalDatabase } from "../adapters/local/local-database.ts";
import { InMemoryHouseRepository, InMemoryRoomRepository, InMemoryTaskRepository } from "../adapters/in-memory/repositories.ts";
import type { TokenVerifier } from "../auth/token-verifier.ts";
import type { CommandContext } from "../domain/commands/context.ts";
import type { Instant } from "../domain/dates.ts";
import type { IDGenerator } from "../domain/ids.ts";
import { CompleteTaskUseCase, GetMyTasksUseCase, GetRoomTasksUseCase, GetSporadicTasksUseCase } from "../domain/use-cases/tasks.ts";
import type { HttpFetch } from "../http.ts";
import { createApiHandler } from "../lambdas/api.ts";
import { composeCognitoVerifier, composeWhatsAppWorker } from "../lambdas/compose.ts";
import {
  parseApiSettings, parseWebhookSecrets, parseWorkerSecrets, parseWorkerSettings, type Environment,
} from "../lambdas/config.ts";
import { createWebhookHandler } from "../lambdas/webhook.ts";
import { WhatsAppLinker } from "../whatsapp/linking/whatsapp-linker.ts";
import { WebhookHandler } from "../whatsapp/webhook/webhook-handler.ts";
import type { HttpServerHandlers } from "./http-server.ts";

// Servidor local de demonstração (sem AWS): a mesma composição das Lambdas `api`, `webhook` e `worker`, num
// processo só, com `LocalDatabase` (arquivo JSON) no lugar do DynamoDB e `InProcessMessageQueue` no lugar do SQS.
// Os segredos vêm do ambiente (`.env`), com os mesmos nomes do segredo da AWS. Tudo é recebido por parâmetro:
// quem lê `process.env` e escolhe relógio e rede é `server.ts`.

export interface LocalAppDependencies {
  readonly env: Environment;
  readonly http: HttpFetch;
  readonly now: () => Instant;
  readonly newID: IDGenerator;
  readonly newAccessCode: () => string;
  /** Chamado quando uma mensagem esgota as tentativas e é descartada. */
  readonly onDropped: () => void;
  /** Só para testes: troca o verificador de token do Cognito. */
  readonly verifier?: TokenVerifier;
  readonly retryDelayMs?: number;
}

export interface LocalApp {
  readonly handlers: HttpServerHandlers;
  readonly database: LocalDatabase;
  readonly queue: InProcessMessageQueue;
}

const SECRET_NAMES = ["VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_TOKEN", "PHONE_NUMBER_ID", "GEMINI_API_KEY"] as const;

/** Lança `LambdaConfigError` (mensagem fixa, só o nome da variável) se algo faltar ou for inválido. */
export function composeLocalApp(deps: LocalAppDependencies): LocalApp {
  const { env, http, now, newID } = deps;
  const workerSettings = parseWorkerSettings({ TABLE_NAME: "local", ...env });
  const apiSettings = parseApiSettings({ TABLE_NAME: "local", ...env });
  const secrets = JSON.stringify(Object.fromEntries(SECRET_NAMES.map((name) => [name, env[name]])));
  const webhookSecrets = parseWebhookSecrets(secrets);
  const workerSecrets = parseWorkerSecrets(secrets);

  const database = LocalDatabase.open({ path: env["DB_PATH"] ?? "data/db.json", now, newID });
  const ctx: CommandContext = { now, newID };
  const houses = new InMemoryHouseRepository(database.store, ctx, deps.newAccessCode);
  const rooms = new InMemoryRoomRepository(database.store, ctx);
  const tasks = new InMemoryTaskRepository(database.store, ctx);
  const linker = new WhatsAppLinker(workerSettings.link, database.linkTokens, database.links, now);

  const worker = composeWhatsAppWorker({
    settings: workerSettings, secrets: workerSecrets, http, now,
    inbox: database.inbox, links: database.links, linker, rateCounter: database.rateCounter,
    assistant: {
      houses, rooms,
      myTasks: new GetMyTasksUseCase(tasks, houses, now),
      roomTasks: new GetRoomTasksUseCase(tasks),
      sporadicTasks: new GetSporadicTasksUseCase(tasks),
      complete: new CompleteTaskUseCase(tasks, now),
      pending: database.pending,
    },
  });
  const queue = new InProcessMessageQueue({
    process: (message) => worker.process(message),
    onDropped: deps.onDropped,
    ...(deps.retryDelayMs === undefined ? {} : { retryDelayMs: deps.retryDelayMs }),
  });

  return {
    database, queue,
    handlers: {
      webhook: createWebhookHandler(new WebhookHandler(webhookSecrets, queue, now)),
      api: createApiHandler({
        verifier: deps.verifier ?? composeCognitoVerifier(apiSettings, http, now),
        users: database.users, linker, links: database.links, houses, rooms, tasks, now, newID,
      }),
    },
  };
}
