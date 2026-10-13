import { LocalDatabaseError } from "../adapters/local/local-database.ts";
import { LambdaConfigError } from "../lambdas/config.ts";
import { createHttpServer } from "./http-server.ts";
import { composeLocalApp, type LocalApp } from "./local-app.ts";
import { environment, http, newAccessCode, newID, now } from "./runtime-core.ts";

// Ponto de entrada do servidor local de demonstração (sem AWS): `npm run start:local`.
// Variáveis em `backend/.env.example`. Mensagens fixas em `stderr`: nunca valor de variável, texto de mensagem nem telefone.

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const env = environment();
const port = Number(env["PORT"] ?? "8787");
if (!Number.isInteger(port) || port < 1 || port > 65535) fail("PORT inválida");

let app: LocalApp;
try {
  app = composeLocalApp({
    env, http, now, newID, newAccessCode,
    onDropped: () => process.stderr.write("mensagem descartada depois de esgotar as tentativas\n"),
  });
} catch (error) {
  if (error instanceof LambdaConfigError) fail(`configuração inválida: ${error.message}`);
  if (error instanceof LocalDatabaseError) fail(error.message);
  throw error;
}

const server = createHttpServer(app.handlers);
server.listen(port, () => process.stderr.write(`grupuxo local ouvindo na porta ${port}\n`));

function shutdown(): void {
  server.close();
  app.queue.idle().finally(() => {
    app.database.flush();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
