import assert from "node:assert/strict";
import { test } from "node:test";
import type { Absence, HouseMembership, Room, RoomMembership, TaskAssignment, TaskDefinition, TaskItem, TaskOccurrence } from "../src/domain/entities.ts";
import { userID } from "../src/domain/ids.ts";
import { TaskEligibilityPolicy, TaskSwapEligibilityPolicy } from "../src/domain/services/eligibility.ts";
import { loadFixture } from "./support/fixtures.ts";
import { reviveInstants, toInstant } from "./support/state-json.ts";

interface Case {
  name: string;
  now: string;
  users: string[];
  rooms: unknown[];
  houseMemberships: unknown[];
  roomMemberships: unknown[];
  absences: unknown[];
  items: { definition: unknown; occurrence: unknown; assignment: unknown }[];
  canOffer: boolean[][];
  canReceive: boolean[][];
  canView: boolean[][];
  canClaim: boolean[][];
  canSwap: boolean[][];
}

const swap = new TaskSwapEligibilityPolicy();
const view = new TaskEligibilityPolicy();

for (const c of loadFixture<Case>("policies").cases) {
  test(`políticas de elegibilidade e troca (Swift): ${c.name}`, () => {
    const now = toInstant(c.now);
    const users = c.users.map(userID);
    const rooms = reviveInstants(c.rooms) as Room[];
    const houseMemberships = c.houseMemberships as HouseMembership[];
    const roomMemberships = reviveInstants(c.roomMemberships) as RoomMembership[];
    const absences = reviveInstants(c.absences) as Absence[];
    const items: TaskItem[] = c.items.map((raw) => ({
      definition: reviveInstants(raw.definition) as TaskDefinition,
      occurrence: reviveInstants(raw.occurrence) as TaskOccurrence,
      assignment: raw.assignment === null ? null : (reviveInstants(raw.assignment) as TaskAssignment),
      assignee: null,
      suggestedAssignee: null,
    }));
    const roomOf = (item: TaskItem): Room => {
      const room = rooms.find((r) => r.id === item.definition.roomID);
      if (room === undefined) throw new Error("cômodo ausente na fixture");
      return room;
    };
    assert.deepStrictEqual(items.map((item) => users.map((u) => swap.canOffer(item, u, now))), c.canOffer);
    assert.deepStrictEqual(
      items.map((item) => users.map((u) => swap.canReceive(item, roomOf(item), u, houseMemberships, roomMemberships, absences, now))),
      c.canReceive,
    );
    assert.deepStrictEqual(
      items.map((item) => users.map((u) => view.canView(item.definition, roomOf(item), u, roomMemberships))),
      c.canView,
    );
    assert.deepStrictEqual(
      items.map((item) => users.map((u) => view.canClaim(item, roomOf(item), u, roomMemberships))),
      c.canClaim,
    );
    const [first, second] = users;
    assert.ok(first !== undefined && second !== undefined);
    assert.deepStrictEqual(
      items.map((a) =>
        items.map((b) =>
          swap.canSwap(a, b, roomOf(a), roomOf(b), a.assignment?.userID ?? first, b.assignment?.userID ?? second,
            houseMemberships, roomMemberships, absences, now)
        )
      ),
      c.canSwap,
    );
  });
}
