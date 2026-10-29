import { parseProfileName, UserDirectoryError, type UserDirectory, type UserProfile } from "../../auth/user-directory.ts";
import type { CognitoSub } from "../../auth/token-verifier.ts";
import type { Instant } from "../../domain/dates.ts";
import { userID, type IDGenerator, type UserID } from "../../domain/ids.ts";
import { DynamoTransactionCanceledError, type DynamoClient } from "./client.ts";
import { COGNITO_SK, PROFILE_SK, cognitoPK, userPK } from "./keys.ts";
import { decoding, str } from "./reader.ts";

export interface UserDirectoryOptions {
  readonly client: DynamoClient;
  readonly newID: IDGenerator;
  readonly now: () => Instant;
}

/** Itens `COGNITO#<sub>` (unicidade) e `USER#<id>`/`PROFILE`, gravados na mesma transação. */
export class DynamoUserDirectory implements UserDirectory {
  private readonly client: DynamoClient;
  private readonly newID: IDGenerator;
  private readonly now: () => Instant;

  constructor(options: UserDirectoryOptions) {
    this.client = options.client;
    this.newID = options.newID;
    this.now = options.now;
  }

  async userForSub(cognitoSub: CognitoSub): Promise<UserID | null> {
    const item = await this.client.get({ key: { PK: cognitoPK(cognitoSub), SK: COGNITO_SK }, consistentRead: true });
    return item === undefined ? null : decoding(() => userID(str(item, "userID")));
  }

  async deleteUser(cognitoSub: CognitoSub): Promise<void> {
    const id = await this.userForSub(cognitoSub);
    if (id === null) return;
    await this.client.transactWrite([
      { kind: "delete", key: { PK: cognitoPK(cognitoSub), SK: COGNITO_SK } },
      { kind: "delete", key: { PK: userPK(id), SK: PROFILE_SK } },
    ]);
  }

  async ensureUser(cognitoSub: CognitoSub, profile: UserProfile): Promise<UserID> {
    if (parseProfileName(profile.name) !== profile.name) throw new UserDirectoryError("invalidProfile");
    const existing = await this.userForSub(cognitoSub);
    if (existing !== null) return existing;
    const id = userID(this.newID());
    try {
      await this.client.transactWrite([
        {
          kind: "put", item: { PK: cognitoPK(cognitoSub), SK: COGNITO_SK, userID: id }, condition: "attribute_not_exists(PK)",
        },
        {
          kind: "put",
          item: { PK: userPK(id), SK: PROFILE_SK, name: profile.name, email: null, cognitoSub, createdAt: this.now() },
          condition: "attribute_not_exists(PK)",
        },
      ]);
      return id;
    } catch (error) {
      // Outro pedido da mesma conta venceu: o morador dele é o único.
      if (error instanceof DynamoTransactionCanceledError && error.reasons[0] === "ConditionalCheckFailed") {
        const winner = await this.userForSub(cognitoSub);
        if (winner !== null) return winner;
      }
      throw error;
    }
  }
}
