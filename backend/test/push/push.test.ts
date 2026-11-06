import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { test } from "node:test";
import { DynamoPushDirectory } from "../../src/adapters/dynamodb/push-directory.ts";
import { InMemoryPushDirectory } from "../../src/adapters/in-memory/push-directory.ts";
import { roomID, userID } from "../../src/domain/ids.ts";
import { createPushHandler, newNotificationItem } from "../../src/lambdas/push.ts";
import { apnsJwt, apnsPayload, ApnsPushSender } from "../../src/push/apns-sender.ts";
import { PushNotifier } from "../../src/push/notifier.ts";
import { allowsPush, DEFAULT_PREFERENCES, type PushDevice, type PushDirectory, type PushMessage, type PushResult, type PushSender } from "../../src/push/push.ts";
import { FakeDynamoClient } from "../support/fake-dynamo-client.ts";
import { uuid } from "../support/world.ts";

const ana = userID(uuid(1));
const bia = userID(uuid(2));
const token = "cd".repeat(32);

function directoryContract(name: string, make: () => PushDirectory): void {
  test(`${name}: aparelhos e preferências por morador`, async () => {
    const directory = make();
    await directory.registerDevice(ana, { token, environment: "sandbox" }, 1);
    await directory.registerDevice(ana, { token, environment: "production" }, 2);
    await directory.registerDevice(ana, { token: "ef".repeat(32), environment: "sandbox" }, 3);
    assert.equal((await directory.devices(ana)).length, 2);
    assert.deepEqual(await directory.devices(bia), []);
    await directory.removeDevice(ana, token);
    await directory.removeDevice(ana, token);
    assert.deepEqual(await directory.devices(ana), [{ token: "ef".repeat(32), environment: "sandbox" }]);
    assert.deepEqual(await directory.preferences(ana), DEFAULT_PREFERENCES);
    const changed = { ...DEFAULT_PREFERENCES, houseActivity: false, reminderHour: 20 };
    await directory.setPreferences(ana, changed);
    assert.deepEqual(await directory.preferences(ana), changed);
    assert.deepEqual(await directory.preferences(bia), DEFAULT_PREFERENCES);
  });
}
directoryContract("em memória", () => new InMemoryPushDirectory());
directoryContract("DynamoDB", () => new DynamoPushDirectory({ client: new FakeDynamoClient() }));

class FakeSender implements PushSender {
  readonly sent: { device: PushDevice; message: PushMessage }[] = [];
  result: PushResult = "sent";
  async send(device: PushDevice, message: PushMessage): Promise<PushResult> {
    this.sent.push({ device, message });
    return this.result;
  }
}

test("o notificador respeita as preferências, nomeia quem fez e tira token recusado", async () => {
  const directory = new InMemoryPushDirectory();
  const sender = new FakeSender();
  const notifier = new PushNotifier({ directory, sender, names: async (id) => (id === bia ? "Bia" : null) });
  const edited = { recipientUserID: ana, kind: "taskEdited", actorUserID: bia, subjectName: "Louça" } as const;

  assert.equal(await notifier.deliver(edited), 0, "sem aparelho, nada a enviar");
  await directory.registerDevice(ana, { token, environment: "sandbox" }, 1);
  assert.equal(await notifier.deliver(edited), 1);
  assert.deepEqual(sender.sent[0]?.message, { kind: "taskEdited", actorName: "Bia", subjectName: "Louça" });

  await directory.setPreferences(ana, { ...DEFAULT_PREFERENCES, houseActivity: false });
  assert.equal(await notifier.deliver(edited), 0, "atividade da casa desligada");
  assert.equal(await notifier.deliver({ ...edited, kind: "taskSwapRequested" }), 1, "pedido direto sempre chega");

  sender.result = "invalidToken";
  await notifier.deliver({ ...edited, kind: "taskSwapRequested" });
  assert.deepEqual(await directory.devices(ana), [], "o token que o APNs recusou sai");
});

test("allowsPush liga cada tipo à preferência certa", () => {
  const off = { ...DEFAULT_PREFERENCES, cycleTurned: false, houseActivity: false, weeklySummary: false };
  assert.equal(allowsPush(off, "cycleTurned"), false);
  assert.equal(allowsPush(off, "weeklySummaryReady"), false);
  assert.equal(allowsPush(off, "memberJoined"), false);
  assert.equal(allowsPush(off, "roomAccessRequested"), true);
});

