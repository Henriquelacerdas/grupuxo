import { describe, expect, it } from "vitest";
import en from "@/i18n/catalog.en.json";
import { WEB_EN } from "@/i18n/web-strings";
import { ROOM_ICON_CHOICES } from "@/components/icons";
import {
  COLOR_NAMES, ICON_NAMES, appearanceSuggestion, clampDraft, createInput, cycleKindOf, draftFrom, intervalWeeksFor, isEmptyChange, newDraft, roomChanges,
} from "@/features/rooms/appearance";
import { cycleAssignees, includes, roomSections } from "@/features/rooms/detail-sections";
import { applyRoomOrder, move } from "@/features/house/order";
import { attemptLeave, firstLeaveStep } from "@/features/house/leave";
import { inviteText, inviteURL } from "@/features/house/invite";
import { ApiError } from "@/lib/client/http";
import type { Room, TaskItem } from "@/lib/api/types";

const room: Room = {
  id: "r1", houseID: "h1", name: "Cozinha", kind: "standard", category: "kitchen", visibility: "common",
  periodicity: { executionsPerPeriod: 1, intervalWeeks: 1 }, responsibleCount: 1, calendarAnchor: null, icon: "cup.and.saucer.fill", color: "orange",
};

function item(id: string, options: Partial<{ followsRoom: boolean; kind: "recurring" | "sporadic"; availableAt: number; assignee: string | null }> = {}): TaskItem {
  const assignee = options.assignee === undefined ? null : options.assignee;
  return {
    definition: {
      id: `d-${id}`, roomID: "r1", name: id, details: "", effort: 1, kind: options.kind ?? "recurring",
      recurrence: { kind: "weekly", periodicity: { executionsPerPeriod: 1, intervalWeeks: 1 } }, assignmentPolicy: "balancedAutomatically",
      calendarAnchor: null, endedAt: null, createdByUserID: null, followsRoom: options.followsRoom ?? true,
    },
    occurrence: { id: `o-${id}`, taskDefinitionID: `d-${id}`, availableAt: options.availableAt ?? 0, dueAt: null, status: "assigned", completedAt: null, completedByUserID: null, effort: 1 },
    assignment: assignee === null ? null : { id: `a-${id}`, userID: assignee, assignedAt: 0, endedAt: null },
    assignee: assignee === null ? null : { id: assignee, name: assignee.toUpperCase(), photoURL: null },
    suggestedAssignee: null,
  };
}

describe("aparência do cômodo", () => {
  it("sugere ícone, cor e categoria pelo nome, sem acento nem maiúscula", () => {
    expect(appearanceSuggestion("Escritório")).toEqual({ icon: "desktopcomputer", color: "cyan", category: "office" });
    expect(appearanceSuggestion("BANHEIRO social")).toEqual({ icon: "toilet.fill", color: "cyan", category: "bathroom" });
    expect(appearanceSuggestion("Área de serviço")?.category).toBe("laundry");
    expect(appearanceSuggestion("Sótão")).toBeNull();
  });

  it("ciclo do design ↔ semanas", () => {
    expect([1, 2, 4, 3].map(cycleKindOf)).toEqual(["weekly", "biweekly", "monthly", "custom"]);
    expect(intervalWeeksFor("monthly", 9)).toBe(4);
    expect(intervalWeeksFor("custom", 20)).toBe(12);
    expect(intervalWeeksFor("custom", 0)).toBe(1);
  });

  it("pessoas por ciclo ficam entre 1 e quem participa", () => {
    const draft = { ...newDraft("me"), responsibleCount: 9 };
    expect(clampDraft(draft, 3).responsibleCount).toBe(3);
    expect(clampDraft({ ...draft, visibility: "privateRoom" }, 3).responsibleCount).toBe(1);
    expect(clampDraft({ ...draft, name: "x".repeat(40) }, 3).name).toHaveLength(30);
  });

  it("participantes só vão no cômodo privado", () => {
    expect(createInput({ ...newDraft("ME"), name: " Sala " })).not.toHaveProperty("participantIDs");
    expect(createInput({ ...newDraft("ME"), visibility: "privateRoom", participantIDs: ["ME", "B"] }).participantIDs).toEqual(["me", "b"]);
  });

  it("editar manda só o que mudou", () => {
    expect(isEmptyChange(roomChanges(draftFrom(room), room))).toBe(true);
    expect(roomChanges({ ...draftFrom(room), name: "Copa ", periodicity: { executionsPerPeriod: 1, intervalWeeks: 2 } }, room))
      .toEqual({ name: "Copa", periodicity: { executionsPerPeriod: 1, intervalWeeks: 2 } });
  });

  it("nomes de cor e ícone têm inglês", () => {
    const english: Record<string, unknown> = { ...en, ...WEB_EN };
    for (const key of [...Object.values(COLOR_NAMES), ...ROOM_ICON_CHOICES.map((icon) => ICON_NAMES[icon] ?? "?")]) expect(english).toHaveProperty([key]);
  });
});

