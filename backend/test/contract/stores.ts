import assert from "node:assert/strict";
import { test } from "node:test";
import { userID } from "../../src/domain/ids.ts";
import { WhatsAppLinkError, type InboxStore, type LinkTokenStore, type WhatsAppLink, type WhatsAppLinkStore } from "../../src/whatsapp/ports.ts";
import { uuid } from "../support/world.ts";

// Contrato que qualquer implementação dos ports (inclusive a de PostgreSQL) deve respeitar: a mesma função
// recebe uma fábrica do adaptador e registra os testes. Cada teste usa uma instância nova.

const NOW = 1_700_000_000_000;
const linkError = (code: WhatsAppLinkError["code"]) => (error: unknown) => error instanceof WhatsAppLinkError && error.code === code;

export function inboxStoreContract(name: string, make: () => InboxStore): void {
  test(`${name}: a caixa de entrada reivindica até ser processada`, async () => {
    const inbox = make();
    assert.equal(await inbox.claim("w", NOW), "claimed");
    assert.equal(await inbox.claim("w", NOW), "claimed");
    await inbox.markProcessed("w", NOW);
    assert.equal(await inbox.claim("w", NOW), "duplicate");
    assert.equal(await inbox.claim("outra", NOW), "claimed");
  });

  test(`${name}: reivindicações concorrentes da mesma mensagem processada continuam duplicadas`, async () => {
    const inbox = make();
    await inbox.claim("w", NOW);
    await inbox.markProcessed("w", NOW);
    const results = await Promise.all(Array.from({ length: 10 }, () => inbox.claim("w", NOW)));
    assert.ok(results.every((r) => r === "duplicate"));
  });
}

export function whatsAppLinkStoreContract(name: string, make: () => WhatsAppLinkStore): void {
  const ana = userID(uuid(1));
  const bia = userID(uuid(2));
  const link = (user: typeof ana, phoneE164: string): WhatsAppLink => ({ userID: user, phoneE164, consentedAt: NOW, linkedAt: NOW });

  test(`${name}: o vínculo é único por número e por morador`, async () => {
    const store = make();
    const created = link(ana, "+5511999998888");
    await store.create(created);
    assert.deepEqual(await store.linkForPhone("+5511999998888"), created);
    assert.deepEqual(await store.linkForUser(ana), created);
    await assert.rejects(store.create(link(bia, "+5511999998888")), linkError("phoneAlreadyLinked"));
    await assert.rejects(store.create(link(ana, "+5521988887777")), linkError("userAlreadyLinked"));
    assert.equal(await store.linkForUser(bia), null);
  });

  test(`${name}: remover o vínculo libera o número e é idempotente`, async () => {
    const store = make();
    await store.create(link(ana, "+5511999998888"));
    await store.remove(ana);
    await store.remove(ana);
    assert.equal(await store.linkForPhone("+5511999998888"), null);
    await store.create(link(bia, "+5511999998888"));
  });

  test(`${name}: criações concorrentes do mesmo número deixam um único vínculo`, async () => {
    const store = make();
    const outcomes = await Promise.allSettled([store.create(link(ana, "+5511999998888")), store.create(link(bia, "+5511999998888"))]);
    assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((o) => o.status === "rejected").length, 1);
  });
}

export function linkTokenStoreContract(name: string, make: () => LinkTokenStore): void {
  const ana = userID(uuid(1));

  test(`${name}: o token é de uso único e expira`, async () => {
    const store = make();
    await store.save({ tokenHash: "h1", userID: ana, expiresAt: NOW + 900_000 });
    assert.equal(await store.consume("h1", NOW), ana);
    assert.equal(await store.consume("h1", NOW), null);

    await store.save({ tokenHash: "h2", userID: ana, expiresAt: NOW + 900_000 });
    assert.equal(await store.consume("h2", NOW + 900_000), null);
    assert.equal(await store.consume("inexistente", NOW), null);
  });

  test(`${name}: consumos concorrentes do mesmo token só têm um vencedor`, async () => {
    const store = make();
    await store.save({ tokenHash: "h", userID: ana, expiresAt: NOW + 900_000 });
    const results = await Promise.all(Array.from({ length: 10 }, () => store.consume("h", NOW)));
    assert.equal(results.filter((r) => r === ana).length, 1);
  });
}
