import type { CognitoVerifierConfig } from "../auth/cognito-jwt-verifier.ts";
import { createLinkConfig, type LinkConfig } from "../whatsapp/linking/whatsapp-linker.ts";

// Leitura e validação da configuração das Lambdas. Funções puras: o ambiente e o segredo chegam por parâmetro
// (quem os lê de `process.env` e do Secrets Manager é o ponto de entrada, que ainda não existe: depende do
// empacotamento e do AWS SDK). Nada tem valor padrão escondido, e nenhuma mensagem de erro repete um valor.

export type Environment = Readonly<Record<string, string | undefined>>;

export class LambdaConfigError extends Error {
  /** Nome da variável ou da chave do segredo, nunca o valor. */
  readonly variable: string;

  constructor(variable: string, problem: "missing" | "invalid") {
    super(`${variable}: ${problem === "missing" ? "não configurada" : "valor inválido"}`);
    this.name = "LambdaConfigError";
    this.variable = variable;
  }
}

function required(env: Environment, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new LambdaConfigError(name, "missing");
  return value;
}

function positiveInteger(env: Environment, name: string): number {
  const value = required(env, name);
  if (!/^[1-9][0-9]{0,8}$/.test(value)) throw new LambdaConfigError(name, "invalid");
  return Number(value);
}

/** Variáveis de ambiente da Lambda `worker`. O nome do modelo e a versão da Graph API são validados nos clientes. */
export interface WorkerSettings {
  /** `GEMINI_MODEL` (sem modelo padrão escondido). */
  readonly geminiModel: string;
  /** `WHATSAPP_GRAPH_VERSION`, ex.: `v25.0` (sem versão padrão escondida). */
  readonly graphVersion: string;
  /** `RATE_LIMIT_MAX_MESSAGES` por `RATE_LIMIT_WINDOW_SECONDS`, por número. Sugestão inicial: 10 por 60 s. */
  readonly rateLimit: { readonly limit: number; readonly windowSeconds: number };
}

export function parseWorkerSettings(env: Environment): WorkerSettings {
  return {
    geminiModel: required(env, "GEMINI_MODEL"),
    graphVersion: required(env, "WHATSAPP_GRAPH_VERSION"),
    rateLimit: { limit: positiveInteger(env, "RATE_LIMIT_MAX_MESSAGES"), windowSeconds: positiveInteger(env, "RATE_LIMIT_WINDOW_SECONDS") },
  };
}

/** Variáveis de ambiente da Lambda `api` (valores públicos: IDs do Cognito e número do bot). */
export interface ApiSettings {
  readonly cognito: CognitoVerifierConfig;
  readonly link: LinkConfig;
}

export function parseApiSettings(env: Environment): ApiSettings {
  const userPoolID = required(env, "COGNITO_USER_POOL_ID");
  const clientID = required(env, "COGNITO_CLIENT_ID");
  let link: LinkConfig;
  try {
    link = createLinkConfig(required(env, "BOT_PHONE_NUMBER"));
  } catch (error) {
    if (error instanceof LambdaConfigError) throw error;
    throw new LambdaConfigError("BOT_PHONE_NUMBER", "invalid");
  }
  // O formato do pool e do client é conferido por `CognitoJwtVerifier` ao ser criado (falha fechada).
  return { cognito: { userPoolID, clientID }, link };
}

/** Segredos da Lambda `webhook` (`VERIFY_TOKEN` e `WHATSAPP_APP_SECRET` do Secrets Manager). */
export interface WebhookSecrets {
  readonly verifyToken: string;
  readonly appSecret: string;
}

/** Segredos da Lambda `worker`. */
export interface WorkerSecrets {
  readonly whatsappToken: string;
  readonly phoneNumberID: string;
  readonly geminiApiKey: string;
}

function secretFields(secretString: string): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secretString);
  } catch {
    throw new LambdaConfigError("segredo", "invalid");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new LambdaConfigError("segredo", "invalid");
  return Object.fromEntries(Object.entries(parsed));
}

function secretValue(fields: Readonly<Record<string, unknown>>, name: string): string {
  const value = Object.hasOwn(fields, name) ? fields[name] : undefined;
  if (value === undefined) throw new LambdaConfigError(name, "missing");
  if (typeof value !== "string" || value === "") throw new LambdaConfigError(name, "invalid");
  return value;
}

/** `secretString`: o `SecretString` do segredo (`grupuxo/whatsapp`), um objeto JSON com as chaves da seção 10. */
export function parseWebhookSecrets(secretString: string): WebhookSecrets {
  const fields = secretFields(secretString);
  return { verifyToken: secretValue(fields, "VERIFY_TOKEN"), appSecret: secretValue(fields, "WHATSAPP_APP_SECRET") };
}

export function parseWorkerSecrets(secretString: string): WorkerSecrets {
  const fields = secretFields(secretString);
  return {
    whatsappToken: secretValue(fields, "WHATSAPP_TOKEN"),
    phoneNumberID: secretValue(fields, "PHONE_NUMBER_ID"),
    geminiApiKey: secretValue(fields, "GEMINI_API_KEY"),
  };
}
