import assert from "node:assert/strict";
import { test } from "node:test";
import { taskOccurrenceID, userID } from "../../src/domain/ids.ts";
import type { PendingActionStore, PendingCompletion } from "../../src/whatsapp/ports.ts";
import { uuid } from "../support/world.ts";

// Contrato do `PendingActionStore`: o adaptador DynamoDB deve passar nos mesmos testes, inclusive o
// concorrente. Cada teste usa uma instância nova.

const NOW = 1_700_000_000_000;
const marina = userID(uuid(1));
const leo = userID(uuid(2));

function pending(owner = marina, occurrence = 100, expiresAt = NOW + 300_000): PendingCompletion {
  return { userID: owner, occurrenceID: taskOccurrenceID(uuid(occurrence)), createdAt: NOW, expiresAt, confirmedByWamid: null };
}

export function pendingActionStoreContract(name: string, make: () => PendingActionStore): void {
  test(`${name}: confirmar devolve o pedido salvo, marcado com o wamid`, async () => {
    const store = make();
    await store.save(pending());
    const confirmed = await store.confirm(marina, "wamid.1", NOW + 1_000);
    assert.deepEqual(confirmed, { ...pending(), confirmedByWamid: "wamid.1" });
  });

  test(`${name}: sem pedido, confirmar devolve null`, async () => {
    assert.equal(await make().confirm(marina, "wamid.1", NOW), null);
  });

  test(`${name}: o mesmo wamid pode confirmar de novo (reentrega); outro wamid não`, async () => {
    const store = make();
    await store.save(pending());
    const first = await store.confirm(marina, "wamid.1", NOW + 1_000);
    assert.deepEqual(await store.confirm(marina, "wamid.1", NOW + 2_000), first);
    assert.equal(await store.confirm(marina, "wamid.2", NOW + 3_000), null);
  });

  test(`${name}: pedido vencido não confirma (a validade vale até expiresAt, exclusivo)`, async () => {
    const store = make();
    await store.save(pending(marina, 100, NOW + 300_000));
    assert.equal(await store.confirm(marina, "wamid.1", NOW + 300_000), null);
    await store.save(pending(marina, 100, NOW + 300_000));
    assert.notEqual(await store.confirm(marina, "wamid.1", NOW + 299_999), null);
  });

  test(`${name}: salvar de novo substitui o pedido e zera a confirmação`, async () => {
    const store = make();
    await store.save(pending(marina, 100));
    await store.confirm(marina, "wamid.1", NOW);
    await store.save(pending(marina, 200));
    const confirmed = await store.confirm(marina, "wamid.2", NOW);
    assert.equal(confirmed?.occurrenceID, taskOccurrenceID(uuid(200)));
    assert.equal(confirmed?.confirmedByWamid, "wamid.2");
  });

  test(`${name}: cada morador tem o seu pedido`, async () => {
    const store = make();
    await store.save(pending(marina, 100));
    await store.save(pending(leo, 200));
    assert.equal((await store.confirm(leo, "wamid.1", NOW))?.occurrenceID, taskOccurrenceID(uuid(200)));
    assert.equal((await store.confirm(marina, "wamid.2", NOW))?.occurrenceID, taskOccurrenceID(uuid(100)));
  });

  test(`${name}: descartar apaga o pedido e é idempotente`, async () => {
    const store = make();
    await store.save(pending());
    await store.discard(marina);
    await store.discard(marina);
    assert.equal(await store.confirm(marina, "wamid.1", NOW), null);
  });

  test(`${name}: confirmações concorrentes com wamids diferentes: só uma vence`, async () => {
    const store = make();
    await store.save(pending());
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => store.confirm(marina, `wamid.${index}`, NOW)));
    const winners = results.filter((result) => result !== null);
    assert.equal(winners.length, 1);
  });
}
