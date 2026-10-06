import assert from "node:assert/strict";
import { test } from "node:test";
import { invocationKey, MAX_ROOM_NAME_CHARS, normalizeRoomName, parseToolCall, resolveRoom } from "../../src/assistant/read-tools.ts";
import type { Room } from "../../src/domain/entities.ts";
import { houseID, roomID } from "../../src/domain/ids.ts";
import { weeklyPeriodicity } from "../../src/domain/value-objects.ts";
import { uuid } from "../support/world.ts";

function room(n: number, name: string): Room {
  return {
    id: roomID(uuid(n)), houseID: houseID(uuid(900)), name, kind: "standard", category: "other", visibility: "common",
    periodicity: weeklyPeriodicity(), responsibleCount: 1, calendarAnchor: null, scheduleVersions: [], icon: "x", color: "blue",
  };
}

// --- parseToolCall: o modelo é entrada não confiável ---

test("list_my_tasks: range válido, ausente (semana) e inválido", () => {
  assert.deepEqual(parseToolCall("list_my_tasks", { range: "week" }), { ok: true, invocation: { tool: "list_my_tasks", range: "week" } });
  assert.deepEqual(parseToolCall("list_my_tasks", { range: "all" }), { ok: true, invocation: { tool: "list_my_tasks", range: "all" } });
  assert.deepEqual(parseToolCall("list_my_tasks", {}), { ok: true, invocation: { tool: "list_my_tasks", range: "week" } });
  assert.deepEqual(parseToolCall("list_my_tasks", undefined), { ok: true, invocation: { tool: "list_my_tasks", range: "week" } });
  for (const range of ["month", "WEEK", "Week", "", " week", "all ", 1, null, true, ["week"], { value: "week" }]) {
    assert.deepEqual(parseToolCall("list_my_tasks", { range }), { ok: false, problem: "invalid_range" }, String(range));
  }
});

test("list_room_tasks: room_name é texto de 1 a 80 caracteres, sem espaços nas pontas", () => {
  assert.deepEqual(parseToolCall("list_room_tasks", { room_name: "  Cozinha " }), { ok: true, invocation: { tool: "list_room_tasks", roomName: "Cozinha" } });
  assert.deepEqual(parseToolCall("list_room_tasks", { room_name: "é".repeat(MAX_ROOM_NAME_CHARS) }).ok, true);
  for (const room_name of [undefined, null, 42, "", "   ", "\n", ["Cozinha"], { name: "x" }, "a".repeat(MAX_ROOM_NAME_CHARS + 1)]) {
    assert.deepEqual(parseToolCall("list_room_tasks", { room_name }), { ok: false, problem: "invalid_room_name" }, String(room_name));
  }
  assert.deepEqual(parseToolCall("list_room_tasks", {}), { ok: false, problem: "invalid_room_name" });
  assert.deepEqual(parseToolCall("list_room_tasks", "Cozinha"), { ok: false, problem: "invalid_room_name" });
});

test("ferramenta desconhecida é recusada, inclusive nomes que parecem ferramentas de escrita", () => {
  for (const name of ["", "complete_task", "list_tasks_of_user", "LIST_MY_TASKS", "list_my_tasks ", "__proto__", "constructor", "toString"]) {
    assert.deepEqual(parseToolCall(name, {}), { ok: false, problem: "unknown_tool" }, name);
  }
});

test("argumentos que o modelo inventa (usuário, casa) são ignorados", () => {
  const injected = { range: "all", user_id: uuid(7), userID: uuid(7), house_id: uuid(8), houseID: uuid(8) };
  assert.deepEqual(parseToolCall("list_my_tasks", injected), { ok: true, invocation: { tool: "list_my_tasks", range: "all" } });
  assert.deepEqual(parseToolCall("list_sporadic_tasks", injected), { ok: true, invocation: { tool: "list_sporadic_tasks" } });
  assert.deepEqual(
    parseToolCall("list_room_tasks", { room_name: "Sala", user_id: uuid(7) }),
    { ok: true, invocation: { tool: "list_room_tasks", roomName: "Sala" } },
  );
});

