import type { Instant } from "../../domain/dates.ts";
import { taskOccurrenceID, userID, type UserID } from "../../domain/ids.ts";
import type { PendingActionStore, PendingCompletion } from "../../whatsapp/ports.ts";
import { DynamoConditionFailedError, type DynamoClient } from "./client.ts";
import { PENDING_SK, pendingPK, ttlSeconds } from "./keys.ts";
import { decoding, integer, nullableStr, str } from "./reader.ts";

export interface PendingActionStoreOptions {
  readonly client: DynamoClient;
  /** Folga do `ttl` depois de `expiresAt` (a validade é decidida pela condição `expiresAt > :at`). */
  readonly graceSeconds: number;
}

/** Item `PENDING#<userID>`/`COMPLETE`: só o ID da ocorrência e horários, nunca texto nem nome de tarefa. */
export class DynamoPendingActionStore implements PendingActionStore {
  private readonly client: DynamoClient;
  private readonly graceSeconds: number;

  constructor(options: PendingActionStoreOptions) {
    this.client = options.client;
    this.graceSeconds = options.graceSeconds;
  }

  async save(pending: PendingCompletion): Promise<void> {
    // `Put` substitui o pedido anterior e, por não ter `confirmedByWamid`, zera a confirmação.
    await this.client.put({
      item: {
        PK: pendingPK(pending.userID), SK: PENDING_SK, userID: pending.userID, occurrenceID: pending.occurrenceID,
        createdAt: pending.createdAt, expiresAt: pending.expiresAt, ttl: ttlSeconds(pending.expiresAt, this.graceSeconds),
      },
    });
  }

  async confirm(user: UserID, wamid: string, at: Instant): Promise<PendingCompletion | null> {
    try {
      const item = await this.client.update({
        key: { PK: pendingPK(user), SK: PENDING_SK }, update: "SET #confirmedByWamid = :wamid",
        condition: "attribute_exists(PK) AND #expiresAt > :at AND (attribute_not_exists(#confirmedByWamid) OR #confirmedByWamid = :wamid)",
        names: { "#confirmedByWamid": "confirmedByWamid", "#expiresAt": "expiresAt" },
        values: { ":wamid": wamid, ":at": at }, returnValues: "ALL_NEW",
      });
      return decoding(() => ({
        userID: userID(str(item, "userID")), occurrenceID: taskOccurrenceID(str(item, "occurrenceID")),
        createdAt: integer(item, "createdAt"), expiresAt: integer(item, "expiresAt"),
        confirmedByWamid: nullableStr(item, "confirmedByWamid"),
      }));
    } catch (error) {
      if (error instanceof DynamoConditionFailedError) return null;
      throw error;
    }
  }

  async discard(user: UserID): Promise<void> {
    await this.client.delete({ key: { PK: pendingPK(user), SK: PENDING_SK } });
  }
}
