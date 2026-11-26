import { describe, expect, it } from "vitest";
import { format, type Arg } from "@/i18n/messages";
import type { AppNotification } from "@/lib/api/types";
import type { TextContext } from "@/lib/format/labels";
import {
  elapsed, notificationDays, notificationIcon, notificationLines, notificationMessage, notificationTarget, notificationTint, untilText,
} from "@/features/notifications/text";

const ctx: TextContext = { t: (key: string, ...args: Arg[]) => format("pt-BR", {}, key, args), locale: "pt-BR", timeZone: "America/Sao_Paulo" };
const names = new Map([["aaaaaaaa-0000-0000-0000-000000000001", "Henrique Lacerda"]]);

// 2026-11-26 (quinta) 12:00 em São Paulo.
const created = Date.UTC(2026, 10, 26, 15, 0, 0);

function notification(changes: Partial<AppNotification>): AppNotification {
  return {
    id: "n1", kind: "taskEdited", swapRequestID: null, taskDefinitionID: null, roomID: null, actorUserID: null, subjectName: null,
    roomName: null, taskName: null, dueAt: null, effortFrom: null, effortTo: null, names: [], createdAt: created, readAt: null, ...changes,
  };
}

describe("NotificationText", () => {
  it("monta a frase com quem fez (nome curto) e o assunto", () => {
    const edited = notification({ actorUserID: "AAAAAAAA-0000-0000-0000-000000000001", subjectName: "Lavar a louça" });
    expect(notificationMessage(ctx, edited, names)).toBe("Henrique L. editou a tarefa Lavar a louça.");
    expect(notificationMessage(ctx, notification({ subjectName: "Lavar a louça" }), names)).toBe("Alguém editou a tarefa Lavar a louça.");
    expect(notificationMessage(ctx, notification({}), names)).toBe("Uma tarefa foi editada.");
  });

  it("duas linhas: tarefa e cômodo, esforço de/para, novo ciclo", () => {
    const edited = notification({ subjectName: "Lavar a louça", roomName: "Cozinha" });
    expect(notificationLines(ctx, edited, names)).toEqual({ title: "Alguém editou uma tarefa", detail: "Lavar a louça · Cozinha" });
    const effort = notification({ kind: "effortChanged", subjectName: "Limpar o forno", effortFrom: 1, effortTo: 3 });
    expect(notificationLines(ctx, effort, names).detail).toBe("Limpar o forno: Leve → Intenso");
    // Ciclo semanal: o prazo é a meia-noite de segunda (30/11 03:00 UTC) e o último dia é domingo.
    const cycle = notification({ kind: "cycleTurned", subjectName: "Cozinha", names: ["Julia Carvalho"], dueAt: Date.UTC(2026, 10, 30, 3) });
    expect(notificationLines(ctx, cycle, names)).toEqual({ title: "Novo ciclo: Cozinha", detail: "Você e Julia C. até domingo" });
    const accepted = notification({ kind: "taskSwapAccepted", actorUserID: "aaaaaaaa-0000-0000-0000-000000000001", taskName: "Tirar o lixo" });
    expect(notificationLines(ctx, accepted, names)).toEqual({ title: "Henrique L. aceitou a troca", detail: "Você faz Tirar o lixo." });
    expect(notificationLines(ctx, notification({ kind: "memberJoined", subjectName: "Ana" }), names)).toEqual({ title: "Ana entrou na casa.", detail: null });
  });

  it("prazo além de uma semana vira a data inteira", () => {
    expect(untilText(ctx, Date.UTC(2026, 10, 30, 3), created)).toBe("domingo");
    expect(untilText(ctx, Date.UTC(2026, 11, 7, 3), created)).toBe("6 de dezembro");
  });

  it("ícone, cor e destino", () => {
    expect(notificationIcon("cycleTurned")).toBe("cycle");
    expect(notificationTint("taskDeleted")).toBe("red");
    expect(notificationTarget(notification({ taskDefinitionID: "ABC" }))).toEqual({ kind: "task", id: "abc" });
    expect(notificationTarget(notification({ kind: "cycleTurned", roomID: "R1" }))).toEqual({ kind: "room", id: "r1" });
    expect(notificationTarget(notification({ kind: "taskDeleted", taskDefinitionID: "ABC" }))).toBeNull();
  });

  it("agrupa por dia: Hoje, Ontem e a data", () => {
    const now = created + 3600_000;
    const list = [
      notification({ id: "a", createdAt: created }),
      notification({ id: "b", createdAt: created - 86_400_000 }),
      notification({ id: "c", createdAt: created - 3 * 86_400_000 }),
      notification({ id: "d", createdAt: created }),
    ];
    const days = notificationDays(ctx, list, now);
    expect(days.map((d) => d.title)).toEqual(["Hoje", "Ontem", "23 de novembro"]);
    expect(days[0]?.notifications.map((n) => n.id)).toEqual(["d", "a"]);
  });

  it("tempo relativo", () => {
    expect(elapsed(ctx, created - 5 * 60_000, created)).toBe("há 5 minutos");
  });
});
