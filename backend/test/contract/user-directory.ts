import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCognitoSub, type CognitoSub } from "../../src/auth/token-verifier.ts";
import { UserDirectoryError, type UserDirectory } from "../../src/auth/user-directory.ts";
import { userID } from "../../src/domain/ids.ts";

// Contrato do `UserDirectory`: o adaptador DynamoDB (`Put` condicional em `COGNITO#<sub>`) deve passar nos
// mesmos testes, inclusive os concorrentes. Cada teste usa uma instância nova.

export function cognitoSub(value: string): CognitoSub {
  const parsed = parseCognitoSub(value);
  assert.ok(parsed !== null, `sub inválido no teste: ${value}`);
  return parsed;
}

const invalidProfile = (error: unknown) => error instanceof UserDirectoryError && error.code === "invalidProfile";

export function userDirectoryContract(name: string, make: () => UserDirectory): void {
  const ana = cognitoSub("11111111-1111-4111-8111-111111111111");
  const bia = cognitoSub("22222222-2222-4222-8222-222222222222");

  test(`${name}: conta desconhecida não tem morador`, async () => {
    assert.equal(await make().userForSub(ana), null);
  });

  test(`${name}: ensureUser cria o morador uma vez e é idempotente`, async () => {
    const directory = make();
    const first = await directory.ensureUser(ana, { name: "Ana" });
    assert.equal(await directory.ensureUser(ana, { name: "Ana" }), first);
    assert.equal(await directory.userForSub(ana), first);
  });

  test(`${name}: contas diferentes viram moradores diferentes`, async () => {
    const directory = make();
    const first = await directory.ensureUser(ana, { name: "Ana" });
    const second = await directory.ensureUser(bia, { name: "Bia" });
    assert.notEqual(first, second);
    assert.equal(await directory.userForSub(bia), second);
  });

  test(`${name}: o sub distingue maiúsculas de minúsculas`, async () => {
    const directory = make();
    const lower = await directory.ensureUser(cognitoSub("abc"), { name: "Minúsculo" });
    const upper = await directory.ensureUser(cognitoSub("ABC"), { name: "Maiúsculo" });
    assert.notEqual(lower, upper);
  });

  test(`${name}: o perfil de uma conta existente não é sobrescrito`, async () => {
    const directory = make();
    const first = await directory.ensureUser(ana, { name: "Ana" });
    assert.equal(await directory.ensureUser(ana, { name: "Outro nome" }), first);
  });

  test(`${name}: perfil inválido é recusado, exista a conta ou não`, async () => {
    const directory = make();
    const invalidNames = ["", "   ", " Ana", "Ana ", "A\nna", "x".repeat(81)];
    for (const invalid of invalidNames) await assert.rejects(directory.ensureUser(ana, { name: invalid }), invalidProfile);
    assert.equal(await directory.userForSub(ana), null);
    await directory.ensureUser(ana, { name: "Ana" });
    await assert.rejects(directory.ensureUser(ana, { name: "" }), invalidProfile);
    await directory.ensureUser(bia, { name: "x".repeat(80) });
  });

  test(`${name}: ensureUser concorrente da mesma conta resulta num único morador`, async () => {
    const directory = make();
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => directory.ensureUser(ana, { name: `Ana ${index}` })));
    assert.equal(new Set(results).size, 1);
    assert.equal(await directory.userForSub(ana), results[0]);
  });

  test(`${name}: ensureUser concorrente de contas diferentes não mistura moradores`, async () => {
    const directory = make();
    const subs = Array.from({ length: 10 }, (_, index) => cognitoSub(`conta-${index}`));
    const results = await Promise.all(subs.map((sub) => directory.ensureUser(sub, { name: "Morador" })));
    assert.equal(new Set(results).size, subs.length);
  });

  test(`${name}: deleteUser apaga a conta, é idempotente e a mesma conta recomeça com outro morador`, async () => {
    const directory = make();
    const first = await directory.ensureUser(ana, { name: "Ana" });
    const other = await directory.ensureUser(bia, { name: "Bia" });
    await directory.deleteUser(ana);
    await directory.deleteUser(ana);
    assert.equal(await directory.userForSub(ana), null);
    assert.equal(await directory.userForSub(bia), other);
    const again = await directory.ensureUser(ana, { name: "Ana" });
    assert.notEqual(again, first);
  });

  test(`${name}: updateName recusa nome inválido e ignora morador sem perfil`, async () => {
    const directory = make();
    const id = await directory.ensureUser(ana, { name: "Ana" });
    for (const invalid of ["", "   ", " Ana", "Ana ", "A\nna", "x".repeat(81)]) {
      await assert.rejects(directory.updateName(id, invalid), invalidProfile);
    }
    await directory.updateName(id, "Ana Maria");
    await directory.updateName(id, "Ana Maria");
    await directory.updateName(userID("33333333-3333-4333-8333-333333333333"), "Ninguém");
    assert.equal(await directory.userForSub(ana), id);
  });
}
