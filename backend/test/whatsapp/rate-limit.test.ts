import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryRateCounter } from "../../src/adapters/in-memory/rate-counter.ts";
import { MessageRateLimiter, RateLimitConfigError } from "../../src/whatsapp/rate-limit.ts";

const phone = "+5511999998888";
const T0 = 1_700_000_040_000; // início exato de uma janela de 60 s

function limiter(limit = 3, windowSeconds = 60): MessageRateLimiter {
  return new MessageRateLimiter({ counter: new InMemoryRateCounter(), limit, windowSeconds });
}

test("limite e janela precisam ser inteiros positivos: não há padrão escondido", () => {
  const counter = new InMemoryRateCounter();
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new MessageRateLimiter({ counter, limit, windowSeconds: 60 }), RateLimitConfigError);
  }
  for (const windowSeconds of [0, -60, 0.5, Number.NaN]) {
    assert.throws(() => new MessageRateLimiter({ counter, limit: 3, windowSeconds }), RateLimitConfigError);
  }
});

test("dentro do limite permite; a primeira acima avisa; as seguintes são descartadas", async () => {
  const rate = limiter(3);
  const decisions = [];
  for (let i = 0; i < 6; i += 1) decisions.push(await rate.check(phone, T0 + i * 1000));
  assert.deepEqual(decisions, ["allowed", "allowed", "allowed", "limitedFirst", "limited", "limited"]);
});

test("cada número tem o seu limite", async () => {
  const rate = limiter(1);
  assert.equal(await rate.check(phone, T0), "allowed");
  assert.equal(await rate.check(phone, T0), "limitedFirst");
  assert.equal(await rate.check("+5521988887777", T0), "allowed");
});

test("na janela seguinte o número volta a ser atendido (e avisado de novo se estourar)", async () => {
  const rate = limiter(1);
  assert.equal(await rate.check(phone, T0), "allowed");
  assert.equal(await rate.check(phone, T0 + 59_999), "limitedFirst");
  assert.equal(await rate.check(phone, T0 + 60_000), "allowed");
  assert.equal(await rate.check(phone, T0 + 60_001), "limitedFirst");
});

test("chamadas concorrentes: exatamente `limite` permitidas e um único aviso", async () => {
  const rate = limiter(5);
  const decisions = await Promise.all(Array.from({ length: 20 }, () => rate.check(phone, T0)));
  assert.equal(decisions.filter((d) => d === "allowed").length, 5);
  assert.equal(decisions.filter((d) => d === "limitedFirst").length, 1);
  assert.equal(decisions.filter((d) => d === "limited").length, 14);
});
