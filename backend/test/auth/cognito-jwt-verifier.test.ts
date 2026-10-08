import assert from "node:assert/strict";
import { test } from "node:test";
import { CognitoConfigError, CognitoJwtVerifier, cognitoIssuer, cognitoJwksURL } from "../../src/auth/cognito-jwt-verifier.ts";
import { AuthenticationError, TokenVerifierUnavailableError, parseCognitoSub, type AuthenticationFailure } from "../../src/auth/token-verifier.ts";
import {
  CLIENT_ID, FakeJwksSource, ISSUER, NOW, NOW_SECONDS, SUB, USER_POOL_ID, accessClaims, base64url, generateKey, hs256WithPublicKey,
  idClaims, rawJWT, replaceSegment, signJWT, without, type TestKey,
} from "./support.ts";

const keyA = generateKey("kid-a");
const keyB = generateKey("kid-b");
const attacker = generateKey("kid-a");

interface Setup {
  readonly verifier: CognitoJwtVerifier;
  readonly source: FakeJwksSource;
  readonly clock: { now: number };
}

function setup(keys: readonly TestKey[] = [keyA], tolerance?: number): Setup {
  const source = new FakeJwksSource(keys);
  const clock = { now: NOW };
  const verifier = new CognitoJwtVerifier(
    { userPoolID: USER_POOL_ID, clientID: CLIENT_ID, ...(tolerance === undefined ? {} : { clockToleranceSeconds: tolerance }) },
    { jwks: source, now: () => clock.now },
  );
  return { verifier, source, clock };
}

async function rejectsWith(verifier: CognitoJwtVerifier, token: string, reason: AuthenticationFailure): Promise<void> {
  await assert.rejects(verifier.verify(token), (error: unknown) => {
    assert.ok(error instanceof AuthenticationError, `esperava AuthenticationError, veio ${String(error)}`);
    assert.equal(error.reason, reason);
    return true;
  });
}

test("aceita um access token válido e devolve só o sub", async () => {
  const { verifier } = setup();
  assert.deepEqual(await verifier.verify(signJWT({ key: keyA })), { cognitoSub: parseCognitoSub(SUB) });
});

test("o issuer e a URL do JWKS saem do ID do pool", () => {
  assert.equal(cognitoIssuer(USER_POOL_ID), "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_M9GpISkE3");
  assert.equal(cognitoJwksURL(USER_POOL_ID), "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_M9GpISkE3/.well-known/jwks.json");
});

test("rejeita o ID token, mesmo com aud igual ao client e assinatura válida", async () => {
  const { verifier } = setup();
  await rejectsWith(verifier, signJWT({ key: keyA, claims: idClaims() }), "wrongTokenUse");
  await rejectsWith(verifier, signJWT({ key: keyA, claims: idClaims({ client_id: CLIENT_ID }) }), "wrongTokenUse");
});

test("rejeita token_use ausente ou desconhecido", async () => {
  const { verifier } = setup();
  await rejectsWith(verifier, signJWT({ key: keyA, claims: without(accessClaims(), "token_use") }), "wrongTokenUse");
  await rejectsWith(verifier, signJWT({ key: keyA, claims: accessClaims({ token_use: "refresh" }) }), "wrongTokenUse");
  await rejectsWith(verifier, signJWT({ key: keyA, claims: accessClaims({ token_use: ["access"] }) }), "wrongTokenUse");
});

test("valida client_id e nunca consulta aud", async () => {
  const { verifier } = setup();
  await rejectsWith(verifier, signJWT({ key: keyA, claims: accessClaims({ client_id: "outroclient123" }) }), "wrongClient");
  await rejectsWith(verifier, signJWT({ key: keyA, claims: without(accessClaims(), "client_id") }), "wrongClient");
  // aud correto não salva um client_id errado ou ausente.
  await rejectsWith(verifier, signJWT({ key: keyA, claims: accessClaims({ client_id: "outroclient123", aud: CLIENT_ID }) }), "wrongClient");
  await rejectsWith(verifier, signJWT({ key: keyA, claims: without(accessClaims({ aud: CLIENT_ID }), "client_id") }), "wrongClient");
  // aud errado não derruba um client_id correto: o campo é ignorado.
  assert.ok(await verifier.verify(signJWT({ key: keyA, claims: accessClaims({ aud: "qualquer-coisa" }) })));
});

