import { DomainError, type DomainErrorCode } from "../domain/errors.ts";
import { DynamoStoreError } from "../adapters/dynamodb/errors.ts";
import { isRecord, type Fields, type HttpApiResult } from "./events.ts";

const MAX_BODY_BYTES = 4096;

/** `null` se o corpo não for um objeto JSON em UTF-8 de até 4 KB. */
export function jsonObject(body: Uint8Array): Fields | null {
  if (body.length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function json(statusCode: number, body: unknown, extra: Readonly<Record<string, string>> = {}): HttpApiResult {
  return { statusCode, headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) };
}

/** Formato único de erro: `{ "error": "<código>" }`, sem detalhe (BACKEND.md, seção 6.1). */
export const failure = (statusCode: number, error: string, extra: Readonly<Record<string, string>> = {}): HttpApiResult =>
  json(statusCode, { error }, extra);

export const noContent = (): HttpApiResult => ({ statusCode: 204, body: "" });

function domainFailure(code: DomainErrorCode): HttpApiResult {
  switch (code) {
    case "entityNotFound": return failure(404, "not_found");
    case "taskUnavailable": return failure(403, "task_unavailable");
    case "taskAlreadyCompleted": return failure(409, "task_already_completed");
    case "deletionConfirmationRequired": return failure(409, "room_deletion_confirmation_required");
    case "wholeHouseProtected": return failure(409, "whole_house_protected");
    case "noEligibleMembers": return failure(409, "no_eligible_members");
    case "invalidDistribution": return failure(409, "invalid_distribution");
    case "invalidTaskName": return failure(400, "invalid_task_name");
    case "invalidRoomName": return failure(400, "invalid_room_name");
    case "invalidRoomParticipants": return failure(400, "invalid_room_participants");
    case "invalidSchedule": return failure(400, "invalid_schedule");
    case "invalidDateInterval": return failure(400, "invalid_date_interval");
    case "invalidHouseName": return failure(400, "invalid_house_name");
    case "invalidTimezone": return failure(400, "invalid_timezone");
    case "invalidAccessCode": return failure(404, "invalid_code");
    case "lastMember": return failure(409, "last_member");
    // Nenhuma rota da `api` chega a estes: se chegar, é erro de programação.
    case "invalidResidentName":
    case "cannotRemoveCurrentUser":
      return failure(500, "internal");
  }
}

/**
 * Erros do domínio e do armazenamento que viram resposta (tabela da seção 6.1). `null` para o que não é nosso:
 * quem chama responde 500 sem detalhe.
 */
export function storageOrDomainFailure(error: unknown): HttpApiResult | null {
  if (error instanceof DomainError) return domainFailure(error.code);
  if (error instanceof DynamoStoreError && error.code === "conflict") return failure(409, "conflict");
  return null;
}
