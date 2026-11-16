import type { DynamoItem, DynamoValue } from "../adapters/dynamodb/client.ts";
import { decodeNotification } from "../adapters/dynamodb/codec.ts";
import { SK_PREFIX } from "../adapters/dynamodb/keys.ts";
import { isRecord } from "../adapters/dynamodb/reader.ts";
import type { PushNotifier } from "../push/notifier.ts";

// Lambda `push` (gatilho: DynamoDB Streams da tabela, só INSERT de `NOTIF#`). Cada aviso novo vira um push para os
// aparelhos de quem o recebe, respeitando as preferências. Falha de um registro não derruba o lote: o registro volta
// em `batchItemFailures` para nova tentativa. Nada de conteúdo em log.

/** Valor no formato de atributo do DynamoDB Streams (`{ S }`, `{ N }`, `{ NULL }`, `{ BOOL }`, `{ L }`, `{ M }`). */
function unmarshal(value: unknown): DynamoValue {
  if (!isPlain(value)) throw new Error("streamValue");
  if (typeof value["S"] === "string") return value["S"];
  if (typeof value["N"] === "string") return Number(value["N"]);
  if (value["NULL"] === true) return null;
  if (typeof value["BOOL"] === "boolean") return value["BOOL"];
  const list = value["L"];
  if (Array.isArray(list)) return list.map((entry: unknown) => unmarshal(entry));
  const map = value["M"];
  if (isPlain(map)) return Object.fromEntries(Object.entries(map).map(([key, entry]) => [key, unmarshal(entry)]));
  throw new Error("streamValue");
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** O item novo de um registro de INSERT em `NOTIF#…`, ou `null` para qualquer outro registro. */
export function newNotificationItem(record: unknown): DynamoItem | null {
  if (!isPlain(record) || record["eventName"] !== "INSERT") return null;
  const dynamodb = record["dynamodb"];
  const image = isPlain(dynamodb) ? dynamodb["NewImage"] : undefined;
  if (!isPlain(image)) return null;
  const item = unmarshal({ M: image });
  if (!isRecord(item)) return null;
  const sk = item["SK"];
  return typeof sk === "string" && sk.startsWith(SK_PREFIX.notification) ? item : null;
}

export interface PushBatchResponse {
  readonly batchItemFailures: readonly { readonly itemIdentifier: string }[];
}

export function createPushHandler(notifier: PushNotifier, onFailure: (description: string) => void): (event: unknown) => Promise<PushBatchResponse> {
  return async (event) => {
    const records = isPlain(event) && Array.isArray(event["Records"]) ? (event["Records"] as unknown[]) : [];
    const failures: { itemIdentifier: string }[] = [];
    for (const record of records) {
      try {
        const item = newNotificationItem(record);
        if (item === null) continue;
        await notifier.deliver(decodeNotification(item));
      } catch (error) {
        const dynamodb = isPlain(record) ? record["dynamodb"] : undefined;
        const sequence = isPlain(dynamodb) ? dynamodb["SequenceNumber"] : undefined;
        if (typeof sequence === "string") failures.push({ itemIdentifier: sequence });
        onFailure(error instanceof Error ? error.name : "erro");
      }
    }
    return { batchItemFailures: failures };
  };
}
