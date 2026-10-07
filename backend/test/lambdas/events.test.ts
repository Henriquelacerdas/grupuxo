import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHttpApiEvent, parseSqsEvent } from "../../src/lambdas/events.ts";
import { httpEvent, sqsEvent } from "./support.ts";

test("evento HTTP: método, caminho, cabeçalhos em minúsculo e corpo", () => {
  const request = parseHttpApiEvent(httpEvent({ method: "POST", path: "/v1/me", headers: { Authorization: "Bearer x", "X-Hub-Signature-256": "sha256=ab" }, body: "olá" }));
  assert.ok(request !== null);
  assert.equal(request.method, "POST");
  assert.equal(request.path, "/v1/me");
  assert.deepEqual(request.headers, { authorization: "Bearer x", "x-hub-signature-256": "sha256=ab" });
  assert.deepEqual([...request.body], [...new TextEncoder().encode("olá")]);
});

test("corpo base64 vira os bytes brutos, inclusive bytes que não são UTF-8 válido", () => {
  const raw = new Uint8Array([0x7b, 0xff, 0xfe, 0x00, 0x80, 0x7d]);
  const request = parseHttpApiEvent(httpEvent({ method: "POST", body: raw, base64: true }));
  assert.ok(request !== null);
  assert.deepEqual([...request.body], [...raw]);
});

test("corpo ausente vira zero bytes", () => {
  const request = parseHttpApiEvent(httpEvent());
  assert.ok(request !== null);
  assert.equal(request.body.length, 0);
});

test("base64 mal formado invalida o evento", () => {
  for (const body of ["não é base64!", "abc", "ab=c", "=abc", "YQ=", "YQ==="]) {
    assert.equal(parseHttpApiEvent({ ...httpEvent({ method: "POST" }), body, isBase64Encoded: true }), null, body);
  }
  assert.ok(parseHttpApiEvent({ ...httpEvent({ method: "POST" }), body: "YQ==", isBase64Encoded: true }) !== null);
});

test("a query string é decodificada a partir de rawQueryString e a primeira ocorrência vale", () => {
  const request = parseHttpApiEvent(httpEvent({ rawQueryString: "hub.mode=subscribe&hub.verify_token=a%20b%2Bc%26d&hub.challenge=1&hub.challenge=2" }));
  assert.ok(request !== null);
  assert.deepEqual(request.queryParameters, { "hub.mode": "subscribe", "hub.verify_token": "a b+c&d", "hub.challenge": "1" });
});

test("sem rawQueryString, usa queryStringParameters (só valores de texto)", () => {
  const { rawQueryString: _ignored, ...rest } = httpEvent();
  const request = parseHttpApiEvent({ ...rest, queryStringParameters: { a: "1", b: 2 } });
  assert.ok(request !== null);
  assert.deepEqual(request.queryParameters, { a: "1" });
});

test("cabeçalho __proto__ não contamina nada", () => {
  const event = httpEvent({ headers: {} });
  const request = parseHttpApiEvent({ ...event, headers: JSON.parse('{"__proto__":"x","a":"b"}') });
  assert.ok(request !== null);
  assert.equal(Object.getPrototypeOf(request.headers), Object.prototype);
  assert.equal(request.headers["a"], "b");
});

test("eventos malformados viram null", () => {
  const good = httpEvent({ method: "POST" });
  const bad: unknown[] = [
    null, undefined, "texto", 42, [], {},
    { ...good, requestContext: undefined }, { ...good, requestContext: { http: {} } }, { ...good, requestContext: { http: { method: "" } } },
    { ...good, rawPath: undefined }, { ...good, rawPath: 3 },
    { ...good, body: 5 }, { ...good, body: "x", isBase64Encoded: "true" },
  ];
  for (const event of bad) assert.equal(parseHttpApiEvent(event), null, JSON.stringify(event));
});

test("evento SQS: registros com id, corpo e grupo", () => {
  const records = parseSqsEvent(sqsEvent({ messageId: "m1", body: "{}", group: "+5511999998888" }, { messageId: "m2", body: "{}" }));
  assert.deepEqual(records, [
    { messageId: "m1", body: "{}", messageGroupId: "+5511999998888" },
    { messageId: "m2", body: "{}", messageGroupId: null },
  ]);
  assert.deepEqual(parseSqsEvent({ Records: [] }), []);
});

test("eventos SQS malformados viram null", () => {
  const bad: unknown[] = [
    null, "x", [], {}, { Records: "x" }, { Records: [null] }, { Records: [{ body: "x" }] }, { Records: [{ messageId: "", body: "x" }] },
    { Records: [{ messageId: "m", body: 1 }] },
  ];
  for (const event of bad) assert.equal(parseSqsEvent(event), null, JSON.stringify(event));
});