test("chaves herdadas do protótipo não são lidas como argumento", () => {
  const args = Object.create({ range: "all", room_name: "Sala" }) as unknown;
  assert.deepEqual(parseToolCall("list_my_tasks", args), { ok: true, invocation: { tool: "list_my_tasks", range: "week" } });
  assert.deepEqual(parseToolCall("list_room_tasks", args), { ok: false, problem: "invalid_room_name" });
});

test("a chave da chamada ignora caixa, acento e artigo, para não responder duas vezes à mesma consulta", () => {
  const key = (roomName: string) => invocationKey({ tool: "list_room_tasks", roomName });
  assert.equal(key("Cozinha"), key("  a cozinha"));
  assert.equal(key("Cozinha"), key("COZINHA"));
  assert.notEqual(key("Cozinha"), key("Sala"));
  assert.notEqual(invocationKey({ tool: "list_my_tasks", range: "week" }), invocationKey({ tool: "list_my_tasks", range: "all" }));
});

// --- resolveRoom ---

test("normalização: caixa, acentos, espaços repetidos e artigo inicial", () => {
  assert.equal(normalizeRoomName("  A  Lavanderia "), "lavanderia");
  assert.equal(normalizeRoomName("Escritório"), "escritorio");
  assert.equal(normalizeRoomName("ESCRITÓRIO privado"), "escritorio privado");
  assert.equal(normalizeRoomName("o"), "o");
});

test("resolve por igualdade normalizada", () => {
  const rooms = [room(1, "Cozinha"), room(2, "Escritório privado"), room(3, "Sala")];
  assert.deepEqual(resolveRoom(rooms, "cozinha"), { kind: "found", room: rooms[0] });
  assert.deepEqual(resolveRoom(rooms, "A COZINHA"), { kind: "found", room: rooms[0] });
  assert.deepEqual(resolveRoom(rooms, "escritorio privado"), { kind: "found", room: rooms[1] });
});

test("nomes iguais são desempatados pelo menor ID, qualquer que seja a ordem da lista", () => {
  const a = room(5, "Quarto");
  const b = room(2, "quarto");
  const c = room(9, "Quarto");
  for (const rooms of [[a, b, c], [c, b, a], [b, c, a]]) assert.deepEqual(resolveRoom(rooms, "quarto"), { kind: "found", room: b });
});

test("igualdade vence a busca parcial", () => {
  const rooms = [room(1, "Banheiro social"), room(2, "Banheiro")];
  assert.deepEqual(resolveRoom(rooms, "banheiro"), { kind: "found", room: rooms[1] });
});

test("busca parcial: um único nome combina; nomes diferentes são ambíguos; nome curto demais não combina", () => {
  assert.deepEqual(resolveRoom([room(1, "Banheiro social"), room(2, "Sala")], "banheiro"), { kind: "found", room: room(1, "Banheiro social") });
  const ambiguous = resolveRoom([room(3, "Banheiro suíte"), room(1, "Banheiro social"), room(2, "Sala")], "banheiro");
  assert.deepEqual(ambiguous, { kind: "ambiguous", rooms: [room(1, "Banheiro social"), room(3, "Banheiro suíte")] });
  assert.deepEqual(resolveRoom([room(1, "Banheiro social")], "ba"), { kind: "notFound" });
  assert.deepEqual(resolveRoom([room(1, "Cozinha")], "garagem"), { kind: "notFound" });
  assert.deepEqual(resolveRoom([], "cozinha"), { kind: "notFound" });
  assert.deepEqual(resolveRoom([room(1, "Cozinha")], "a"), { kind: "notFound" });
});

test("o nome pedido pode conter o do cômodo (\"cozinha da casa\")", () => {
  assert.deepEqual(resolveRoom([room(1, "Cozinha")], "cozinha da casa"), { kind: "found", room: room(1, "Cozinha") });
});
