import { LambdaConfigError } from "../../lambdas/config.ts";
import type { SecretsManagerClient } from "./clients.ts";

// Leitura do `SecretString` de um segredo do Secrets Manager, uma vez por instância da Lambda. Nenhuma mensagem
// de erro carrega o ID do segredo, o conteúdo nem a mensagem do erro original.

export type SecretReadErrorCode =
  /** O cliente falhou (rede, permissão, segredo inexistente...). */
  | "readFailed"
  /** O segredo não tem `SecretString` (ausente, vazio ou binário). */
  | "noSecretString";

const SECRET_ERROR_MESSAGES: Readonly<Record<SecretReadErrorCode, string>> = {
  readFailed: "Falha ao ler o segredo",
  noSecretString: "O segredo não tem valor de texto",
};

export class SecretReadError extends Error {
  readonly code: SecretReadErrorCode;
  /** `name` do erro original (por exemplo `AccessDeniedException`), sem a mensagem. `null` se não houver. */
  readonly causeName: string | null;

  constructor(code: SecretReadErrorCode, causeName: string | null = null) {
    super(SECRET_ERROR_MESSAGES[code]);
    this.name = "SecretReadError";
    this.code = code;
    this.causeName = causeName;
  }
}

export interface SecretStringReaderOptions {
  readonly client: SecretsManagerClient;
  /** Nome ou ARN do segredo (por exemplo `grupuxo/whatsapp`; variável de ambiente da Lambda). */
  readonly secretID: string | undefined;
}

/**
 * Use `parseWebhookSecrets(await reader.read())` ou `parseWorkerSecrets(await reader.read())`. O sucesso fica em
 * cache (chamadas concorrentes compartilham a mesma busca); a falha não, para a próxima chamada tentar de novo.
 */
export class SecretStringReader {
  private readonly client: SecretsManagerClient;
  private readonly secretID: string;
  private cached: Promise<string> | null = null;

  constructor(options: SecretStringReaderOptions) {
    if (options.secretID === undefined || options.secretID === "") throw new LambdaConfigError("SECRET_ID", "missing");
    this.client = options.client;
    this.secretID = options.secretID;
  }

  read(): Promise<string> {
    if (this.cached === null) {
      const pending = this.load();
      this.cached = pending;
      pending.catch(() => {
        if (this.cached === pending) this.cached = null;
      });
    }
    return this.cached;
  }

  private async load(): Promise<string> {
    let value: string | undefined;
    try {
      value = await this.client.getSecretString(this.secretID);
    } catch (error) {
      throw new SecretReadError("readFailed", error instanceof Error ? error.name : null);
    }
    if (value === undefined || value === "") throw new SecretReadError("noSecretString");
    return value;
  }
}
