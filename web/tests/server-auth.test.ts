import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CognitoEmulator, LOCAL_CODE } from "../../backend/tools/local-api/cognito-emulator.ts";
import { expectedSignature, makeVerifier, serverChallenge } from "../../backend/tools/local-api/srp-server.ts";
import { AuthError, CognitoClient, unverifiedClaims } from "@/server/cognito/client";
import { cognitoTimestamp, passwordClaim, srpAHex, startSrp } from "@/server/cognito/srp";
import { sameOriginRequest } from "@/server/csrf";
import { RateLimiter } from "@/server/rate-limit";
import { profileFromIDClaims, seal, sealProfile, unseal, unsealProfile } from "@/server/session";

const POOL = "us-east-1_TESTPOOL";
const CLIENT = "test-client";

function client() {
  const key = { kid: "test", ...generateKeyPairSync("rsa", { modulusLength: 2048 }) };
  const emulator = new CognitoEmulator({ userPoolID: POOL, clientID: CLIENT, key, tokenTTL: 3600, now: () => Date.now() });
  const cognito = new CognitoClient({
    endpoint: "http://cognito.test/", clientID: CLIENT, userPoolID: POOL,
    fetch: async (_url, init) => {
      const result = emulator.handle(init.headers["x-amz-target"]?.split(".").pop() ?? "", JSON.parse(init.body));
      return { status: result.status, text: async () => JSON.stringify(result.body) };
    },
  });
  return { cognito, emulator };
}

describe("SRP", () => {
  it("a assinatura do cliente bate com a de um servidor escrito à parte", () => {
    const { salt, verifier } = makeVerifier("POOL", "user-1", "Senha!123");
    const challenge = serverChallenge(verifier);
    const session = startSrp();
    const secretBlock = Buffer.from("bloco-secreto");
    const timestamp = cognitoTimestamp(new Date(Date.UTC(2026, 10, 3, 9, 5, 7)));
    expect(timestamp).toBe("Tue Nov 3 09:05:07 UTC 2026");
    const signature = passwordClaim({
      session, poolName: "POOL", userIDForSRP: "user-1", password: "Senha!123", saltHex: salt,
      srpBHex: challenge.B.toString(16), secretBlock: secretBlock.toString("base64"), timestamp,
    });
    const expected = expectedSignature({ A: BigInt(`0x${srpAHex(session)}`), challenge, verifier, poolName: "POOL", userID: "user-1", secretBlock, timestamp });
    expect(signature).toBe(expected);
    const wrong = passwordClaim({
      session, poolName: "POOL", userIDForSRP: "user-1", password: "outra", saltHex: salt,
      srpBHex: challenge.B.toString(16), secretBlock: secretBlock.toString("base64"), timestamp,
    });
    expect(wrong).not.toBe(expected);
  });
});

describe("CognitoClient contra o emulador local", () => {
  it("cadastra, confirma, entra, renova e troca a senha", async () => {
    const { cognito } = client();
    await expect(cognito.signUp("ana@example.com", "Senha!123")).resolves.toEqual({ confirmed: false });
    await expect(cognito.signIn("ana@example.com", "Senha!123")).rejects.toMatchObject({ code: "user_not_confirmed" });
    await expect(cognito.confirmSignUp("ana@example.com", "000000")).rejects.toMatchObject({ code: "code_mismatch" });
    await cognito.confirmSignUp("ana@example.com", LOCAL_CODE);
    await cognito.confirmSignUp("ana@example.com", LOCAL_CODE); // já confirmado conta como sucesso
    await expect(cognito.signIn("ana@example.com", "errada!A1")).rejects.toMatchObject({ code: "invalid_credentials" });
    const tokens = await cognito.signIn("ana@example.com", "Senha!123");
    expect(unverifiedClaims(tokens.accessToken)["client_id"]).toBe(CLIENT);
    expect(profileFromIDClaims(unverifiedClaims(tokens.idToken))).toMatchObject({ email: "ana@example.com", provider: "password" });
    const refreshed = await cognito.refresh(tokens.refreshToken);
    expect(refreshed.accessToken).not.toBe("");
    await cognito.changePassword(refreshed.accessToken, "Senha!123", "Nova!4567");
    await expect(cognito.signIn("ana@example.com", "Senha!123")).rejects.toBeInstanceOf(AuthError);
    await expect(cognito.signIn("ana@example.com", "Nova!4567")).resolves.toHaveProperty("idToken");
  });

  it("recupera a senha por código e recusa senha fraca", async () => {
    const { cognito } = client();
    await expect(cognito.signUp("bia@example.com", "fraca")).rejects.toMatchObject({ code: "invalid_password" });
    await cognito.signUp("bia@example.com", "Senha!123");
    await cognito.confirmSignUp("bia@example.com", LOCAL_CODE);
    await expect(cognito.signUp("bia@example.com", "Senha!123")).rejects.toMatchObject({ code: "username_exists" });
    await cognito.forgotPassword("bia@example.com");
    await cognito.confirmForgotPassword("bia@example.com", LOCAL_CODE, "Outra!789");
    await expect(cognito.signIn("bia@example.com", "Outra!789")).resolves.toHaveProperty("accessToken");
  });
});

describe("sessão", () => {
  const secret = "s".repeat(32);
  it("cifra e só abre com o mesmo segredo e propósito", () => {
    const sealed = seal(secret, "refresh", "token-123");
    expect(sealed).not.toContain("token-123");
    expect(unseal(secret, "refresh", sealed)).toBe("token-123");
    expect(unseal(secret, "profile", sealed)).toBeNull();
    expect(unseal("t".repeat(32), "refresh", sealed)).toBeNull();
    expect(unseal(secret, "refresh", `${sealed.slice(0, -2)}AA`)).toBeNull();
  });
  it("perfil cifrado volta igual", () => {
    const profile = { email: "ana@example.com", provider: "password" };
    expect(unsealProfile(secret, sealProfile(secret, profile))).toEqual(profile);
    expect(unsealProfile(secret, undefined)).toBeNull();
  });
});

describe("CSRF", () => {
  const url = new URL("https://reveza.app/api/v1/me");
  const headers = (entries: Record<string, string>) => new Headers(entries);
  it("aceita só mutação da própria origem com o cabeçalho", () => {
    expect(sameOriginRequest("GET", url, headers({}))).toBe(true);
    expect(sameOriginRequest("POST", url, headers({ host: "reveza.app", origin: "https://reveza.app", "x-reveza": "1", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sameOriginRequest("POST", url, headers({ host: "reveza.app", origin: "https://reveza.app" }))).toBe(false);
    expect(sameOriginRequest("POST", url, headers({ host: "reveza.app", origin: "https://evil.example", "x-reveza": "1" }))).toBe(false);
    expect(sameOriginRequest("DELETE", url, headers({ host: "reveza.app", "x-reveza": "1", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(sameOriginRequest("PATCH", url, headers({ host: "reveza.app", "x-reveza": "1" }))).toBe(false);
  });
});

describe("limite de taxa", () => {
  it("janela fixa por chave", () => {
    const limiter = new RateLimiter(2, 1000);
    expect([limiter.allow("a", 0), limiter.allow("a", 1), limiter.allow("a", 2), limiter.allow("b", 2), limiter.allow("a", 1001)]).toEqual([true, true, false, true, true]);
  });
});
