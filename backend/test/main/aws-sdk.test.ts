import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoConditionFailedError, DynamoTransactionCanceledError } from "../../src/adapters/dynamodb/client.ts";
import {
  SdkDynamoClient, SdkSecretsManagerClient, SdkSqsClient, UnsupportedDynamoValueError,
} from "../../src/main/aws-sdk.ts";

// O SDK real até a camada HTTP, que é falsa: confere o formato de fio (JSON 1.0 com `AttributeValue`), a tradução
// de saída e de erros. Nenhuma rede.

interface Sent {
  readonly target: string;
  readonly body: Record<string, unknown>;
}

type Reply = { readonly status: number; readonly payload: unknown };

function fakeHandler(reply: (target: string, body: Record<string, unknown>) => Reply) {
  const sent: Sent[] = [];
  const handler = {
    async handle(request: { headers: Record<string, string>; body: unknown }) {
      const text = request.body instanceof Uint8Array ? new TextDecoder().decode(request.body) : String(request.body);
      const target = request.headers["x-amz-target"] ?? "";
      const parsed: unknown = JSON.parse(text);
      assert.ok(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed));
      const body = Object.fromEntries(Object.entries(parsed));
      sent.push({ target, body });
      const { status, payload } = reply(target, body);
      return {
        response: {
          statusCode: status, headers: { "content-type": "application/x-amz-json-1.0" },
          body: new TextEncoder().encode(JSON.stringify(payload)),
        },
      };
    },
    updateHttpClientConfig() {},
    httpHandlerConfigs() {
      return {};
    },
  };
  return { sent, handler };
}

const credentials = { accessKeyId: "AKIDTESTE", secretAccessKey: "segredo-de-teste" };

function dynamo(reply: (target: string, body: Record<string, unknown>) => Reply) {
  const { sent, handler } = fakeHandler(reply);
  const base = new DynamoDBClient({ region: "us-east-1", credentials, requestHandler: handler, maxAttempts: 1 });
  const sleeps: number[] = [];
  const client = new SdkDynamoClient({
    document: DynamoDBDocumentClient.from(base), tableName: "grupuxo-dev", sleep: async (ms) => { sleeps.push(ms); },
  });
  return { client, sent, sleeps };
}

const ok = (payload: unknown): Reply => ({ status: 200, payload });
const awsError = (type: string, extra: Record<string, unknown> = {}): Reply => ({
  status: 400, payload: { __type: `com.amazonaws.dynamodb.v20120810#${type}`, message: "detalhe", ...extra },
});

test("get: chave e leitura consistente no fio; item volta como JSON puro", async () => {
  const { client, sent } = dynamo(() => ok({ Item: { PK: { S: "USER#1" }, n: { N: "3" }, l: { L: [{ NULL: true }, { BOOL: true }] }, m: { M: { a: { S: "x" } } } } }));
  const item = await client.get({ key: { PK: "USER#1", SK: "PROFILE" }, consistentRead: true });
  assert.deepEqual(item, { PK: "USER#1", n: 3, l: [null, true], m: { a: "x" } });
  assert.equal(sent[0]?.target, "DynamoDB_20120810.GetItem");
  assert.deepEqual(sent[0]?.body, { TableName: "grupuxo-dev", Key: { PK: { S: "USER#1" }, SK: { S: "PROFILE" } }, ConsistentRead: true });
});

test("get: item ausente é undefined", async () => {
  const { client } = dynamo(() => ok({}));
  assert.equal(await client.get({ key: { PK: "A", SK: "B" }, consistentRead: false }), undefined);
});

test("query: índice, expressões, página seguinte e lastKey", async () => {
  const { client, sent } = dynamo(() => ok({ Items: [{ PK: { S: "a" } }], LastEvaluatedKey: { PK: { S: "a" }, SK: { S: "b" } } }));
  const page = await client.query({
    indexName: "GSI1", keyCondition: "#pk = :pk", names: { "#pk": "GSI1PK" }, values: { ":pk": "USER#1" },
    consistentRead: false, scanForward: false, startKey: { PK: "z", SK: "y" },
  });
  assert.deepEqual(page, { items: [{ PK: "a" }], lastKey: { PK: "a", SK: "b" } });
  assert.deepEqual(sent[0]?.body, {
    TableName: "grupuxo-dev", IndexName: "GSI1", KeyConditionExpression: "#pk = :pk", ConsistentRead: false,
    ScanIndexForward: false, ExclusiveStartKey: { PK: { S: "z" }, SK: { S: "y" } },
    ExpressionAttributeNames: { "#pk": "GSI1PK" }, ExpressionAttributeValues: { ":pk": { S: "USER#1" } },
  });
});

test("query: sem nomes nem valores, os mapas não vão no pedido; última página sem lastKey", async () => {
  const { client, sent } = dynamo(() => ok({ Items: [] }));
  assert.deepEqual(await client.query({ keyCondition: "PK = :x", values: {}, consistentRead: true, scanForward: true }), { items: [] });
  assert.ok(!("ExpressionAttributeValues" in (sent[0]?.body ?? {})));
  assert.ok(!("ExpressionAttributeNames" in (sent[0]?.body ?? {})));
});

