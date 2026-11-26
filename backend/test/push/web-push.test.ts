import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { test } from "node:test";
import { DynamoPushDirectory } from "../../src/adapters/dynamodb/push-directory.ts";
import { InMemoryPushDirectory } from "../../src/adapters/in-memory/push-directory.ts";
import { userID } from "../../src/domain/ids.ts";
import { parseDevice, parseDeviceRef } from "../../src/lambdas/api.ts";
import { endpointDigest } from "../../src/push/endpoint-digest.ts";
import type { PushDirectory } from "../../src/push/push.ts";
import { RoutingPushSender } from "../../src/push/routing-sender.ts";
import { encryptAes128gcm, WebPushSender } from "../../src/push/web-push-sender.ts";
import { FakeDynamoClient } from "../support/fake-dynamo-client.ts";
import { uuid } from "../support/world.ts";

const b = (text: string): Buffer => Buffer.from(text, "base64url");

test("aes128gcm reproduz o exemplo do RFC 8291 seção 5", () => {
  const body = encryptAes128gcm({
    plaintext: Buffer.from("When I grow up, I want to be a watermelon"),
    uaPublic: b("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
    authSecret: b("BTBZMqHH6r4Tts7J_aSIgg"),
    asPrivate: b("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
    asPublic: b("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"),
    salt: b("DGv6ra1nlYgDCS1FRnbzlw"),
  });
  assert.equal(body.toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

function vapid() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: ecdh.getPrivateKey().toString("base64url") };
}
const ua = createECDH("prime256v1");
ua.generateKeys();
const webDevice = { kind: "web", endpoint: "https://push.example.net/abc", p256dh: ua.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 7).toString("base64url") } as const;

test("WebPushSender manda VAPID e aes128gcm e traduz o status (404/410 = inscrição inválida)", async () => {
  let status = 201;
  const calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];
  let keysOK = false;
  const keys = vapid();
  const sender = new WebPushSender({
    vapidKeys: async () => { if (!keysOK) throw new Error("sem valor"); return keys; }, subject: "mailto:reveza@example.com", now: () => 0,
    http: async (url, init) => { calls.push({ url, headers: init.headers ?? {} }); return { ok: true, status, text: async () => "" }; },
  });
  const message = { kind: "dailyTasks", count: 3 } as const;
  assert.equal(await sender.send(webDevice, message), "failed", "segredo sem valor: falha sem chamar o serviço");
  assert.equal(calls.length, 0);
  keysOK = true;
  assert.equal(await sender.send(webDevice, message), "sent");
  assert.equal(calls[0]?.url, webDevice.endpoint);
  assert.equal(calls[0]?.headers["content-encoding"], "aes128gcm");
  assert.match(calls[0]?.headers["authorization"] ?? "", new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`));
  for (const [code, result] of [[404, "invalidToken"], [410, "invalidToken"], [500, "failed"]] as const) {
    status = code;
    assert.equal(await sender.send(webDevice, message), result);
  }
});

test("o roteador nunca manda dailyTasks ao APNs", async () => {
  const sent: string[] = [];
  const fake = { send: async (d: { kind: string }) => { sent.push(d.kind); return "sent" as const; } };
  const router = new RoutingPushSender({ apns: fake, web: fake });
  const apns = { kind: "apns", token: "ab".repeat(32), environment: "production" } as const;
  assert.equal(await router.send(apns, { kind: "dailyTasks", count: 1 }), "failed");
  assert.equal(await router.send(webDevice, { kind: "dailyTasks", count: 1 }), "sent");
  assert.equal(await router.send(apns, { kind: "memberLeft", actorName: null, subjectName: "Bia" }), "sent");
  assert.deepEqual(sent, ["web", "apns"]);
});

const ana = userID(uuid(1));
function webContract(name: string, make: () => PushDirectory): void {
  test(`${name}: inscrição web ao lado do APNs, substituída e tirada pelo endpoint`, async () => {
    const directory = make();
    await directory.registerDevice(ana, { kind: "apns", token: "cd".repeat(32), environment: "sandbox" }, 1);
    await directory.registerDevice(ana, webDevice, 2);
    await directory.registerDevice(ana, { ...webDevice, auth: Buffer.alloc(16, 9).toString("base64url") }, 3);
    const web = (await directory.devices(ana)).filter((d) => d.kind === "web");
    assert.equal(web.length, 1);
    assert.equal(web[0]?.kind === "web" ? web[0].auth : "", Buffer.alloc(16, 9).toString("base64url"));
    await directory.removeDevice(ana, { kind: "web", endpoint: webDevice.endpoint });
    assert.deepEqual(await directory.devices(ana), [{ kind: "apns", token: "cd".repeat(32), environment: "sandbox" }]);
  });
}
webContract("em memória", () => new InMemoryPushDirectory());
webContract("DynamoDB", () => new DynamoPushDirectory({ client: new FakeDynamoClient(), endpointDigest }));

test("DynamoDB: item APNs antigo (sem kind) continua APNs; web fica em DEVICE#web#<sha256>", async () => {
  const client = new FakeDynamoClient();
  const directory = new DynamoPushDirectory({ client, endpointDigest });
  await client.put({ item: { PK: `USER#${ana}`, SK: `DEVICE#${"ef".repeat(32)}`, token: "ef".repeat(32), environment: "production", registeredAt: 1 } });
  await directory.registerDevice(ana, webDevice, 2);
  assert.ok(await client.get({ key: { PK: `USER#${ana}`, SK: `DEVICE#web#${endpointDigest(webDevice.endpoint)}` }, consistentRead: true }));
  assert.deepEqual((await directory.devices(ana)).map((d) => d.kind).sort(), ["apns", "web"]);
});

test("corpo e query de /v1/me/devices: iOS sem mudança, web validado à mão", () => {
  const token = "ab".repeat(32);
  assert.deepEqual(parseDevice({ token, environment: "sandbox" }), { kind: "apns", token, environment: "sandbox" });
  const body = { kind: "web", endpoint: webDevice.endpoint, keys: { p256dh: webDevice.p256dh, auth: webDevice.auth }, expirationTime: null };
  assert.deepEqual(parseDevice(body), webDevice);
  for (const bad of [{ ...body, endpoint: "http://x.example/a" }, { ...body, endpoint: `https://x.example/${"a".repeat(1100)}` },
    { ...body, keys: { p256dh: "abc", auth: webDevice.auth } }, { ...body, keys: { p256dh: webDevice.p256dh, auth: "!!" } }, { ...body, kind: "fcm" }, { ...body, keys: null }]) {
    assert.equal(parseDevice(bad), null);
  }
  assert.deepEqual(parseDeviceRef({ endpoint: webDevice.endpoint }), { kind: "web", endpoint: webDevice.endpoint });
  assert.equal(parseDeviceRef({ endpoint: webDevice.endpoint, token }), null);
  assert.equal(parseDeviceRef({}), null);
});
