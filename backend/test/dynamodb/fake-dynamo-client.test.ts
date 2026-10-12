import assert from "node:assert/strict";
import { test } from "node:test";
import { DynamoConditionFailedError, DynamoTransactionCanceledError, queryAll } from "../../src/adapters/dynamodb/client.ts";
import { FakeDynamoClient } from "../support/fake-dynamo-client.ts";

// O fake sustenta todos os testes do adaptador DynamoDB: estes testes garantem que ele não esconde bug
// (condições, atualizações, índice, paginação e atomicidade se comportam como o DynamoDB).

const item = (PK: string, SK: string, extra: Record<string, string | number> = {}) => ({ PK, SK, ...extra });

test("put condicional: attribute_not_exists impede sobrescrever", async () => {
  const client = new FakeDynamoClient();
  await client.put({ item: item("A", "1", { v: 1 }), condition: "attribute_not_exists(PK)" });
  await assert.rejects(client.put({ item: item("A", "1", { v: 2 }), condition: "attribute_not_exists(PK)" }), DynamoConditionFailedError);
  assert.equal(client.peek({ PK: "A", SK: "1" })?.["v"], 1);
});

test("condições com AND, OR, parênteses, nomes e comparações", async () => {
  const client = new FakeDynamoClient();
  await client.put({ item: item("A", "1", { n: 5, s: "x" }) });
  const ok = (condition: string, values: Record<string, string | number> = {}) =>
    client.put({ item: item("A", "1", { n: 5, s: "x" }), condition, names: { "#n": "n", "#s": "s", "#z": "z" }, values });
  await ok("#n > :low AND #n <= :high", { ":low": 4, ":high": 5 });
  await ok("attribute_not_exists(#z) OR #n = :other", { ":other": 9 });
  await ok("attribute_exists(PK) AND (#s = :x OR #n = :nope)", { ":x": "x", ":nope": 0 });
  await assert.rejects(ok("#n < :low", { ":low": 5 }), DynamoConditionFailedError);
  await assert.rejects(ok("attribute_exists(#z)"), DynamoConditionFailedError);
  await assert.rejects(ok("attribute_not_exists(PK) OR #n = :nope", { ":nope": 1 }), DynamoConditionFailedError);
});

test("update: SET, aritmética, ADD em atributo ausente, retorno e upsert", async () => {
  const client = new FakeDynamoClient();
  const first = await client.update({
    key: { PK: "C", SK: "1" }, update: "SET #ttl = :ttl ADD #count :one", names: { "#ttl": "ttl", "#count": "count" },
    values: { ":ttl": 10, ":one": 1 }, returnValues: "UPDATED_NEW",
  });
  assert.deepEqual(first, { ttl: 10, count: 1 });
  const second = await client.update({
    key: { PK: "C", SK: "1" }, update: "SET #v = #v + :one", names: { "#v": "count" }, values: { ":one": 4 }, returnValues: "ALL_NEW",
  });
  assert.deepEqual(second, { PK: "C", SK: "1", ttl: 10, count: 5 });
  await assert.rejects(
    client.update({ key: { PK: "nada", SK: "1" }, update: "SET a = :v", condition: "attribute_exists(PK)", values: { ":v": 1 }, returnValues: "ALL_NEW" }),
    DynamoConditionFailedError,
  );
  assert.equal(client.peek({ PK: "nada", SK: "1" }), undefined);
});

test("query: begins_with, ordem, paginação completa e índice esparso", async () => {
  const client = new FakeDynamoClient({ pageSize: 2 });
  for (const n of [3, 1, 2, 5, 4]) await client.put({ item: item("H", `ROOM#${n}`) });
  await client.put({ item: item("H", "META") });
  await client.put({ item: item("G", "x", { GSI1PK: "U#1", GSI1SK: "NOTIF#2" }) });
  await client.put({ item: item("G", "y", { GSI1PK: "U#1", GSI1SK: "NOTIF#1" }) });
  await client.put({ item: item("G", "z", { GSI1PK: "U#2", GSI1SK: "NOTIF#9" }) });
  const rooms = await queryAll(client, {
    keyCondition: "#pk = :pk AND begins_with(#sk, :p)", names: { "#pk": "PK", "#sk": "SK" },
    values: { ":pk": "H", ":p": "ROOM#" }, consistentRead: true, scanForward: true,
  });
  assert.deepEqual(rooms.map((r) => r["SK"]), ["ROOM#1", "ROOM#2", "ROOM#3", "ROOM#4", "ROOM#5"]);
  const page = await client.query({
    keyCondition: "#pk = :pk", names: { "#pk": "PK" }, values: { ":pk": "H" }, consistentRead: true, scanForward: true,
  });
  assert.equal(page.items.length, 2);
  assert.notEqual(page.lastKey, undefined);
  const notifications = await queryAll(client, {
    indexName: "GSI1", keyCondition: "#pk = :pk", names: { "#pk": "GSI1PK" }, values: { ":pk": "U#1" }, consistentRead: false, scanForward: false,
  });
  assert.deepEqual(notifications.map((n) => n["SK"]), ["x", "y"]);
});

test("transactWrite: tudo ou nada, com o motivo de cada ação", async () => {
  const client = new FakeDynamoClient();
  await client.put({ item: item("A", "1", { v: 1 }) });
  await assert.rejects(
    client.transactWrite([
      { kind: "put", item: item("B", "1"), condition: "attribute_not_exists(PK)" },
      { kind: "put", item: item("A", "1", { v: 2 }), condition: "attribute_not_exists(PK)" },
    ]),
    (error: unknown) => error instanceof DynamoTransactionCanceledError && error.reasons[0] === "Other" && error.reasons[1] === "ConditionalCheckFailed",
  );
  assert.equal(client.peek({ PK: "B", SK: "1" }), undefined);
  await client.transactWrite([
    { kind: "put", item: item("B", "1") },
    { kind: "delete", key: { PK: "A", SK: "1" } },
    { kind: "update", key: { PK: "C", SK: "1" }, update: "ADD #n :one", names: { "#n": "n" }, values: { ":one": 1 } },
  ]);
  assert.equal(client.peek({ PK: "A", SK: "1" }), undefined);
  assert.equal(client.peek({ PK: "C", SK: "1" })?.["n"], 1);
});

test("limites e validações: 100 ações, 100 chaves, undefined, item repetido", async () => {
  const client = new FakeDynamoClient();
  const many = Array.from({ length: 101 }, (_, n) => ({ kind: "put" as const, item: item("A", String(n)) }));
  await assert.rejects(client.transactWrite(many), /número de ações/);
  await assert.rejects(client.batchGet(Array.from({ length: 101 }, (_, n) => ({ PK: "A", SK: String(n) }))), /batchGet/);
  await assert.rejects(client.put({ item: { PK: "A", SK: "1", bad: undefined as unknown as string } }), /undefined/);
  await assert.rejects(client.transactWrite([{ kind: "put", item: item("A", "1") }, { kind: "put", item: item("A", "1") }]), /mesmo item/);
  assert.equal(client.snapshot().length, 0);
});
