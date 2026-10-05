import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryStore } from "../../src/adapters/in-memory/store.ts";
import { InMemoryUserDirectory } from "../../src/adapters/in-memory/user-directory.ts";
import { userID } from "../../src/domain/ids.ts";
import type { StoreState } from "../../src/domain/store-state.ts";
import { cognitoSub, userDirectoryContract } from "../contract/user-directory.ts";
import { sequentialIDs } from "../support/state-json.ts";
import { uuid } from "../support/world.ts";

function emptyState(): StoreState {
  return {
    users: [], houses: [], taskSwapRequests: [], notifications: [],
    rooms: [], houseMemberships: [], roomMemberships: [], definitions: [], occurrences: [], assignments: [], absences: [],
  };
}

userDirectoryContract("em memória", () => new InMemoryUserDirectory(new InMemoryStore(emptyState()), sequentialIDs()));

test("em memória: o morador criado entra na lista de usuários do domínio, sem e-mail", async () => {
  const store = new InMemoryStore(emptyState());
  const directory = new InMemoryUserDirectory(store, sequentialIDs());
  const id = await directory.ensureUser(cognitoSub("conta-1"), { name: "Ana" });
  await directory.ensureUser(cognitoSub("conta-1"), { name: "Ana" });
  assert.deepEqual(store.read((state) => state.users), [{ id, name: "Ana", email: null }]);
});

test("em memória: contas conhecidas já resolvem para o morador do seed", async () => {
  const marina = userID(uuid(1));
  const directory = new InMemoryUserDirectory(new InMemoryStore(emptyState()), sequentialIDs(), [[cognitoSub("conta-marina"), marina]]);
  assert.equal(await directory.userForSub(cognitoSub("conta-marina")), marina);
  assert.equal(await directory.ensureUser(cognitoSub("conta-marina"), { name: "Marina" }), marina);
});
