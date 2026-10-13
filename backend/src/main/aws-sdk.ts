import { GetSecretValueCommand, type SecretsManagerClient as SdkSecretsManager } from "@aws-sdk/client-secrets-manager";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import {
  BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import type { SecretsManagerClient, SqsClient, SqsSendMessageInput } from "../adapters/aws/clients.ts";
import {
  DynamoConditionFailedError, DynamoTransactionCanceledError, MAX_BATCH_GET_KEYS, MAX_TRANSACT_ACTIONS,
  type DynamoCancellationReason, type DynamoClient, type DynamoDeleteInput, type DynamoGetInput, type DynamoItem,
  type DynamoKey, type DynamoPutInput, type DynamoQueryInput, type DynamoQueryOutput, type DynamoTransactAction,
  type DynamoUpdateInput, type DynamoValue, type ExpressionAttributes,
} from "../adapters/dynamodb/client.ts";

// Os clientes mínimos de `adapters/` sobre o AWS SDK v3 (que já vem no runtime Node 22 da Lambda; no bundle fica
// externo). Só traduz formatos e erros: nenhuma regra. Saída do SDK é dado externo e é estreitada à mão.

/** Valor que o SDK devolveu e o adaptador não sabe representar (conjunto, binário, `bigint`...). */
export class UnsupportedDynamoValueError extends Error {
  constructor() {
    super("Valor do DynamoDB em formato não suportado");
    this.name = "UnsupportedDynamoValueError";
  }
}

function toValue(value: unknown): DynamoValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toValue);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return toItem(value);
  throw new UnsupportedDynamoValueError();
}

export function toItem(value: unknown): DynamoItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new UnsupportedDynamoValueError();
  const item: Record<string, DynamoValue> = {};
  for (const [name, attribute] of Object.entries(value)) {
    if (attribute !== undefined) item[name] = toValue(attribute);
  }
  return item;
}

function toItems(value: unknown): DynamoItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new UnsupportedDynamoValueError();
  return value.map(toItem);
}

/** Nomes e valores só quando existem: o DynamoDB recusa mapas vazios. */
function expressionAttributes(input: ExpressionAttributes): {
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, DynamoValue>;
} {
  return {
    ...(input.names !== undefined && Object.keys(input.names).length > 0 ? { ExpressionAttributeNames: { ...input.names } } : {}),
    ...(input.values !== undefined && Object.keys(input.values).length > 0 ? { ExpressionAttributeValues: { ...input.values } } : {}),
  };
}

function condition(expression: string | undefined): { ConditionExpression?: string } {
  return expression === undefined ? {} : { ConditionExpression: expression };
}

function errorName(error: unknown): string | null {
  return error instanceof Error ? error.name : null;
}

function cancellationReasons(error: unknown, count: number): DynamoCancellationReason[] {
  const raw: unknown = typeof error === "object" && error !== null && "CancellationReasons" in error ? error.CancellationReasons : undefined;
  const reasons = Array.isArray(raw)
    ? raw.map((reason: unknown): DynamoCancellationReason =>
      typeof reason === "object" && reason !== null && "Code" in reason && reason.Code === "ConditionalCheckFailed"
        ? "ConditionalCheckFailed" : "Other")
    : [];
  // Um motivo por ação, na ordem (contrato de `DynamoClient`): sem a lista, nenhuma ação é dada como condição.
  return Array.from({ length: count }, (_, index) => reasons[index] ?? "Other");
}

async function translateCondition<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (errorName(error) === "ConditionalCheckFailedException") throw new DynamoConditionFailedError();
    throw error;
  }
}

export interface SdkDynamoClientOptions {
  readonly document: Pick<DynamoDBDocumentClient, "send">;
  readonly tableName: string;
  /** Espera entre as repetições de `UnprocessedKeys` do `batchGet`. */
  readonly sleep: (milliseconds: number) => Promise<void>;
}

const MAX_BATCH_GET_ROUNDS = 8;