test("JWT do APNs é ES256 verificável e o corpo só leva chaves e argumentos (sem frase pronta)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const credentials = { keyID: "KEY1234567", teamID: "TEAM123456", bundleID: "com.reveza.app", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
  const jwt = apnsJwt(credentials, 1_700_000_000_000);
  const [header, claims, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header ?? "", "base64url").toString()), { alg: "ES256", kid: "KEY1234567", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(claims ?? "", "base64url").toString()), { iss: "TEAM123456", iat: 1_700_000_000 });
  assert.ok(createVerify("SHA256").update(`${header}.${claims}`).verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature ?? "", "base64url")));
  const payload: unknown = JSON.parse(apnsPayload({ kind: "taskEdited", actorName: "Bia", subjectName: "Louça" }));
  assert.deepEqual(payload, { aps: { alert: { "loc-key": "push.taskEdited", "loc-args": ["Bia", "Louça"] }, sound: "default" }, kind: "taskEdited" });
});

test("o ApnsPushSender escolhe o host pelo ambiente e traduz o status", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const calls: { host: string; path: string }[] = [];
  let status = 200;
  const sender = new ApnsPushSender({
    credentials: { keyID: "K", teamID: "T", bundleID: "b", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() },
    transport: { post: async (host, path) => { calls.push({ host, path }); return { status }; } }, now: () => 0,
  });
  const message = { kind: "memberLeft", actorName: null, subjectName: "Bia" } as const;
  assert.equal(await sender.send({ token, environment: "sandbox" }, message), "sent");
  assert.equal(await sender.send({ token, environment: "production" }, message), "sent");
  assert.deepEqual(calls.map((c) => c.host), ["api.sandbox.push.apple.com", "api.push.apple.com"]);
  assert.equal(calls[0]?.path, `/3/device/${token}`);
  status = 410;
  assert.equal(await sender.send({ token, environment: "sandbox" }, message), "invalidToken");
  status = 500;
  assert.equal(await sender.send({ token, environment: "sandbox" }, message), "failed");
});

function streamRecord(sk: string, eventName = "INSERT") {
  return {
    eventName,
    dynamodb: {
      SequenceNumber: "100",
      NewImage: {
        PK: { S: `HOUSE#${uuid(9)}` }, SK: { S: sk }, recipientUserID: { S: ana }, kind: { S: "roomDeleted" }, swapRequestID: { NULL: true },
        taskDefinitionID: { NULL: true }, roomID: { S: roomID(uuid(5)) }, actorUserID: { S: bia }, subjectName: { S: "Ateliê" },
        createdAt: { N: "1700000000000" }, readAt: { NULL: true },
      },
    },
  };
}

test("o handler do stream entrega só INSERT de NOTIF# e devolve o registro que falhou", async () => {
  const directory = new InMemoryPushDirectory();
  await directory.registerDevice(ana, { token, environment: "sandbox" }, 1);
  const sender = new FakeSender();
  const failures: string[] = [];
  const handler = createPushHandler(new PushNotifier({ directory, sender, names: async () => "Bia" }), (d) => failures.push(d));
  const record = streamRecord(`NOTIF#${uuid(7)}`);
  assert.ok(newNotificationItem(record) !== null);
  assert.equal(newNotificationItem(streamRecord(`ROOM#${uuid(7)}`)), null);
  assert.equal(newNotificationItem(streamRecord(`NOTIF#${uuid(7)}`, "MODIFY")), null);
  assert.deepEqual(await handler({ Records: [record, streamRecord(`ROOM#${uuid(7)}`), streamRecord(`NOTIF#${uuid(8)}`, "REMOVE")] }), { batchItemFailures: [] });
  assert.equal(sender.sent.length, 1);
  assert.deepEqual(sender.sent[0]?.message, { kind: "roomDeleted", actorName: "Bia", subjectName: "Ateliê" });

  const broken = createPushHandler(new PushNotifier({ directory, sender, names: async () => { throw new Error("falhou"); } }), (d) => failures.push(d));
  assert.deepEqual(await broken({ Records: [record] }), { batchItemFailures: [{ itemIdentifier: "100" }] });
  assert.deepEqual(failures, ["Error"], "só o nome do erro, sem conteúdo");
});