test("o issuer precisa ser exatamente o do pool", async () => {
  const { verifier } = setup();
  const issuers = [
    "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OUTROPOOL",
    "https://cognito-idp.sa-east-1.amazonaws.com/us-east-1_M9GpISkE3",
    `${ISSUER}/`,
    ISSUER.toUpperCase(),
    ISSUER.replace("https", "http"),
    "",
  ];
  for (const iss of issuers) await rejectsWith(verifier, signJWT({ key: keyA, claims: accessClaims({ iss }) }), "wrongIssuer");
  await rejectsWith(verifier, signJWT({ key: keyA, claims: without(accessClaims(), "iss") }), "wrongIssuer");
});

test("rejeita algoritmos diferentes de RS256, inclusive none e HS256", async () => {
  const { verifier } = setup();
  const claims = accessClaims();
  await rejectsWith(verifier, rawJWT({ alg: "none", kid: "kid-a" }, claims, "c2lnbmF0dXJl"), "unsupportedAlgorithm");
  await rejectsWith(verifier, rawJWT({ alg: "None", kid: "kid-a" }, claims, "c2lnbmF0dXJl"), "unsupportedAlgorithm");
  await rejectsWith(verifier, hs256WithPublicKey(keyA), "unsupportedAlgorithm");
  await rejectsWith(verifier, signJWT({ key: keyA, header: { alg: "RS384" } }), "unsupportedAlgorithm");
  await rejectsWith(verifier, signJWT({ key: keyA, header: { alg: "rs256" } }), "unsupportedAlgorithm");
  await rejectsWith(verifier, signJWT({ key: keyA, header: { alg: ["RS256"] } }), "unsupportedAlgorithm");
  await rejectsWith(verifier, rawJWT({ kid: "kid-a" }, claims, "c2lnbmF0dXJl"), "unsupportedAlgorithm");
});

test("alg none sem assinatura (h.p.) é malformado", async () => {
  const { verifier } = setup();
  await rejectsWith(verifier, rawJWT({ alg: "none", kid: "kid-a" }, accessClaims(), ""), "malformed");
});

test("o ataque de confusão de algoritmo (HS256 com a chave pública) nunca chega à verificação", async () => {
  const { verifier, source } = setup();
  await rejectsWith(verifier, hs256WithPublicKey(keyA), "unsupportedAlgorithm");
  assert.equal(source.loads, 0);
});

test("rejeita kid desconhecido, ausente ou inválido", async () => {
  const { verifier } = setup();
  await rejectsWith(verifier, signJWT({ key: generateKey("kid-desconhecido") }), "unknownKey");
  await rejectsWith(verifier, signJWT({ key: keyA, header: { kid: undefined } }), "malformed");
  await rejectsWith(verifier, signJWT({ key: keyA, header: { kid: 7 } }), "malformed");
  await rejectsWith(verifier, signJWT({ key: keyA, header: { kid: "" } }), "malformed");
  await rejectsWith(verifier, signJWT({ key: keyA, header: { kid: "k".repeat(300) } }), "malformed");
});

test("rejeita cabeçalho com crit", async () => {
  const { verifier } = setup();
  await rejectsWith(verifier, signJWT({ key: keyA, header: { crit: ["exp"] } }), "malformed");
});

