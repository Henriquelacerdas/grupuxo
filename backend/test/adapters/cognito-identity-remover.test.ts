import assert from "node:assert/strict";
import { test } from "node:test";
import { CognitoIdentityRemover, IdentityRemoveError } from "../../src/adapters/aws/cognito-identity-remover.ts";
import { FakeCognitoClient } from "./support.ts";

test("apaga o usuário pelo username recebido", async () => {
  const client = new FakeCognitoClient();
  await new CognitoIdentityRemover(client).deleteIdentity("signinwithapple_001234.abcdef.5678");
  assert.deepEqual(client.deleted, ["signinwithapple_001234.abcdef.5678"]);
});

test("username fora do formato não chega ao cliente", async () => {
  const client = new FakeCognitoClient();
  const remover = new CognitoIdentityRemover(client);
  for (const username of ["", "com espaço", "x".repeat(129), "linha\nnova"]) {
    await assert.rejects(remover.deleteIdentity(username), (error: unknown) => error instanceof IdentityRemoveError && error.code === "invalidUsername");
  }
  assert.deepEqual(client.deleted, []);
});

test("a falha vira erro de mensagem fixa, só com o name do original", async () => {
  const client = new FakeCognitoClient();
  const original = new Error("senha: hunter2, usuário ana@example.com");
  original.name = "NotAuthorizedException";
  client.failWith = original;
  await assert.rejects(new CognitoIdentityRemover(client).deleteIdentity("11111111-aaaa-4aaa-8aaa-000000000001"), (error: unknown) => {
    assert.ok(error instanceof IdentityRemoveError);
    assert.equal(error.code, "removeFailed");
    assert.equal(error.causeName, "NotAuthorizedException");
    assert.ok(!error.message.includes("hunter2") && !error.message.includes("ana@") && !error.message.includes("11111111"));
    return true;
  });
});
