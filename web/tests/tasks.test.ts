import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decode } from "@/lib/api/decode";
import { roomDecoder, snapshotDecoder, taskItemDecoder, type Room, type TaskItem, type User } from "@/lib/api/types";
import { applyChange, canSave, createInput, editChanges, editDraft, newDraft, selectRecurrence, setFollowsRoom, type DraftContext } from "@/features/tasks/draft";
import { itemsOf, overview, queuePosition, upcomingQueue } from "@/features/tasks/detail";
import { NO_COMPLETIONS, acceptReload, applyToSnapshot, begin, finish } from "@/features/tasks/optimistic";
import { NO_STAGING, canClaim, canManage, canRelease, hasChanges, holder, prune, stageClaim, stageRelease, writePlan } from "@/features/tasks/sporadic";
import { candidateGroups } from "@/features/tasks/swap";

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, "../../backend/test/fixtures/api", name), "utf8"));
const base = decode(taskItemDecoder, fixture("task-item.json"));
const baseRoom = decode(roomDecoder, fixture("room.json"));
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const user = (id: string, name: string): User => ({ id, name, photoURL: null });

function item(id: string, patch: { availableAt?: number; status?: "available" | "assigned" | "completed"; completedAt?: number | null; holder?: string | null; effort?: number; name?: string; definitionID?: string } = {}): TaskItem {
  const holderID = patch.holder === undefined ? ME : patch.holder;
  return {
    ...base,
    definition: { ...base.definition, id: patch.definitionID ?? base.definition.id, name: patch.name ?? base.definition.name },
    occurrence: {
      ...base.occurrence, id, availableAt: patch.availableAt ?? 0, status: patch.status ?? (holderID === null ? "available" : "assigned"),
      completedAt: patch.completedAt ?? null, effort: patch.effort ?? base.occurrence.effort,
    },
    assignment: holderID === null ? null : { id: `a-${id}`, userID: holderID, assignedAt: 0, endedAt: null },
    assignee: holderID === null ? null : user(holderID, holderID === ME ? "Marina Souza" : "Julia Costa"),
  };
}

describe("prévia de conclusão", () => {
  it("inverte, restaura em falha e só limpa depois da última escrita", () => {
    const a = item("a");
    const b = item("b");
    let state = begin(NO_COMPLETIONS, a, ME, 10);
    state = begin(state, b, ME, 11);
    expect(state.overrides.get("a")?.occurrence.status).toBe("completed");
    expect(state.overrides.get("a")?.occurrence.completedByUserID).toBe(ME);
    state = finish(state, "a");
    expect(acceptReload(state)).toBe(state); // "b" ainda grava
    state = finish(state, "b", b);
    expect(state.overrides.get("b")).toBe(b); // falhou: volta ao que era
    expect(acceptReload(state)).toBe(NO_COMPLETIONS);
  });

  it("aplica em todas as listas do snapshot", () => {
    const snapshot = decode(snapshotDecoder, fixture("house-snapshot.json"));
    const target = snapshot.myTasks[0];
    if (target === undefined) return;
    const applied = applyToSnapshot(begin(NO_COMPLETIONS, target, ME, 5), snapshot);
    const after = applied.myTasks[0];
    expect(after?.occurrence.status).toBe(target.occurrence.status === "completed" ? "assigned" : "completed");
    expect(applyToSnapshot(NO_COMPLETIONS, snapshot)).toBe(snapshot);
  });
});

describe("tarefas únicas", () => {
  it("marca e desmarca sem enviar; devoluções antes das atribuições", () => {
    let s = stageClaim(NO_STAGING, "x");
    expect(hasChanges(s)).toBe(true);
    s = stageRelease(s, "x"); // desfaz a escolha
    expect(hasChanges(s)).toBe(false);
    s = stageRelease(s, "mine");
    s = stageClaim(s, "mine"); // cancela a devolução
    expect(hasChanges(s)).toBe(false);
    s = stageClaim(stageRelease(stageClaim(NO_STAGING, "z"), "y"), "w");
    expect(writePlan(s)).toEqual({ releases: ["y"], claims: ["w", "z"] });
    expect(prune(s, new Set(["w"]))).toEqual({ claims: new Set(["w"]), releases: new Set() });
  });

  it("quem pode pegar, devolver e gerenciar", () => {
    const free = item("free", { holder: null });
    const mine = item("mine");
    const theirs = item("theirs", { holder: OTHER });
    expect(canClaim(NO_STAGING, free, true)).toBe(true);
    expect(canClaim(NO_STAGING, free, false)).toBe(false);
    expect(canClaim(NO_STAGING, theirs, true)).toBe(false);
    expect(canRelease(NO_STAGING, mine, ME)).toBe(true);
    const staged = stageRelease(NO_STAGING, "mine");
    expect(canClaim(staged, mine, true)).toBe(true);
    expect(canManage(staged, mine, ME)).toBe(false);
    expect(holder(staged, mine, ME)).toBeNull();
    expect(holder(stageClaim(NO_STAGING, "free"), free, ME)).toEqual({ kind: "you" });
    expect(holder(NO_STAGING, theirs, ME)).toEqual({ kind: "other", name: "Julia Costa" });
  });
});