test("rejeita assinatura adulterada e payload adulterado", async () => {
  const { verifier } = setup();
  const token = signJWT({ key: keyA });
  const [, , signature] = token.split(".");
  assert.ok(signature !== undefined);
  const flipped = (signature.startsWith("A") ? "B" : "A") + signature.slice(1);
  await rejectsWith(verifier, replaceSegment(token, 2, flipped), "badSignature");
  await rejectsWith(verifier, replaceSegment(token, 2, signature.slice(0, -8)), "badSignature");
  await rejectsWith(verifier, replaceSegment(token, 1, base64url(JSON.stringify(accessClaims({ sub: "outra-conta" })))), "badSignature");
  await rejectsWith(verifier, replaceSegment(token, 0, base64url(JSON.stringify({ alg: "RS256", kid: "kid-a", extra: 1 }))), "badSignature");
});

test("rejeita token assinado por outra chave com o mesmo kid", async () => {
  const { verifier } = setup();
  await rejectsWith(verifier, signJWT({ key: attacker }), "badSignature");
});

test("exp: vencido é recusado, dentro da tolerância não, e exp é obrigatório", async () => {
  const { verifier } = setup();
  await rejectsWith(verifier, signJWT({ key: keyA, claims: accessClaims({ exp: NOW_SECONDS - 31 }) }), "expired");
  await rejectsWith(verifier, signJWT({ key: keyA, claims: accessClaims({ exp: NOW_SECONDS - 30 }) }), "expired");
  assert.ok(await verifier.verify(signJWT({ key: keyA, claims: accessClaims({ exp: NOW_SECONDS - 29 }) })));
  await rejectsWith(verifier, signJWT({ key: keyA, claims: without(accessClaims(), "exp") }), "invalidClaims");
  await rejectsWith(verifier, signJWT({ key: keyA, claims: accessClaims({ exp: String(NOW_SECONDS + 100) }) }), "invalidClaims");
  await rejectsWith(verifier, signJWT({ key: keyA, claims: accessClaims({ exp: null }) }), "invalidClaims");
});

test("o relógio injetado decide a validade", async () => {
  const { verifier, clock } = setup();
  const token = signJWT({ key: keyA, claims: accessClaims({ exp: NOW_SECONDS + 3600 }) });
  assert.ok(await verifier.verify(token));
  clock.now = NOW + 3600 * 1000 + 30_000;
  await rejectsWith(verifier, token, "expired");
});

test("nbf: no futuro além da tolerância é recusado; ausente é aceito; inválido é recusado", async () => {
  const { verifier } = setup();
  await rejectsWith(verifier, signJWT({ key: keyA, claims: accessClaims({ nbf: NOW_SECONDS + 31 }) }), "notYetValid");
  assert.ok(await verifier.verify(signJWT({ key: keyA, claims: accessClaims({ nbf: NOW_SECONDS + 30 }) })));
  assert.ok(await verifier.verify(signJWT({ key: keyA, claims: accessClaims({ nbf: NOW_SECONDS - 5 }) })));
  await rejectsWith(verifier, signJWT({ key: keyA, claims: accessClaims({ nbf: "agora" }) }), "invalidClaims");
});

test("a tolerância é configurável e limitada", async () => {
  const strict = setup([keyA], 0);
  await rejectsWith(strict.verifier, signJWT({ key: keyA, claims: accessClaims({ exp: NOW_SECONDS }) }), "expired");
  assert.throws(() => setup([keyA], -1), (e: unknown) => e instanceof CognitoConfigError && e.code === "invalidTolerance");
  assert.throws(() => setup([keyA], 301), (e: unknown) => e instanceof CognitoConfigError && e.code === "invalidTolerance");
});

test("o sub é obrigatório e precisa ser um texto válido", async () => {
  const { verifier } = setup();
  for (const sub of [undefined, "", 42, "com espaço", "x".repeat(129)]) {
    const claims = sub === undefined ? without(accessClaims(), "sub") : accessClaims({ sub });
    await rejectsWith(verifier, signJWT({ key: keyA, claims }), "invalidClaims");
  }
});

