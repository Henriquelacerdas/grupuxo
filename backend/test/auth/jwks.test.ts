import assert from "node:assert/strict";
import { test } from "node:test";
import { CognitoJwtVerifier, cognitoJwksURL } from "../../src/auth/cognito-jwt-verifier.ts";
import { HttpJwksSource, JwksError, parseJwks } from "../../src/auth/jwks.ts";
import type { HttpFetch, HttpRequestInit, HttpResponse } from "../../src/http.ts";
import { CLIENT_ID, NOW, USER_POOL_ID, generateKey, signJWT, type Json, type TestKey } from "./support.ts";

const keyA = generateKey("kid-a");
const keyB = generateKey("kid-b");
const weak = generateKey("kid-fraca", 1024);

function jwk(key: TestKey, extra: Json = {}): Json {
  return { ...key.publicKey.export({ format: "jwk" }), kid: key.kid, use: "sig", alg: "RS256", ...extra };
}

const jwks = (...keys: Json[]): Json => ({ keys });

test("parseJwks lê as chaves RSA de assinatura", () => {
  const keys = parseJwks(jwks(jwk(keyA), jwk(keyB)));
  assert.deepEqual(keys.map((key) => key.kid), ["kid-a", "kid-b"]);
});

test("parseJwks ignora o que não serve, sem derrubar as chaves boas", () => {
  const ignored: Json[] = [
    jwk(weak),
    jwk(keyB, { use: "enc" }),
    jwk(keyB, { alg: "RS384" }),
    jwk(keyB, { kty: "EC" }),
    jwk(keyB, { kid: undefined }),
    jwk(keyB, { kid: "" }),
    jwk(keyB, { n: "!!!" }),
    jwk(keyB, { e: 65537 }),
    { kty: "RSA" },
  ];
  const keys = parseJwks(jwks(jwk(keyA), ...ignored));
  assert.deepEqual(keys.map((key) => key.kid), ["kid-a"]);
});

test("parseJwks falha fechada: kid repetido, conjunto vazio ou formato inesperado", () => {
  assert.throws(() => parseJwks(jwks(jwk(keyA), jwk(keyB, { kid: "kid-a" }))), JwksError);
  assert.throws(() => parseJwks(jwks()), JwksError);
  assert.throws(() => parseJwks(jwks(jwk(weak))), JwksError);
  for (const body of [null, [], "x", 42, {}, { keys: "x" }, { keys: {} }]) assert.throws(() => parseJwks(body), JwksError);
});

interface Recorded {
  readonly url: string;
  readonly init: HttpRequestInit;
}

function fakeHttp(respond: () => HttpResponse): { http: HttpFetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const http: HttpFetch = async (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  return { http, calls };
}

const response = (body: string, status = 200): HttpResponse => ({ ok: status >= 200 && status < 300, status, text: async () => body });

test("HttpJwksSource busca a URL configurada com GET, tempo limite e sem credenciais", async () => {
  const { http, calls } = fakeHttp(() => response(JSON.stringify(jwks(jwk(keyA)))));
  const url = cognitoJwksURL(USER_POOL_ID);
  const keys = await new HttpJwksSource(url, http).load();
  assert.deepEqual(keys.map((key) => key.kid), ["kid-a"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, url);
  assert.equal(calls[0]?.init.method, "GET");
  assert.ok(calls[0]?.init.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(calls[0]?.init.headers ?? {}), ["accept"]);
});

test("HttpJwksSource só aceita HTTPS", () => {
  const { http } = fakeHttp(() => response("{}"));
  assert.throws(() => new HttpJwksSource("http://cognito-idp.us-east-1.amazonaws.com/x/.well-known/jwks.json", http), JwksError);
  assert.throws(() => new HttpJwksSource("file:///etc/passwd", http), JwksError);
});

test("HttpJwksSource recusa resposta com erro, JSON inválido e corpo grande, sem vazar o corpo", async () => {
  const secret = "corpo-sensivel-da-resposta";
  const cases: HttpResponse[] = [
    response(secret, 500), response(secret, 403), response(`{${secret}`), response(JSON.stringify({ keys: [], enchimento: "x".repeat(70_000) })),
  ];
  for (const bad of cases) {
    const { http } = fakeHttp(() => bad);
    await assert.rejects(new HttpJwksSource(cognitoJwksURL(USER_POOL_ID), http).load(), (error: unknown) => {
      assert.ok(error instanceof JwksError);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  }
});

test("o verificador funciona de ponta a ponta sobre HTTP, com uma única busca", async () => {
  const { http, calls } = fakeHttp(() => response(JSON.stringify(jwks(jwk(keyA), jwk(keyB)))));
  const verifier = new CognitoJwtVerifier(
    { userPoolID: USER_POOL_ID, clientID: CLIENT_ID },
    { jwks: new HttpJwksSource(cognitoJwksURL(USER_POOL_ID), http), now: () => NOW },
  );
  assert.ok(await verifier.verify(signJWT({ key: keyA })));
  assert.ok(await verifier.verify(signJWT({ key: keyB })));
  assert.equal(calls.length, 1);
});