describe("tela do cômodo", () => {
  const tz = "America/Sao_Paulo";
  const monday = Date.UTC(2026, 10, 23, 15); // segunda, 23/11/2026, 12:00 em São Paulo

  it("Agora mostra o que abre até domingo; Todas mostra tudo", () => {
    expect(includes("now", monday + 6 * 86_400_000, monday, tz)).toBe(true);
    expect(includes("now", monday + 7 * 86_400_000, monday, tz)).toBe(false);
    expect(includes("all", monday + 30 * 86_400_000, monday, tz)).toBe(true);
  });

  it("separa ciclo, repetição própria e únicas", () => {
    const sections = roomSections(room, [item("a"), item("b", { followsRoom: false })], [item("c", { kind: "sporadic" })], "all", monday, tz);
    expect(sections.cycle.map((i) => i.definition.name)).toEqual(["a"]);
    expect(sections.general.map((i) => i.definition.name)).toEqual(["b"]);
    expect(sections.single.map((i) => i.definition.name)).toEqual(["c"]);
  });

  it("responsáveis do ciclo sem repetir, por ID", () => {
    expect(cycleAssignees(room, [item("a", { assignee: "z" }), item("b", { assignee: "b" }), item("c", { assignee: "z" })]).map((u) => u.id)).toEqual(["b", "z"]);
  });
});

describe("casa", () => {
  it("reordena só os cômodos de que participa, mantendo os restritos no lugar", () => {
    const rows = [{ id: "a", m: true }, { id: "x", m: false }, { id: "b", m: true }, { id: "c", m: true }];
    expect(applyRoomOrder(rows, (r) => r.m, ["c", "a"]).map((r) => r.id)).toEqual(["c", "x", "a", "b"]);
    expect(applyRoomOrder(rows, (r) => r.m, []).map((r) => r.id)).toEqual(["a", "x", "b", "c"]);
    expect(move(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(move(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("sair da casa traduz os 409 em confirmações", async () => {
    const failing = (code: string) => async () => { throw new ApiError(409, code); };
    expect(await attemptLeave(failing("room_deletion_confirmation_required"), { confirmRoomDeletion: false, confirmHouseDeletion: false })).toEqual({ kind: "confirmRooms" });
    expect(await attemptLeave(failing("house_deletion_confirmation_required"), { confirmRoomDeletion: true, confirmHouseDeletion: false })).toEqual({ kind: "confirmHouse" });
    const calls: [boolean, boolean][] = [];
    expect(await attemptLeave(async (r, h) => { calls.push([r, h]); }, { confirmRoomDeletion: true, confirmHouseDeletion: true })).toEqual({ kind: "left" });
    expect(calls).toEqual([[true, true]]);
    expect((await attemptLeave(failing("conflict"), { confirmRoomDeletion: false, confirmHouseDeletion: false })).kind).toBe("failed");
    expect(firstLeaveStep(1)).toBe("confirmHouse");
    expect(firstLeaveStep(3)).toBe("confirmLeave");
  });

  it("convite com o texto do app e o link do web", () => {
    const t = (key: string, ...args: (string | number)[]) => key.replace(/\{(\d)\}/g, (_, i: string) => String(args[Number(i)]));
    const house = { id: "h", name: "Rep", accessCode: "abc123", timezone: "UTC", createdAt: 0 };
    expect(inviteText(t, house)).toBe("Entre na casa \"Rep\" no Reveza com o código abc123.");
    expect(inviteURL("https://reveza.app", "abc123")).toBe("https://reveza.app/invite/ABC123");
  });
});