test("rejeita tokens malformados", async () => {
  const { verifier } = setup();
  const valid = signJWT({ key: keyA });
  const [h, p, s] = valid.split(".");
  assert.ok(h !== undefined && p !== undefined && s !== undefined);
  const malformed = [
    "", "abc", `${h}.${p}`, `${h}.${p}.${s}.extra`, `${h}.${p}.`, `.${p}.${s}`, `${h}..${s}`, `..`,
    ` ${valid}`, `${valid} `, `Bearer ${valid}`, `${valid}\n`,
    `${h}.${p}.${s}=`, `${h}.${p}.${s}+`, `${h}.${p}.${s}/`, `${h}.${p}.${"a".repeat(5)}`,
    `${base64url("não é json")}.${p}.${s}`, `${base64url("[]")}.${p}.${s}`, `${base64url("null")}.${p}.${s}`, `${base64url('"RS256"')}.${p}.${s}`,
    `${h}.${base64url("não é json")}.${s}`, `${h}.${base64url("[1]")}.${s}`, `${h}.${base64url("42")}.${s}`,
    `${base64url(Buffer.from([0xff, 0xfe, 0xfd]))}.${p}.${s}`,
  ];
  for (const token of malformed) {
    await assert.rejects(verifier.verify(token), (error: unknown) => error instanceof AuthenticationError, JSON.stringify(token));
  }
  await rejectsWith(verifier, "", "malformed");
  await rejectsWith(verifier, `${h}.${p}`, "malformed");
});

test("rejeita token grande demais antes de qualquer processamento", async () => {
  const { verifier, source } = setup();
  const padded = signJWT({ key: keyA, claims: accessClaims({ padding: "x".repeat(9000) }) });
  await rejectsWith(verifier, padded, "tooLarge");
  assert.equal(source.loads, 0);
});

test("a recusa não vaza o motivo nem o token na mensagem", async () => {
  const { verifier } = setup();
  const token = signJWT({ key: keyA, claims: accessClaims({ exp: NOW_SECONDS - 1000 }) });
  await assert.rejects(verifier.verify(token), (error: unknown) => {
    assert.ok(error instanceof AuthenticationError);
    assert.equal(error.message, "Não autorizado");
    assert.ok(!String(error.stack).includes(token));
    assert.ok(!error.message.includes("expired"));
    return true;
  });
});

test("rotação de chave: uma chave nova é buscada, mas no máximo uma vez por intervalo", async () => {
  const { verifier, source, clock } = setup([keyA]);
  assert.ok(await verifier.verify(signJWT({ key: keyA })));
  assert.equal(source.loads, 1);

  source.rotate([keyA, keyB]);
  // Dentro do intervalo mínimo: nada de nova busca, a chave ainda é desconhecida.
  await rejectsWith(verifier, signJWT({ key: keyB }), "unknownKey");
  assert.equal(source.loads, 1);

  clock.now += 10_000;
  assert.ok(await verifier.verify(signJWT({ key: keyB, claims: accessClaims({ exp: NOW_SECONDS + 7200 }) })));
  assert.equal(source.loads, 2);
  assert.ok(await verifier.verify(signJWT({ key: keyA })));
  assert.equal(source.loads, 2);
});

test("rotação: uma chave removida deixa de valer depois da próxima busca", async () => {
  const { verifier, source, clock } = setup([keyA, keyB]);
  assert.ok(await verifier.verify(signJWT({ key: keyA })));
  source.rotate([keyB]);
  clock.now += 3_600_000;
  const token = signJWT({ key: keyA, claims: accessClaims({ exp: NOW_SECONDS + 7200 }) });
  await rejectsWith(verifier, token, "unknownKey");
});

test("kids aleatórios não geram uma busca por requisição", async () => {
  const { verifier, source } = setup([keyA]);
  await verifier.verify(signJWT({ key: keyA }));
  const unknown = generateKey("x");
  for (let i = 0; i < 25; i += 1) await rejectsWith(verifier, signJWT({ key: unknown, header: { kid: `forjado-${i}` } }), "unknownKey");
  assert.equal(source.loads, 1);
});

