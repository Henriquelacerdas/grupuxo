import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, createVerify, hkdfSync } from "node:crypto";
import { test } from "node:test";
import { DynamoReminderClaims } from "../../src/adapters/dynamodb/push-directory.ts";
import { InMemoryPushDirectory, InMemoryReminderClaims } from "../../src/adapters/in-memory/push-directory.ts";
import { localToInstant } from "../../src/domain/dates.ts";
import { userID } from "../../src/domain/ids.ts";
import { LambdaConfigError, parsePushSettings, parseScheduledSettings, parseWebPushSecret } from "../../src/lambdas/config.ts";
import { ApnsPushSender } from "../../src/push/apns-sender.ts";
import { DailyTaskReminder, type ReminderClaims } from "../../src/push/daily-reminder.ts";
import { PushNotifier } from "../../src/push/notifier.ts";
import { allowsPush, DEFAULT_PREFERENCES, type PushDevice, type PushMessage, type PushResult, type PushSender } from "../../src/push/push.ts";
import { WebPushSender } from "../../src/push/web-push-sender.ts";
import { FakeDynamoClient } from "../support/fake-dynamo-client.ts";
import { uuid } from "../support/world.ts";

const ana = userID(uuid(1));
const bia = userID(uuid(2));
const ua = createECDH("prime256v1");
ua.generateKeys();
const authSecret = Buffer.alloc(16, 3);
const web = { kind: "web", endpoint: "https://fcm.example.com/send/xyz", p256dh: ua.getPublicKey().toString("base64url"), auth: authSecret.toString("base64url") } as const;
const apns = { kind: "apns", token: "ab".repeat(32), environment: "production" } as const;

/** O que o navegador faz (RFC 8291/8188): decifra o corpo com a chave privada da inscrição. */
function decrypt(body: Uint8Array): unknown {
  const buffer = Buffer.from(body);
  const salt = buffer.subarray(0, 16);
  const idLength = buffer[20] ?? 0;
  const asPublic = buffer.subarray(21, 21 + idLength);
  const record = buffer.subarray(21 + idLength);
  const ecdhSecret = ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 0x02, "delimitador do último registro");
  return JSON.parse(plain.subarray(0, plain.length - 1).toString("utf8"));
}

test("o navegador decifra o corpo e confere o JWT do VAPID; o corpo só leva chave, argumentos e caminho", async () => {
  const server = createECDH("prime256v1");
  server.generateKeys();
  const keys = { publicKey: server.getPublicKey().toString("base64url"), privateKey: server.getPrivateKey().toString("base64url") };
  const bodies: Uint8Array[] = [];
  let authorization = "";
  const sender = new WebPushSender({
    vapidKeys: async () => keys, subject: "mailto:reveza@example.com", now: () => 1_700_000_000_000,
    http: async (_url, init) => { bodies.push(init.body); authorization = init.headers?.["authorization"] ?? ""; return { ok: true, status: 201, text: async () => "" }; },
  });
  assert.equal(await sender.send(web, { kind: "taskEdited", actorName: null, subjectName: "Louça" }), "sent");
  assert.equal(await sender.send(web, { kind: "taskEdited", actorName: "Bia", subjectName: "Louça" }), "sent");
  assert.equal(await sender.send(web, { kind: "dailyTasks", count: 4 }), "sent");
  assert.deepEqual(bodies.map(decrypt), [
    { kind: "taskEdited", key: "push.taskEdited.anon", args: ["Louça"], url: "/app/notifications" },
    { kind: "taskEdited", key: "push.taskEdited", args: ["Bia", "Louça"], url: "/app/notifications" },
    { kind: "dailyTasks", args: [4], url: "/app/tasks" },
  ]);
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(authorization);
  assert.ok(match !== null);
  const [, header, claims, signature, k] = match;
  assert.deepEqual(JSON.parse(Buffer.from(header ?? "", "base64url").toString()), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(Buffer.from(claims ?? "", "base64url").toString()),
    { aud: "https://fcm.example.com", exp: 1_700_000_000 + 12 * 3600, sub: "mailto:reveza@example.com" });
  const point = Buffer.from(k ?? "", "base64url");
  const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(createVerify("SHA256").update(`${header}.${claims}`).verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature ?? "", "base64url")));
});

test("par VAPID que não confere e assunto inválido falham fechado", async () => {
  const a = createECDH("prime256v1"); a.generateKeys();
  const b = createECDH("prime256v1"); b.generateKeys();
  let called = false;
  const sender = new WebPushSender({
    vapidKeys: async () => ({ publicKey: a.getPublicKey().toString("base64url"), privateKey: b.getPrivateKey().toString("base64url") }),
    subject: "https://reveza.app", now: () => 0, http: async () => { called = true; return { ok: true, status: 201, text: async () => "" }; },
  });
  assert.equal(await sender.send(web, { kind: "dailyTasks", count: 1 }), "failed");
  assert.equal(called, false);
  assert.throws(() => new WebPushSender({ vapidKeys: async () => ({ publicKey: "", privateKey: "" }), subject: "reveza", now: () => 0, http: async () => ({ ok: true, status: 201, text: async () => "" }) }));
});

class FakeSender implements PushSender {
  readonly sent: { device: PushDevice; message: PushMessage }[] = [];
  result: PushResult = "sent";
  async send(device: PushDevice, message: PushMessage): Promise<PushResult> {
    this.sent.push({ device, message });
    return this.result;
  }
}

