import { randomInt, randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SecretStringReader } from "../adapters/aws/secrets-manager-reader.ts";
import type { DynamoRuntime } from "../adapters/dynamodb/house-state-store.ts";
import type { Instant } from "../domain/dates.ts";
import type { IDGenerator } from "../domain/ids.ts";
import type { HttpFetch } from "../http.ts";
import type { Environment } from "../lambdas/config.ts";
import { SdkDynamoClient, SdkSecretsManagerClient } from "./aws-sdk.ts";

// Ponto de entrada: a única camada de `src/` que lê `process.env`, usa relógio, aleatoriedade e rede globais e
// importa o AWS SDK. Tudo o mais recebe essas dependências por parâmetro. Nada aqui registra em log.

export function environment(): Environment {
  return process.env;
}

export const now = (): Instant => Date.now();

/** UUID v4 em minúsculo (texto canônico dos IDs). */
export const newID: IDGenerator = () => randomUUID();

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const dynamoRuntime: DynamoRuntime = { sleep, random: () => Math.random() };

// Sem caracteres ambíguos (0/O, 1/I/L): o código é digitado pelo morador.
const ACCESS_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ACCESS_CODE_LENGTH = 6;

/** Código de convite da casa (`^[A-Z0-9]{4,16}$`), de `crypto`. */
export function newAccessCode(): string {
  return Array.from({ length: ACCESS_CODE_LENGTH }, () => ACCESS_CODE_ALPHABET[randomInt(ACCESS_CODE_ALPHABET.length)]).join("");
}

/** O `fetch` global do Node, que já satisfaz `HttpFetch`. */
export const http: HttpFetch = (url, init) => fetch(url, init);

/** `DynamoClient` ligado a `tableName`. A região e as credenciais vêm do ambiente da Lambda (ou do perfil local). */
export function dynamoClient(tableName: string): SdkDynamoClient {
  const document = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { convertEmptyValues: false, removeUndefinedValues: false, convertClassInstanceToMap: false },
    unmarshallOptions: { wrapNumbers: false },
  });
  return new SdkDynamoClient({ document, tableName, sleep });
}

/** Leitor do segredo `SECRET_ID` (cache por instância). */
export function secretReader(env: Environment): SecretStringReader {
  return new SecretStringReader({ client: new SdkSecretsManagerClient(new SecretsManagerClient({})), secretID: env["SECRET_ID"] });
}

/**
 * Monta o handler na primeira invocação e o reaproveita nas seguintes. Se a montagem falhar (segredo ainda sem
 * valor, por exemplo), a invocação falha e a próxima tenta de novo.
 */
export function lazyHandler<R>(build: () => Promise<(event: unknown) => Promise<R>>): (event: unknown) => Promise<R> {
  let pending: Promise<(event: unknown) => Promise<R>> | null = null;
  return async (event) => {
    if (pending === null) {
      const attempt = build();
      pending = attempt;
      attempt.catch(() => {
        if (pending === attempt) pending = null;
      });
    }
    const handler = await pending;
    return handler(event);
  };
}
