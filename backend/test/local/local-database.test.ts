import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryHouseRepository } from "../../src/adapters/in-memory/repositories.ts";
import { LocalDatabase, LocalDatabaseError } from "../../src/adapters/local/local-database.ts";
import { parseCognitoSub } from "../../src/auth/token-verifier.ts";
import { taskOccurrenceID } from "../../src/domain/ids.ts";
import { inboxStoreContract, linkTokenStoreContract, whatsAppLinkStoreContract } from "../contract/stores.ts";
import { pendingActionStoreContract } from "../contract/pending-actions.ts";
import { rateCounterContract } from "../contract/rate-counter.ts";
import { userDirectoryContract } from "../contract/user-directory.ts";
import { sequentialAccessCodes, sequentialIDs } from "../support/state-json.ts";
import { uuid } from "../support/world.ts";

const NOW = Date.UTC(2026, 9, 14, 12);

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "grupuxo-local-")), "data", "db.json");
}

function open(path = tempPath(), newID = sequentialIDs()): LocalDatabase {
  return LocalDatabase.open({ path, now: () => NOW, newID });
}

// Os adaptadores do banco local passam nos mesmos contratos dos demais.
inboxStoreContract("banco local", () => open().inbox);
whatsAppLinkStoreContract("banco local", () => open().links);
linkTokenStoreContract("banco local", () => open().linkTokens);
rateCounterContract("banco local", () => open().rateCounter);
pendingActionStoreContract("banco local", () => open().pending);
userDirectoryContract("banco local", () => open().users);

test("sem arquivo, o banco começa vazio e só cria o arquivo ao gravar", () => {
  const path = tempPath();
  const db = open(path);
  assert.deepEqual(db.store.snapshot().users, []);
  db.flush();
  assert.throws(() => readFileSync(path));
});

test("tudo o que foi gravado sobrevive a fechar e reabrir", async () => {
  const path = tempPath();
  const newID = sequentialIDs();
  const first = open(path, newID);
  const sub = parseCognitoSub("conta-ana");
  assert.ok(sub !== null);
  const ana = await first.users.ensureUser(sub, { name: "Ana" });
  const houses = new InMemoryHouseRepository(first.store, { now: () => NOW, newID }, sequentialAccessCodes());
  const house = await houses.create(ana, "Casa da Ana", "America/Sao_Paulo", NOW);
  await first.links.create({ userID: ana, phoneE164: "+5511999998888", consentedAt: NOW, linkedAt: NOW });
  await first.inbox.claim("wamid.1", NOW);
  await first.inbox.markProcessed("wamid.1", NOW);
  await first.linkTokens.save({ tokenHash: "h".repeat(64), userID: ana, expiresAt: NOW + 1000 });
  assert.equal(await first.linkTokens.consume("h".repeat(64), NOW), ana);
  await first.rateCounter.increment("+5511999998888", NOW);
  await first.pending.save({ userID: ana, occurrenceID: taskOccurrenceID(uuid(9)), createdAt: NOW, expiresAt: NOW + 1000, confirmedByWamid: null });
  first.flush();

  const second = open(path);
  assert.deepEqual(second.store.snapshot(), first.store.snapshot());
  assert.equal(await second.users.userForSub(sub), ana);
  assert.equal((await second.links.linkForUser(ana))?.phoneE164, "+5511999998888");
  assert.equal(await second.inbox.claim("wamid.1", NOW), "duplicate");
  assert.equal(await second.linkTokens.consume("h".repeat(64), NOW), null, "token já usado continua usado");
  assert.equal(await second.rateCounter.increment("+5511999998888", NOW), 2);
  assert.ok((await second.pending.confirm(ana, "wamid.2", NOW)) !== null);
  assert.equal(second.store.snapshot().houses[0]?.id, house.id);
});

test("uma mudança agenda a gravação sozinha", async () => {
  const path = tempPath();
  const db = open(path);
  await db.inbox.claim("wamid.auto", NOW);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(readFileSync(path, "utf8").includes("wamid.auto"));
});

test("arquivo fora do formato falha fechado, sem recomeçar vazio nem sobrescrever", () => {
  const path = tempPath();
  mkdirSync(join(path, ".."), { recursive: true });
  for (const content of ["não é json", "[]", JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, state: { users: "x" } })]) {
    writeFileSync(path, content);
    assert.throws(() => open(path), LocalDatabaseError);
    assert.equal(readFileSync(path, "utf8"), content);
  }
  writeFileSync(path, JSON.stringify({
    version: 1, state: { users: [], houses: [], taskSwapRequests: [], notifications: [], rooms: [], houseMemberships: [], roomMemberships: [], definitions: [], occurrences: [], assignments: [], absences: [] },
    users: [["conta", "não-é-uuid"]], inbox: [], linkTokens: { tokens: [], used: [] }, links: [], rate: [], pending: [],
  }));
  assert.throws(() => open(path), LocalDatabaseError);
});
