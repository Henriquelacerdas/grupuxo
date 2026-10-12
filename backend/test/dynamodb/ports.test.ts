import assert from "node:assert/strict";
import { test } from "node:test";
import { DynamoPendingActionStore } from "../../src/adapters/dynamodb/pending-action-store.ts";
import { DynamoRateCounter } from "../../src/adapters/dynamodb/rate-counter.ts";
import { DynamoUserDirectory } from "../../src/adapters/dynamodb/user-directory.ts";
import { DynamoInboxStore, DynamoLinkTokenStore, DynamoWhatsAppLinkStore } from "../../src/adapters/dynamodb/whatsapp-stores.ts";
import { DynamoStoreError } from "../../src/adapters/dynamodb/errors.ts";
import { taskOccurrenceID, userID } from "../../src/domain/ids.ts";
import { WhatsAppLinkError } from "../../src/whatsapp/ports.ts";
import { pendingActionStoreContract } from "../contract/pending-actions.ts";
import { rateCounterContract } from "../contract/rate-counter.ts";
import { inboxStoreContract, linkTokenStoreContract, whatsAppLinkStoreContract } from "../contract/stores.ts";
import { cognitoSub, userDirectoryContract } from "../contract/user-directory.ts";
import { sequentialIDs } from "../support/state-json.ts";
import { FakeDynamoClient } from "../support/fake-dynamo-client.ts";
import { uuid } from "../support/world.ts";

const NOW = 1_700_000_000_000;
const RETENTION = 3_600;

// Os mesmos contratos dos adaptadores em memória, agora contra o DynamoDB (cliente falso), incluindo os concorrentes.
inboxStoreContract("DynamoDB", () => new DynamoInboxStore({ client: new FakeDynamoClient(), retentionSeconds: RETENTION }));
whatsAppLinkStoreContract("DynamoDB", () => new DynamoWhatsAppLinkStore({ client: new FakeDynamoClient() }));
linkTokenStoreContract("DynamoDB", () => new DynamoLinkTokenStore({ client: new FakeDynamoClient(), graceSeconds: 60 }));
rateCounterContract("DynamoDB", () => new DynamoRateCounter({ client: new FakeDynamoClient(), retentionSeconds: RETENTION }));
pendingActionStoreContract("DynamoDB", () => new DynamoPendingActionStore({ client: new FakeDynamoClient(), graceSeconds: 60 }));
userDirectoryContract("DynamoDB", () => new DynamoUserDirectory({ client: new FakeDynamoClient(), newID: sequentialIDs(), now: () => NOW }));

const ana = userID(uuid(1));
const bia = userID(uuid(2));
const link = (user: typeof ana, phoneE164: string) => ({ userID: user, phoneE164, consentedAt: NOW, linkedAt: NOW });

test("DynamoDB: caixa de entrada guarda só horários e ttl (em segundos), nunca texto", async () => {
  const client = new FakeDynamoClient();
  const inbox = new DynamoInboxStore({ client, retentionSeconds: RETENTION });
  await inbox.claim("wamid.1", NOW);
  assert.deepEqual(client.peek({ PK: "WAMID#wamid.1", SK: "INBOX" }), {
    PK: "WAMID#wamid.1", SK: "INBOX", receivedAt: NOW, ttl: NOW / 1000 + RETENTION,
  });
  await inbox.markProcessed("wamid.1", NOW + 5_000);
  assert.equal(client.peek({ PK: "WAMID#wamid.1", SK: "INBOX" })?.["processedAt"], NOW + 5_000);
});

test("DynamoDB: reivindicar de novo uma mensagem não concluída preserva o estado de duplicada depois de processada", async () => {
  const client = new FakeDynamoClient();
  const inbox = new DynamoInboxStore({ client, retentionSeconds: RETENTION });
  assert.equal(await inbox.claim("w", NOW), "claimed");
  await inbox.markProcessed("w", NOW);
  assert.equal(client.peek({ PK: "WAMID#w", SK: "INBOX" })?.["processedAt"], NOW);
  assert.equal(await inbox.claim("w", NOW + 1), "duplicate");
  assert.equal(client.peek({ PK: "WAMID#w", SK: "INBOX" })?.["receivedAt"], NOW);
});

test("DynamoDB: o vínculo grava os dois itens e desvincular apaga os dois", async () => {
  const client = new FakeDynamoClient();
  const store = new DynamoWhatsAppLinkStore({ client });
  await store.create(link(ana, "+5511999998888"));
  assert.notEqual(client.peek({ PK: "PHONE#+5511999998888", SK: "LINK" }), undefined);
  assert.notEqual(client.peek({ PK: `USER#${ana}`, SK: "WHATSAPP" }), undefined);
  await store.remove(ana);
  assert.equal(client.snapshot().length, 0);
});

test("DynamoDB: se número e morador já estiverem vinculados, vale o erro do número", async () => {
  const store = new DynamoWhatsAppLinkStore({ client: new FakeDynamoClient() });
  await store.create(link(ana, "+5511999998888"));
  await assert.rejects(store.create(link(ana, "+5511999998888")), (error: unknown) => error instanceof WhatsAppLinkError && error.code === "phoneAlreadyLinked");
});