/** `DynamoClient` ligado a uma tabela, sobre o `DynamoDBDocumentClient`. */
export class SdkDynamoClient implements DynamoClient {
  private readonly document: Pick<DynamoDBDocumentClient, "send">;
  private readonly tableName: string;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: SdkDynamoClientOptions) {
    if (options.tableName === "") throw new Error("TABLE_NAME vazio");
    this.document = options.document;
    this.tableName = options.tableName;
    this.sleep = options.sleep;
  }

  async get(input: DynamoGetInput): Promise<DynamoItem | undefined> {
    const output = await this.document.send(new GetCommand({
      TableName: this.tableName, Key: { ...input.key }, ConsistentRead: input.consistentRead,
    }));
    return output.Item === undefined ? undefined : toItem(output.Item);
  }

  async query(input: DynamoQueryInput): Promise<DynamoQueryOutput> {
    const output = await this.document.send(new QueryCommand({
      TableName: this.tableName,
      ...(input.indexName === undefined ? {} : { IndexName: input.indexName }),
      KeyConditionExpression: input.keyCondition,
      ConsistentRead: input.consistentRead,
      ScanIndexForward: input.scanForward,
      ...(input.startKey === undefined ? {} : { ExclusiveStartKey: { ...input.startKey } }),
      ...expressionAttributes(input),
    }));
    const items = toItems(output.Items);
    return output.LastEvaluatedKey === undefined ? { items } : { items, lastKey: toItem(output.LastEvaluatedKey) };
  }

  async put(input: DynamoPutInput): Promise<void> {
    await translateCondition(() => this.document.send(new PutCommand({
      TableName: this.tableName, Item: { ...input.item }, ...condition(input.condition), ...expressionAttributes(input),
    })));
  }

  async update(input: DynamoUpdateInput): Promise<DynamoItem> {
    const output = await translateCondition(() => this.document.send(new UpdateCommand({
      TableName: this.tableName, Key: { ...input.key }, UpdateExpression: input.update, ReturnValues: input.returnValues,
      ...condition(input.condition), ...expressionAttributes(input),
    })));
    return output.Attributes === undefined ? {} : toItem(output.Attributes);
  }

  async delete(input: DynamoDeleteInput): Promise<void> {
    await translateCondition(() => this.document.send(new DeleteCommand({
      TableName: this.tableName, Key: { ...input.key }, ...condition(input.condition), ...expressionAttributes(input),
    })));
  }

  async batchGet(keys: readonly DynamoKey[]): Promise<readonly DynamoItem[]> {
    if (keys.length > MAX_BATCH_GET_KEYS) throw new RangeError("batchGet acima de 100 chaves");
    const items: DynamoItem[] = [];
    let pending: Record<string, unknown>[] = keys.map((key) => ({ PK: key.PK, SK: key.SK }));
    for (let round = 0; pending.length > 0; round += 1) {
      if (round >= MAX_BATCH_GET_ROUNDS) throw new Error("batchGet: chaves não processadas depois das repetições");
      if (round > 0) await this.sleep(Math.min(1000, 25 * 2 ** round));
      const output = await this.document.send(new BatchGetCommand({
        RequestItems: { [this.tableName]: { Keys: pending, ConsistentRead: true } },
      }));
      items.push(...toItems(output.Responses?.[this.tableName]));
      const unprocessed: unknown = output.UnprocessedKeys?.[this.tableName]?.Keys;
      pending = Array.isArray(unprocessed) ? unprocessed.map(toItem).map((key) => ({ ...key })) : [];
    }
    return items;
  }

  async transactWrite(actions: readonly DynamoTransactAction[]): Promise<void> {
    if (actions.length > MAX_TRANSACT_ACTIONS) throw new RangeError("transactWrite acima de 100 ações");
    if (actions.length === 0) return;
    try {
      await this.document.send(new TransactWriteCommand({ TransactItems: actions.map((action) => this.transactItem(action)) }));
    } catch (error) {
      if (errorName(error) === "TransactionCanceledException") {
        throw new DynamoTransactionCanceledError(cancellationReasons(error, actions.length));
      }
      throw error;
    }
  }

  private transactItem(action: DynamoTransactAction) {
    const TableName = this.tableName;
    switch (action.kind) {
      case "put":
        return { Put: { TableName, Item: { ...action.item }, ...condition(action.condition), ...expressionAttributes(action) } };
      case "delete":
        return { Delete: { TableName, Key: { ...action.key }, ...condition(action.condition), ...expressionAttributes(action) } };
      case "update":
        return {
          Update: {
            TableName, Key: { ...action.key }, UpdateExpression: action.update, ...condition(action.condition),
            ...expressionAttributes(action),
          },
        };
    }
  }
}

/** `SqsClient` sobre o `SQSClient` do SDK. */
export class SdkSqsClient implements SqsClient {
  private readonly sqs: Pick<SQSClient, "send">;

  constructor(sqs: Pick<SQSClient, "send">) {
    this.sqs = sqs;
  }

  async sendMessage(input: SqsSendMessageInput): Promise<void> {
    await this.sqs.send(new SendMessageCommand({
      QueueUrl: input.queueURL, MessageBody: input.body, MessageGroupId: input.messageGroupID,
      MessageDeduplicationId: input.messageDeduplicationID,
    }));
  }
}

/** `SecretsManagerClient` sobre o cliente do SDK. */
export class SdkSecretsManagerClient implements SecretsManagerClient {
  private readonly secrets: Pick<SdkSecretsManager, "send">;

  constructor(secrets: Pick<SdkSecretsManager, "send">) {
    this.secrets = secrets;
  }

  async getSecretString(secretID: string): Promise<string | undefined> {
    const output = await this.secrets.send(new GetSecretValueCommand({ SecretId: secretID }));
    return output.SecretString;
  }
}
