import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeDefinition, encodeDefinition } from "../../src/adapters/dynamodb/codec.ts";
import type { TaskDefinition } from "../../src/domain/entities.ts";
import { houseID, roomID, taskDefinitionID, userID } from "../../src/domain/ids.ts";
import { NO_RECURRENCE, taskEffort } from "../../src/domain/value-objects.ts";
import { uuid } from "../support/world.ts";

// `createdByUserID` (editar e excluir avulsa, BACKEND.md seção 4): grava e lê; itens gravados antes do atributo
// (ausente) e nulos voltam sem criador, sem falhar.

const house = houseID(uuid(1));
const definition: TaskDefinition = {
  id: taskDefinitionID(uuid(2)), roomID: roomID(uuid(3)), name: "Trocar lâmpada", details: "", effort: taskEffort(1),
  kind: "sporadic", recurrence: NO_RECURRENCE, assignmentPolicy: "selfAssigned", sourceSuggestionID: null,
  rotationQueue: [], currentRotationIndex: 0, nextScheduledAt: null, pendingRotation: null, calendarAnchor: null, endedAt: null,
};

test("definição: o criador faz ida e volta pelo DynamoDB", () => {
  const withCreator: TaskDefinition = { ...definition, createdByUserID: userID(uuid(4)) };
  assert.deepEqual(decodeDefinition(encodeDefinition(house, withCreator)), withCreator);
});

test("definição sem criador (nulo ou atributo ausente) volta sem o campo", () => {
  const item = encodeDefinition(house, definition);
  assert.equal(item["createdByUserID"], null);
  assert.deepEqual(decodeDefinition(item), definition);
  const { createdByUserID: _removed, ...legacy } = item;
  assert.deepEqual(decodeDefinition(legacy), definition);
});
