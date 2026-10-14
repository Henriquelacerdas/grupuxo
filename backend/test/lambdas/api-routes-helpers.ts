import assert from "node:assert/strict";
import type { HttpApiResult } from "../../src/lambdas/events.ts";
import type { ApiEnv, Who } from "./api-support.ts";

// Ajudantes dos testes das rotas: leitura estreitada do JSON de resposta (sem `as`) e cenários de preparação.

export function rec(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "esperava um objeto");
  return Object.fromEntries(Object.entries(value));
}

export function list(value: unknown): unknown[] {
  assert.ok(Array.isArray(value), "esperava uma lista");
  return [...value];
}

export function text(value: unknown): string {
  assert.equal(typeof value, "string");
  return String(value);
}

export function bodyOf(response: HttpApiResult): Record<string, unknown> {
  return rec(JSON.parse(response.body));
}

/** Confere o status e devolve o corpo; o corpo do 204 é vazio. */
export function expectStatus(response: HttpApiResult, status: number): Record<string, unknown> {
  assert.equal(response.statusCode, status, `status ${response.statusCode}: ${response.body}`);
  return response.body === "" ? {} : bodyOf(response);
}

export function expectError(response: HttpApiResult, status: number, error: string): void {
  assert.deepEqual([response.statusCode, bodyOf(response)], [status, { error }]);
}

export async function register(env: ApiEnv, who: Who, name: string): Promise<string> {
  return text(expectStatus(await env.call(who, "POST", "/v1/me", { body: JSON.stringify({ name }) }), 200)["id"]);
}

export interface CreatedHouse {
  readonly id: string;
  readonly code: string;
  readonly wholeHouseRoomID: string;
}

export async function createHouse(env: ApiEnv, who: Who, name = "Casa de teste"): Promise<CreatedHouse> {
  const created = expectStatus(
    await env.call(who, "POST", "/v1/houses", { body: JSON.stringify({ name, timezone: "America/Sao_Paulo" }) }), 201,
  );
  const house = rec(created["house"]);
  const [room] = list(created["rooms"]);
  return { id: text(house["id"]), code: text(house["accessCode"]), wholeHouseRoomID: text(rec(room)["id"]) };
}

export async function join(env: ApiEnv, who: Who, code: string): Promise<Record<string, unknown>> {
  return expectStatus(await env.call(who, "POST", "/v1/houses/join", { body: JSON.stringify({ code }) }), 200);
}

/** Ana e Bia na mesma casa e Caio em outra, todos com conta. */
export async function twoHousesScenario(env: ApiEnv) {
  const ids = { ana: await register(env, "ana", "Ana"), bia: await register(env, "bia", "Bia"), caio: await register(env, "caio", "Caio") };
  const house = await createHouse(env, "ana", "Casa da Ana");
  await join(env, "bia", house.code);
  const other = await createHouse(env, "caio", "Casa do Caio");
  return { ids, house, other };
}

export async function createRoom(
  env: ApiEnv, who: Who, houseID: string, fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return expectStatus(await env.call(who, "POST", `/v1/houses/${houseID}/rooms`, { body: JSON.stringify(fields) }), 201);
}

export const WEEKLY_TASK = {
  name: "Lavar a louça", details: "Pia e escorredor", effort: 2, kind: "recurring",
  recurrence: { kind: "weekly", periodicity: { executionsPerPeriod: 1, intervalWeeks: 1 } },
  assignmentPolicy: "balancedAutomatically",
} as const;