test("verificações simultâneas com o cache vazio fazem uma só busca", async () => {
  const { verifier, source } = setup();
  const token = signJWT({ key: keyA });
  await Promise.all(Array.from({ length: 20 }, () => verifier.verify(token)));
  assert.equal(source.loads, 1);
});

test("o cache expira pelo TTL e refaz a busca", async () => {
  const { verifier, source, clock } = setup();
  await verifier.verify(signJWT({ key: keyA }));
  clock.now += 3_599_000;
  await verifier.verify(signJWT({ key: keyA }));
  assert.equal(source.loads, 1);
  clock.now += 2_000;
  await verifier.verify(signJWT({ key: keyA, claims: accessClaims({ exp: NOW_SECONDS + 7200 }) }));
  assert.equal(source.loads, 2);
});

test("sem chaves disponíveis falha fechada com erro de indisponibilidade, não de autenticação", async () => {
  const { verifier, source } = setup();
  source.failing = true;
  await assert.rejects(verifier.verify(signJWT({ key: keyA })), (error: unknown) => {
    assert.ok(error instanceof TokenVerifierUnavailableError);
    assert.ok(!(error instanceof AuthenticationError));
    assert.ok(!error.message.includes("simulada"));
    return true;
  });
});

test("depois de uma falha, a busca só é tentada de novo após o intervalo mínimo", async () => {
  const { verifier, source, clock } = setup();
  source.failing = true;
  await assert.rejects(verifier.verify(signJWT({ key: keyA })), TokenVerifierUnavailableError);
  await assert.rejects(verifier.verify(signJWT({ key: keyA })), TokenVerifierUnavailableError);
  assert.equal(source.loads, 1);
  source.failing = false;
  clock.now += 10_000;
  assert.ok(await verifier.verify(signJWT({ key: keyA, claims: accessClaims({ exp: NOW_SECONDS + 7200 }) })));
  assert.equal(source.loads, 2);
});

test("com chaves em cache, uma falha na busca por kid novo só recusa aquele token", async () => {
  const { verifier, source, clock } = setup([keyA]);
  await verifier.verify(signJWT({ key: keyA }));
  clock.now += 10_000;
  source.failing = true;
  await rejectsWith(verifier, signJWT({ key: keyB }), "unknownKey");
  assert.ok(await verifier.verify(signJWT({ key: keyA, claims: accessClaims({ exp: NOW_SECONDS + 7200 }) })));
});

test("configuração: só o access token é aceito e valores inválidos são recusados", () => {
  const source = new FakeJwksSource([keyA]);
  const dependencies = { jwks: source, now: () => NOW };
  const config = { userPoolID: USER_POOL_ID, clientID: CLIENT_ID };
  const invalid = (code: CognitoConfigError["code"]) => (error: unknown) => error instanceof CognitoConfigError && error.code === code;
  assert.ok(new CognitoJwtVerifier({ ...config, acceptedTokenUse: ["access"] }, dependencies));
  assert.throws(() => new CognitoJwtVerifier({ ...config, acceptedTokenUse: [] }, dependencies), invalid("invalidTokenUse"));
  // Valores que viriam de uma variável de ambiente mal escrita: o tipo não os impediria em tempo de execução.
  const fromEnvironment: readonly string[] = ["id"];
  assert.throws(() => new CognitoJwtVerifier({ ...config, acceptedTokenUse: JSON.parse(JSON.stringify(fromEnvironment)) }, dependencies), invalid("invalidTokenUse"));
  assert.throws(() => new CognitoJwtVerifier({ ...config, userPoolID: "pool" }, dependencies), invalid("invalidUserPoolID"));
  assert.throws(() => new CognitoJwtVerifier({ ...config, userPoolID: "us-east-1_M9GpISkE3/../x" }, dependencies), invalid("invalidUserPoolID"));
  assert.throws(() => new CognitoJwtVerifier({ ...config, clientID: "" }, dependencies), invalid("invalidClientID"));
  assert.throws(() => new CognitoJwtVerifier({ ...config, clientID: "com espaço" }, dependencies), invalid("invalidClientID"));
});
