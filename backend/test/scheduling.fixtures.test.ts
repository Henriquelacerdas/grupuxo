import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendar } from "../src/domain/dates.ts";
import {
  cloneSchedulingState, isActiveAssignment, type Absence, type SchedulingState, type TaskDefinition,
} from "../src/domain/entities.ts";
import { DomainError } from "../src/domain/errors.ts";
import { houseID, roomID, taskOccurrenceID, userID, type TaskOccurrenceID, type UserID } from "../src/domain/ids.ts";
import { TaskSchedulingService } from "../src/domain/services/task-scheduling-service.ts";
import { loadFixture, normalizeZero } from "./support/fixtures.ts";
import {
  decodeState, encodeState, knownIDs, normalizeNewIDs, reviveInstants, sequentialIDs,
} from "./support/state-json.ts";

type Json = Record<string, unknown>;
interface Case {
  name: string;
  zone: string;
  initial: unknown;
  steps: Json[];
  results: unknown[];
  final: unknown;
}

function resolveOccurrence(state: SchedulingState, ref: Json): TaskOccurrenceID | undefined {
  const matching = state.occurrences.filter((o) => o.taskDefinitionID === ref["def"]);
  const n = ref["n"];
  return typeof n === "number" ? matching[n]?.id : undefined;
}

function resolveUser(state: SchedulingState, who: Json): UserID | undefined {
  if (typeof who["user"] === "string") return userID(who["user"]);
  const ref = who["assigneeOf"];
  if (typeof ref !== "object" || ref === null) return undefined;
  const occurrence = resolveOccurrence(state, ref as Json);
  if (occurrence === undefined) return undefined;
  for (let i = state.assignments.length - 1; i >= 0; i--) {
    const a = state.assignments[i];
    if (a !== undefined && a.occurrenceID === occurrence && (isActiveAssignment(a) || a.endedAt !== null)) return a.userID;
  }
  return undefined;
}

function applyStep(service: TaskSchedulingService, state: SchedulingState, raw: Json): unknown {
  const step = reviveInstants(raw) as Json;
  const date = step["at"] as number;
  switch (step["op"]) {
    case "create": service.create(step["definition"] as TaskDefinition, date, state); return undefined;
    case "complete": {
      const occurrence = resolveOccurrence(state, step["ref"] as Json);
      const user = resolveUser(state, step["by"] as Json);
      if (occurrence === undefined || user === undefined) throw new DomainError("entityNotFound");
      service.complete(occurrence, user, date, state);
      return undefined;
    }
    case "reopen": {
      const occurrence = resolveOccurrence(state, step["ref"] as Json);
      const user = resolveUser(state, step["by"] as Json);
      if (occurrence === undefined || user === undefined) throw new DomainError("entityNotFound");
      service.reopen(occurrence, user, state);
      return undefined;
    }
    case "refresh": service.refresh(houseID(step["houseID"] as string), date, state); return undefined;
    case "addMember":
      service.addMember(userID(step["userID"] as string), roomID(step["roomID"] as string), date, state, { replan: step["replan"] as boolean });
      return undefined;
    case "removeMember":
      service.removeMember(userID(step["userID"] as string), roomID(step["roomID"] as string), date, state, {
        confirmDeletion: step["confirmDeletion"] as boolean, houseChange: step["houseChange"] as boolean,
        replan: step["replan"] as boolean,
      });
      return undefined;
    case "rebalance": service.rebalance(houseID(step["houseID"] as string), step["boundary"] as number, date, state); return undefined;
    case "addAbsence": state.absences.push(step["absence"] as Absence); return undefined;
    case "suggestedResident": return service.suggestedResident(roomID(step["roomID"] as string), date, state);
    default: throw new Error(`passo desconhecido: ${String(step["op"])}`);
  }
}

for (const file of ["scheduling-create", "scheduling-complete", "scheduling-membership", "scheduling-calendar"]) {
  for (const c of loadFixture<Case>(file).cases) {
    test(`agendamento (Swift) [${file}]: ${c.name}`, () => {
      const service = new TaskSchedulingService({ calendar: createCalendar(c.zone), newID: sequentialIDs() });
      let state = decodeState(c.initial);
      const results: unknown[] = [];
      for (const step of c.steps) {
        const working = cloneSchedulingState(state);
        try {
          const value = applyStep(service, working, step);
          state = working;
          const entry: Record<string, unknown> = { ok: true, occurrences: state.occurrences.length, assignments: state.assignments.length };
          if (value !== undefined) entry["value"] = value;
          results.push(entry);
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          results.push({ error: error.code });
        }
      }
      assert.deepStrictEqual(results, c.results);
      const known = knownIDs({ name: c.name, zone: c.zone, initial: c.initial, steps: c.steps });
      const final = normalizeNewIDs(encodeState(state), known);
      assert.deepStrictEqual(normalizeZero(final), normalizeZero(c.final));
    });
  }
}