test("virada de ciclo: vai só para o navegador, e só com cycleTurned ligado; APNs igual a antes", async () => {
  const directory = new InMemoryPushDirectory();
  await directory.registerDevice(ana, apns, 1);
  await directory.registerDevice(ana, web, 2);
  const sender = new FakeSender();
  const notifier = new PushNotifier({ directory, sender, names: async () => null });
  const turned = { recipientUserID: ana, kind: "cycleTurned", actorUserID: null, subjectName: "Cozinha" } as const;
  assert.equal(allowsPush(DEFAULT_PREFERENCES, "cycleTurned"), false, "a regra do APNs não mudou");
  assert.equal(await notifier.deliver(turned), 1);
  assert.deepEqual(sender.sent.map((s) => s.device.kind), ["web"]);
  await directory.setPreferences(ana, { ...DEFAULT_PREFERENCES, cycleTurned: false });
  assert.equal(await notifier.deliver(turned), 0);
  await directory.setPreferences(ana, DEFAULT_PREFERENCES);
  assert.equal(await notifier.deliver({ ...turned, kind: "memberJoined" }), 2, "os demais tipos vão aos dois");
  sender.result = "invalidToken";
  await notifier.deliver(turned);
  assert.deepEqual(await directory.devices(ana), [apns], "a inscrição web recusada sai pelo endpoint");
});

test("o APNs nunca envia dailyTasks", async () => {
  let posts = 0;
  const sender = new ApnsPushSender({
    credentials: { keyID: "K", teamID: "T", bundleID: "b", privateKey: "x" }, now: () => 0,
    transport: { post: async () => { posts += 1; return { status: 200 }; } },
  });
  assert.equal(await sender.send(apns, { kind: "dailyTasks", count: 2 }), "failed");
  assert.equal(posts, 0);
});

function claimsContract(name: string, make: () => ReminderClaims): void {
  test(`${name}: um lembrete por morador e dia`, async () => {
    const claims = make();
    assert.equal(await claims.claim(ana, "2026-11-26", 1), true);
    assert.equal(await claims.claim(ana, "2026-11-26", 2), false);
    assert.equal(await claims.claim(bia, "2026-11-26", 3), true);
    assert.equal(await claims.claim(ana, "2026-11-27", 4), true);
  });
}
claimsContract("em memória", () => new InMemoryReminderClaims());
claimsContract("DynamoDB", () => new DynamoReminderClaims({ client: new FakeDynamoClient(), retentionSeconds: 60 }));

test("lembrete diário: só web, na hora local escolhida, com pendências, uma vez por dia", async () => {
  const directory = new InMemoryPushDirectory();
  const sender = new FakeSender();
  const reminder = new DailyTaskReminder({ directory, sender, claims: new InMemoryReminderClaims() });
  const tz = "America/Sao_Paulo";
  const at = (day: number, hour: number) => localToInstant(tz, { year: 2026, month: 11, day, hour, minute: 5 });
  await directory.registerDevice(ana, apns, 1);
  await directory.registerDevice(ana, web, 1);
  await directory.registerDevice(bia, web, 1);
  await directory.setPreferences(bia, { ...DEFAULT_PREFERENCES, remindTasks: false });
  const house = { timezone: tz, members: [{ userID: ana, pending: 3 }, { userID: bia, pending: 2 }] };

  assert.equal(await reminder.remind(house, at(26, 8)), 0, "fora da hora (padrão: 9h)");
  assert.equal(await reminder.remind(house, at(26, 9)), 1);
  assert.deepEqual(sender.sent.map((s) => [s.device.kind, s.message]), [["web", { kind: "dailyTasks", count: 3 }]], "só o navegador; Bia desligou");
  assert.equal(await reminder.remind(house, at(26, 9)), 0, "a rodada repetida não manda de novo");
  assert.equal(await reminder.remind({ timezone: tz, members: [{ userID: ana, pending: 0 }] }, at(27, 9)), 0, "sem pendências, nada");
  assert.equal(await reminder.remind(house, at(28, 9)), 1, "no outro dia, de novo");
});

test("config do Web Push: sem variável escondida e segredo com as duas chaves", () => {
  const env = { TABLE_NAME: "t", SECRET_ID: "s", WEBPUSH_SECRET_ID: "grupuxo/dev/webpush", WEBPUSH_SUBJECT: "mailto:reveza.app@gmail.com" };
  assert.deepEqual(parsePushSettings(env), { tableName: "t", webPush: { secretID: "grupuxo/dev/webpush", subject: "mailto:reveza.app@gmail.com" } });
  assert.deepEqual(parseScheduledSettings({ ...env, SECRET_ID: undefined }).webPush.secretID, "grupuxo/dev/webpush");
  for (const missing of ["WEBPUSH_SECRET_ID", "WEBPUSH_SUBJECT"]) {
    assert.throws(() => parsePushSettings({ ...env, [missing]: undefined }), LambdaConfigError);
  }
  assert.throws(() => parseScheduledSettings({ ...env, WEBPUSH_SUBJECT: "reveza" }), LambdaConfigError);
  assert.deepEqual(parseWebPushSecret(JSON.stringify({ WEBPUSH_VAPID_PUBLIC_KEY: "p", WEBPUSH_VAPID_PRIVATE_KEY: "k" })), { publicKey: "p", privateKey: "k" });
  assert.throws(() => parseWebPushSecret("{}"), LambdaConfigError);
});