test("put condicional que falha vira DynamoConditionFailedError", async () => {
  const { client, sent } = dynamo(() => awsError("ConditionalCheckFailedException"));
  await assert.rejects(
    client.put({ item: { PK: "a", SK: "b", x: null, list: [1, "s"] }, condition: "attribute_not_exists(PK)" }),
    DynamoConditionFailedError,
  );
  assert.deepEqual(sent[0]?.body, {
    TableName: "grupuxo-dev", Item: { PK: { S: "a" }, SK: { S: "b" }, x: { NULL: true }, list: { L: [{ N: "1" }, { S: "s" }] } },
    ConditionExpression: "attribute_not_exists(PK)",
  });
});

test("update devolve os atributos; delete condicional traduz a condição", async () => {
  const { client } = dynamo((target) => target.endsWith("UpdateItem") ? ok({ Attributes: { count: { N: "2" } } }) : awsError("ConditionalCheckFailedException"));
  assert.deepEqual(await client.update({ key: { PK: "R", SK: "1" }, update: "ADD #c :one", names: { "#c": "count" }, values: { ":one": 1 }, returnValues: "UPDATED_NEW" }), { count: 2 });
  await assert.rejects(client.delete({ key: { PK: "R", SK: "1" }, condition: "attribute_exists(PK)" }), DynamoConditionFailedError);
});

test("outros erros do SDK propagam sem tradução", async () => {
  const { client } = dynamo(() => awsError("ValidationException"));
  await assert.rejects(client.put({ item: { PK: "a", SK: "b" } }), (error: unknown) => error instanceof Error && error.name === "ValidationException");
});

test("transactWrite cancelada: um motivo por ação, na ordem", async () => {
  const { client, sent } = dynamo(() => awsError("TransactionCanceledException", {
    CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed", Message: "x" }, { Code: "TransactionConflict" }],
  }));
  await assert.rejects(
    client.transactWrite([
      { kind: "put", item: { PK: "H", SK: "META" }, condition: "#v = :v", names: { "#v": "version" }, values: { ":v": 1 } },
      { kind: "delete", key: { PK: "H", SK: "OCC#1" } },
      { kind: "update", key: { PK: "H", SK: "X" }, update: "SET a = :a", values: { ":a": "b" } },
    ]),
    (error: unknown) => error instanceof DynamoTransactionCanceledError
      && JSON.stringify(error.reasons) === JSON.stringify(["Other", "ConditionalCheckFailed", "Other"]),
  );
  const items = sent[0]?.body["TransactItems"];
  assert.ok(Array.isArray(items) && items.length === 3);
  assert.deepEqual(items[1], { Delete: { TableName: "grupuxo-dev", Key: { PK: { S: "H" }, SK: { S: "OCC#1" } } } });
});

test("batchGet repete as chaves não processadas, com espera", async () => {
  let round = 0;
  const { client, sent, sleeps } = dynamo(() => {
    round += 1;
    return round === 1
      ? ok({ Responses: { "grupuxo-dev": [{ PK: { S: "A" }, SK: { S: "1" } }] }, UnprocessedKeys: { "grupuxo-dev": { Keys: [{ PK: { S: "B" }, SK: { S: "1" } }] } } })
      : ok({ Responses: { "grupuxo-dev": [{ PK: { S: "B" }, SK: { S: "1" } }] } });
  });
  const items = await client.batchGet([{ PK: "A", SK: "1" }, { PK: "B", SK: "1" }]);
  assert.deepEqual(items, [{ PK: "A", SK: "1" }, { PK: "B", SK: "1" }]);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1]?.body, { RequestItems: { "grupuxo-dev": { Keys: [{ PK: { S: "B" }, SK: { S: "1" } }], ConsistentRead: true } } });
  assert.equal(sleeps.length, 1);
});

test("valor em formato não suportado (conjunto) falha fechado", async () => {
  const { client } = dynamo(() => ok({ Item: { PK: { S: "a" }, tags: { SS: ["x"] } } }));
  await assert.rejects(client.get({ key: { PK: "a", SK: "b" }, consistentRead: true }), UnsupportedDynamoValueError);
});

test("SQS: fila, corpo, grupo e deduplicação no fio", async () => {
  // O SDK confere o MD5 do corpo devolvido pela fila.
  const { sent, handler } = fakeHandler((_, body) => ok({ MessageId: "m1", MD5OfMessageBody: createHash("md5").update(String(body["MessageBody"])).digest("hex") }));
  const sqs = new SdkSqsClient(new SQSClient({ region: "us-east-1", credentials, requestHandler: handler, maxAttempts: 1 }));
  await sqs.sendMessage({ queueURL: "https://sqs.us-east-1.amazonaws.com/123456789012/grupuxo-dev-whatsapp.fifo", body: "{}", messageGroupID: "+5511", messageDeduplicationID: "wamid.1" });
  assert.equal(sent[0]?.body["QueueUrl"], "https://sqs.us-east-1.amazonaws.com/123456789012/grupuxo-dev-whatsapp.fifo");
  assert.equal(sent[0]?.body["MessageGroupId"], "+5511");
  assert.equal(sent[0]?.body["MessageDeduplicationId"], "wamid.1");
});

test("Secrets Manager: devolve o SecretString", async () => {
  const { sent, handler } = fakeHandler(() => ok({ SecretString: "{\"a\":\"b\"}" }));
  const secrets = new SdkSecretsManagerClient(new SecretsManagerClient({ region: "us-east-1", credentials, requestHandler: handler, maxAttempts: 1 }));
  assert.equal(await secrets.getSecretString("grupuxo/whatsapp"), "{\"a\":\"b\"}");
  assert.deepEqual(sent[0]?.body, { SecretId: "grupuxo/whatsapp" });
});