describe("detalhe da tarefa", () => {
  it("vez atual é a sua; fila de uma volta sem repetir pessoa", () => {
    const now = 1_000;
    const items = [
      item("1", { availableAt: 1_500, holder: OTHER }),
      item("2", { availableAt: 200 }),
      item("3", { availableAt: 2_000 }),
      item("4", { availableAt: 3_000, holder: OTHER }),
      item("5", { availableAt: 4_000 }),
      item("0", { availableAt: 50, status: "completed", completedAt: 60 }),
    ];
    const result = overview(items, ME, now);
    expect(result.current?.occurrence.id).toBe("2");
    expect(result.lastCompleted?.occurrence.id).toBe("0");
    const queue = upcomingQueue(items, now);
    // Volta só até a pessoa da vez atual reaparecer depois de outra.
    expect(queue.map((q) => q.occurrenceID)).toEqual(["2", "1"]);
    expect(queuePosition(queue, 0)).toBe("current");
    expect(queuePosition(queue, 1)).toBe("next");
    const repeated = upcomingQueue([item("p", { availableAt: 10 }), item("q", { availableAt: 20 }), item("r", { availableAt: 3_000, holder: OTHER })], now);
    expect(repeated.map((q) => q.occurrenceID)).toEqual(["p", "r"]);
  });

  it("acha as ocorrências da definição sem repetir", () => {
    const snapshot = decode(snapshotDecoder, fixture("house-snapshot.json"));
    const first = snapshot.myTasks[0] ?? snapshot.roomTasks[0];
    if (first === undefined) return;
    const found = itemsOf(snapshot, first.definition.id.toUpperCase());
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found.map((i) => i.occurrence.id)).size).toBe(found.length);
  });
});

describe("troca", () => {
  it("mesmo esforço primeiro, depois do mais leve ao mais intenso", () => {
    const offered = item("o", { effort: 2 });
    const groups = candidateGroups(offered, [item("c", { effort: 3, name: "B" }), item("a", { effort: 1 }), item("b", { effort: 2, name: "A" })]);
    expect(groups.map((g) => [g.effort, g.isSameEffort])).toEqual([[2, true], [1, false], [3, false]]);
  });
});

describe("rascunho da tarefa", () => {
  const room: Room = { ...baseRoom, id: "room", kind: "standard", periodicity: { executionsPerPeriod: 1, intervalWeeks: 1 } };
  const whole: Room = { ...baseRoom, id: "whole", kind: "wholeHouse", periodicity: { executionsPerPeriod: 1, intervalWeeks: 1 } };
  const ctx: DraftContext = { rooms: [room, whole], isEditing: false };

  it("cria acompanhando o cômodo; única cai em Casa toda", () => {
    const draft = newDraft(ctx, "room");
    expect(draft.recurrence).toEqual({ kind: "weekly", periodicity: room.periodicity });
    const unique = applyChange(newDraft(ctx, null), { ...newDraft(ctx, null), kind: "sporadic" }, ctx);
    expect(unique).toMatchObject({ kind: "sporadic", roomID: "whole", assignmentPolicy: "selfAssigned", recurrence: { kind: "none" } });
    expect(canSave({ ...draft, name: "  " }, draft, false)).toBe(false);
    expect(canSave({ ...draft, name: "Lavar" }, draft, false)).toBe(true);
  });

  it("repetição própria vira afterCompletion e nunca usa a periodicidade do cômodo", () => {
    const own = setFollowsRoom({ ...newDraft(ctx, "room"), name: "Limpar" }, false, ctx);
    expect(own.recurrence).toEqual({ kind: "recurring", frequency: "weekly", interval: 2 });
    const monthly = selectRecurrence(own, { kind: "recurring", frequency: "monthly", interval: 1 }, ctx);
    expect(createInput(monthly)).toMatchObject({ assignmentPolicy: "afterCompletion", followsRoom: false, recurrence: { frequency: "monthly" } });
    expect(createInput(newDraft(ctx, "room"))).toMatchObject({ assignmentPolicy: "balancedAutomatically", followsRoom: true });
  });

  it("edição manda só o que mudou", () => {
    const definition = { ...base.definition, roomID: "room", kind: "recurring" as const, assignmentPolicy: "balancedAutomatically" as const, followsRoom: true, effort: 1, recurrence: { kind: "weekly" as const, periodicity: room.periodicity } };
    const editCtx = { ...ctx, isEditing: true };
    const initial = editDraft(definition, editCtx);
    expect(canSave(initial, initial, true)).toBe(false);
    expect(editChanges(definition, initial, { ...initial, effort: 3 })).toEqual({ name: definition.name, details: definition.details, effort: 3 });
    const switched = setFollowsRoom(initial, false, editCtx);
    expect(editChanges(definition, initial, switched)).toMatchObject({ followsRoom: false, recurrence: { kind: "recurring" } });
  });
});
