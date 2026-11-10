import type { IdentityRemover } from "../../auth/identity-remover.ts";
import { parseCognitoUsername } from "../../auth/token-verifier.ts";
import type { CognitoIdentityClient } from "./clients.ts";

// Apaga o usuário do Cognito sobre um cliente mínimo injetado. Nenhuma mensagem de erro carrega o username, o
// pool nem a mensagem do erro original.

export type IdentityRemoveErrorCode =
  /** `username` fora do formato do Cognito: nem chega ao cliente. */
  | "invalidUsername"
  /** O cliente falhou (rede, permissão...). */
  | "removeFailed";

const IDENTITY_ERROR_MESSAGES: Readonly<Record<IdentityRemoveErrorCode, string>> = {
  invalidUsername: "Usuário do Cognito inválido",
  removeFailed: "Falha ao apagar o usuário do Cognito",
};

export class IdentityRemoveError extends Error {
  readonly code: IdentityRemoveErrorCode;
  /** `name` do erro original (por exemplo `NotAuthorizedException`), sem a mensagem. `null` se não houver. */
  readonly causeName: string | null;

  constructor(code: IdentityRemoveErrorCode, causeName: string | null = null) {
    super(IDENTITY_ERROR_MESSAGES[code]);
    this.name = "IdentityRemoveError";
    this.code = code;
    this.causeName = causeName;
  }
}

export class CognitoIdentityRemover implements IdentityRemover {
  private readonly client: CognitoIdentityClient;

  constructor(client: CognitoIdentityClient) {
    this.client = client;
  }

  async deleteIdentity(username: string): Promise<void> {
    if (parseCognitoUsername(username) !== username) throw new IdentityRemoveError("invalidUsername");
    try {
      await this.client.adminDeleteUser(username);
    } catch (error) {
      throw new IdentityRemoveError("removeFailed", error instanceof Error ? error.name : null);
    }
  }
}
