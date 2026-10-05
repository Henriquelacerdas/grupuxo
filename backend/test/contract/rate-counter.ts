import assert from "node:assert/strict";
import { test } from "node:test";
import type { RateCounter } from "../../src/whatsapp/ports.ts";

// Contrato do `RateCounter`: o adaptador real (PostgreSQL ou outro) deve passar nos mesmos testes, inclusive o
// concorrente. Cada teste usa uma instância nova.

const WINDOW = 1_700_000_000_000;

export function rateCounterContract(name: string, make: () => RateCounter): void {
  test(`${name}: o contador começa em 1 e cresce de um em um`, async () => {
    const counter = make();
    assert.equal(await counter.increment("+5511999998888", WINDOW), 1);
    assert.equal(await counter.increment("+5511999998888", WINDOW), 2);
    assert.equal(await counter.increment("+5511999998888", WINDOW), 3);
  });

  test(`${name}: chaves diferentes não se misturam`, async () => {
    const counter = make();
    await counter.increment("+5511999998888", WINDOW);
    await counter.increment("+5511999998888", WINDOW);
    assert.equal(await counter.increment("+5521988887777", WINDOW), 1);
  });

  test(`${name}: cada janela tem a sua contagem`, async () => {
    const counter = make();
    await counter.increment("+5511999998888", WINDOW);
    await counter.increment("+5511999998888", WINDOW);
    assert.equal(await counter.increment("+5511999998888", WINDOW + 60_000), 1);
    assert.equal(await counter.increment("+5511999998888", WINDOW), 3);
  });

  test(`${name}: incrementos concorrentes recebem contagens distintas e consecutivas`, async () => {
    const counter = make();
    const counts = await Promise.all(Array.from({ length: 25 }, () => counter.increment("+5511999998888", WINDOW)));
    assert.deepEqual([...counts].sort((a, b) => a - b), Array.from({ length: 25 }, (_, index) => index + 1));
  });
}
