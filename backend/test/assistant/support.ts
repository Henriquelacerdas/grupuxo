import { InMemoryPendingActionStore } from "../../src/adapters/in-memory/pending-actions.ts";
import type { Env } from "../support/world.ts";
import { CompleteTaskUseCase, GetMyTasksUseCase, GetRoomTasksUseCase, GetSporadicTasksUseCase } from "../../src/domain/use-cases/tasks.ts";
import type { GeminiClient, GeminiPart, GeminiRequest, GeminiResponse } from "../../src/assistant/gemini-client.ts";
import type { Instant } from "../../src/domain/dates.ts";
import { taskItem, type TaskItem, type User } from "../../src/domain/entities.ts";
import {
  roomID, taskAssignmentID, taskDefinitionID, taskOccurrenceID, userID, type RoomID,
} from "../../src/domain/ids.ts";
import { NO_RECURRENCE, taskEffort, type TaskOccurrenceStatus } from "../../src/domain/value-objects.ts";
import { uuid } from "../support/world.ts";

/** Uma resposta do modelo, ou um erro a lançar. */
export type Scripted = readonly GeminiPart[] | Error;

/** `GeminiClient` falso: devolve as respostas na ordem e guarda cópias das requisições (o responder reaproveita o array). */
export class FakeGemini implements GeminiClient {
  readonly requests: GeminiRequest[] = [];
  private readonly script: Scripted[];

  constructor(...script: Scripted[]) {
    this.script = script;
  }

  async generate(request: GeminiRequest): Promise<GeminiResponse> {
    this.requests.push(structuredClone(request));
    const next = this.script.shift();
    if (next instanceof Error) throw next;
    return { content: { role: "model", parts: next ?? [] } };
  }
}

export const call = (name: string, args: Readonly<Record<string, unknown>> = {}): GeminiPart => ({ kind: "functionCall", name, args });
export const say = (text: string): GeminiPart => ({ kind: "text", text });

let counter = 1000;

export interface ItemOptions {
  readonly dueAt?: Instant | null;
  readonly availableAt?: Instant;
  readonly status?: TaskOccurrenceStatus;
  readonly completedAt?: Instant | null;
  readonly assignee?: User | null;
  readonly room?: RoomID;
  readonly effort?: number;
}

export function item(name: string, options: ItemOptions = {}): TaskItem {
  const definitionID = taskDefinitionID(uuid(counter++));
  const occurrenceID = taskOccurrenceID(uuid(counter++));
  const availableAt = options.availableAt ?? 0;
  const completedAt = options.completedAt ?? null;
  const assignee = options.assignee ?? null;
  return taskItem(
    {
      id: definitionID, roomID: options.room ?? roomID(uuid(3)), name, details: "", effort: taskEffort(options.effort ?? 3),
      kind: "recurring", recurrence: NO_RECURRENCE, assignmentPolicy: "afterCompletion", sourceSuggestionID: null,
      rotationQueue: [], currentRotationIndex: 0, nextScheduledAt: null, pendingRotation: null, calendarAnchor: null,
    },
    {
      id: occurrenceID, taskDefinitionID: definitionID, availableAt, dueAt: options.dueAt ?? null,
      status: options.status ?? (completedAt === null ? "assigned" : "completed"), completedAt,
      completedByUserID: completedAt === null ? null : userID(uuid(1)), completionDebtImpacts: null,
      didPublishSuccessor: null, effortSnapshot: taskEffort(options.effort ?? 3),
    },
    assignee === null
      ? null
      : { id: taskAssignmentID(uuid(counter++)), occurrenceID, userID: assignee.id, assignedAt: availableAt, endedAt: null, supersededAt: null },
    assignee,
  );
}

let wamidCounter = 0;

/** Contexto de uma mensagem nova (cada `wamid` é único), para os testes que não tratam de idempotência. */
export function fresh(): { readonly wamid: string } {
  wamidCounter += 1;
  return { wamid: `wamid.T${wamidCounter}` };
}

/** Casos de uso reais sobre o `Env` em memória e um `PendingActionStore` em memória. */
export function assistantDependencies(env: Env, now: () => Instant) {
  return {
    houses: env.houses,
    rooms: env.rooms,
    myTasks: new GetMyTasksUseCase(env.tasks, env.houses, now),
    roomTasks: new GetRoomTasksUseCase(env.tasks),
    sporadicTasks: new GetSporadicTasksUseCase(env.tasks),
    complete: new CompleteTaskUseCase(env.tasks, now),
    pending: new InMemoryPendingActionStore(),
  };
}