test("DynamoDB: número fora do formato E.164 não é gravado", async () => {
  const client = new FakeDynamoClient();
  const store = new DynamoWhatsAppLinkStore({ client });
  for (const phone of ["5511999998888", "+0511999998888", "+55", "+55 11 99999"]) {
    await assert.rejects(store.create(link(ana, phone)), (error: unknown) => error instanceof DynamoStoreError && error.code === "invalidItem");
  }
  assert.equal(client.writes, 0);
});

test("DynamoDB: remover não apaga o número que passou a ser de outro morador", async () => {
  const client = new FakeDynamoClient();
  const store = new DynamoWhatsAppLinkStore({ client });
  await store.create(link(ana, "+5511999998888"));
  // Um remove concorrente já apagou o vínculo de Ana e Bia vinculou o mesmo número antes de este remove gravar.
  client.beforeTransact = async () => {
    client.beforeTransact = undefined;
    await store.remove(ana);
    await store.create(link(bia, "+5511999998888"));
  };
  await store.remove(ana);
  assert.equal(await store.linkForUser(ana), null);
  assert.deepEqual(await store.linkForPhone("+5511999998888"), link(bia, "+5511999998888"));
  assert.deepEqual(await store.linkForUser(bia), link(bia, "+5511999998888"));
});

test("DynamoDB: o token guarda o ttl depois de expiresAt e só o hash", async () => {
  const client = new FakeDynamoClient();
  const store = new DynamoLinkTokenStore({ client, graceSeconds: 120 });
  await store.save({ tokenHash: "h", userID: ana, expiresAt: NOW + 900_000 });
  assert.deepEqual(client.peek({ PK: "LINKTOKEN#h", SK: "LINKTOKEN" }), {
    PK: "LINKTOKEN#h", SK: "LINKTOKEN", userID: ana, expiresAt: NOW + 900_000, ttl: (NOW + 900_000) / 1000 + 120,
  });
  assert.equal(await store.consume("h", NOW), ana);
  assert.equal(client.peek({ PK: "LINKTOKEN#h", SK: "LINKTOKEN" })?.["usedAt"], NOW);
});

test("DynamoDB: a validade do token é decidida pela condição, não pela presença do item (ttl atrasado)", async () => {
  const client = new FakeDynamoClient();
  const store = new DynamoLinkTokenStore({ client, graceSeconds: 120 });
  await store.save({ tokenHash: "h", userID: ana, expiresAt: NOW + 1_000 });
  assert.equal(await store.consume("h", NOW + 1_000), null);
  assert.equal(await store.consume("h", NOW + 5_000), null);
});

test("DynamoDB: o contador guarda a janela na chave e o ttl a partir dela", async () => {
  const client = new FakeDynamoClient();
  const counter = new DynamoRateCounter({ client, retentionSeconds: 300 });
  await counter.increment("+5511999998888", NOW);
  assert.deepEqual(client.peek({ PK: "RATE#+5511999998888", SK: String(NOW) }), {
    PK: "RATE#+5511999998888", SK: String(NOW), count: 1, ttl: NOW / 1000 + 300,
  });
});

test("DynamoDB: o pedido pendente guarda só ID e horários, e salvar zera a confirmação", async () => {
  const client = new FakeDynamoClient();
  const store = new DynamoPendingActionStore({ client, graceSeconds: 60 });
  const pending = { userID: ana, occurrenceID: taskOccurrenceID(uuid(100)), createdAt: NOW, expiresAt: NOW + 300_000, confirmedByWamid: null };
  await store.save(pending);
  assert.deepEqual(Object.keys(client.peek({ PK: `PENDING#${ana}`, SK: "COMPLETE" }) ?? {}).sort(), [
    "PK", "SK", "createdAt", "expiresAt", "occurrenceID", "ttl", "userID",
  ]);
  await store.confirm(ana, "wamid.1", NOW);
  await store.save(pending);
  assert.equal(client.peek({ PK: `PENDING#${ana}`, SK: "COMPLETE" })?.["confirmedByWamid"], undefined);
});


test("DynamoDB: ensureUser grava a unicidade do Cognito e o perfil juntos", async () => {
  const client = new FakeDynamoClient();
  const directory = new DynamoUserDirectory({ client, newID: sequentialIDs(), now: () => NOW });
  const sub = cognitoSub("11111111-1111-4111-8111-111111111111");
  const id = await directory.ensureUser(sub, { name: "Ana" });
  assert.deepEqual(client.peek({ PK: `COGNITO#${sub}`, SK: "COGNITO" }), { PK: `COGNITO#${sub}`, SK: "COGNITO", userID: id });
  assert.deepEqual(client.peek({ PK: `USER#${id}`, SK: "PROFILE" }), {
    PK: `USER#${id}`, SK: "PROFILE", name: "Ana", email: null, cognitoSub: sub, createdAt: NOW,
  });
  const writes = client.writes;
  await directory.ensureUser(sub, { name: "Ana" });
  assert.equal(client.writes, writes);
});
