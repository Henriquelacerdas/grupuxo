import assert from "node:assert/strict";
import { test } from "node:test";
import { dynamoApiEnv, inMemoryApiEnv } from "./api-support.ts";
import { expectError, expectStatus, list, rec, twoHousesScenario } from "./api-routes-helpers.ts";

for (const factory of [inMemoryApiEnv, dynamoApiEnv]) {
  test(`${factory.name}: snapshot exige sessão e conta e não mistura casas`, async () => {
    const env = factory();
    expectError(await env.call(null, "GET", "/v1/me/house/snapshot"), 401, "unauthorized");
    expectError(await env.call("ana", "GET", "/v1/me/house/snapshot"), 403, "account_not_registered");
    const { ids, house, other } = await twoHousesScenario(env);
    const snapshot = expectStatus(await env.call("ana", "GET", "/v1/me/house/snapshot"), 200);
    assert.equal(snapshot["userID"], ids.ana);
    assert.equal(rec(rec(snapshot["home"])["house"])["id"], house.id);
    assert.ok(list(rec(snapshot["home"])["rooms"]).every((room) => rec(room)["houseID"] !== other.id));
    expectStatus(await env.call("ana", "DELETE", "/v1/me/house"), 204);
    expectError(await env.call("ana", "GET", "/v1/me/house/snapshot"), 404, "no_house");
  });
}
