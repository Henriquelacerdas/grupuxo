import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage } from "../../src/whatsapp/incoming-message.ts";
import type { MessageQueue } from "../../src/whatsapp/ports.ts";

// Contrato do `MessageQueue`: o que foi enfileirado chega inteiro e, por telefone, na ordem. `delivered()` devolve
// (e esvazia) o que a fila entregaria a um consumidor. Cada teste usa uma instância nova. Deduplicação por
// `wamid` é do SQS FIFO e fica nos testes do adaptador, não aqui.

export interface QueueHarness {
  readonly queue: MessageQueue;
  delivered(): Promise<readonly IncomingMessage[]>;
}

const message = (wamid: string, phoneE164: string, text: string, receivedAt = 1_700_000_000_000): IncomingMessage => ({
  wamid, phoneE164, text, receivedAt,
});

export function messageQueueContract(name: string, make: () => QueueHarness): void {
  test(`${name}: a mensagem enfileirada chega idêntica`, async () => {
    const { queue, delivered } = make();
    const original = message("wamid.HBgM123=", "+5511999998888", 'Olá, "mundo"\n— 🧹', 1_700_000_123_456);
    await queue.enqueue(original);
    assert.deepEqual(await delivered(), [original]);
  });

  test(`${name}: a ordem de chegada de um telefone é preservada`, async () => {
    const { queue, delivered } = make();
    const sent = [1, 2, 3, 4].map((n) => message(`wamid.${n}`, "+5511999998888", `m${n}`));
    for (const item of sent) await queue.enqueue(item);
    assert.deepEqual(await delivered(), sent);
  });

  test(`${name}: enfileiramentos concorrentes entregam todas as mensagens`, async () => {
    const { queue, delivered } = make();
    const sent = Array.from({ length: 20 }, (_, n) => message(`wamid.${n}`, n % 2 === 0 ? "+5511999998888" : "+5521988887777", `m${n}`));
    await Promise.all(sent.map((item) => queue.enqueue(item)));
    const received = [...(await delivered())].sort((a, b) => a.wamid.localeCompare(b.wamid));
    assert.deepEqual(received, [...sent].sort((a, b) => a.wamid.localeCompare(b.wamid)));
  });
}
