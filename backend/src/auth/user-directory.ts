import type { UserID } from "../domain/ids.ts";
import type { CognitoSub } from "./token-verifier.ts";

/** Dados que o app envia no `POST /me` (o `name` vem do cliente; o `userID` nunca). */
export interface UserProfile {
  readonly name: string;
}

export type UserDirectoryErrorCode =
  /** `profile.name` vazio, com espaços nas pontas, com caractere de controle ou maior que 80 caracteres. */
  "invalidProfile";

export class UserDirectoryError extends Error {
  readonly code: UserDirectoryErrorCode;

  constructor(code: UserDirectoryErrorCode) {
    super(code);
    this.name = "UserDirectoryError";
    this.code = code;
  }
}

/**
 * Nome já normalizado (sem espaços nas pontas), de 1 a 80 caracteres e sem caracteres de controle; `null` se
 * não servir. A `api` normaliza o texto do corpo com isto antes de chamar `ensureUser`, e todo adaptador
 * recusa o que não passa nesta regra.
 */
export function parseProfileName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && [...name].length <= 80 && !/\p{Cc}/u.test(name) ? name : null;
}

/** Liga a conta do Cognito (`users.cognito_sub`) ao morador do domínio. */
export interface UserDirectory {
  /** O morador da conta, ou `null` se ela ainda não passou pelo `POST /me`. */
  userForSub(cognitoSub: CognitoSub): Promise<UserID | null>;

  /**
   * Devolve o morador da conta, criando-o se for a primeira vez. Idempotente e seguro sob concorrência:
   * chamadas simultâneas com o mesmo `cognitoSub` resultam num único morador e devolvem o mesmo `UserID`. Para
   * uma conta que já existe, `profile` só é validado e não sobrescreve o nome. Lança `UserDirectoryError` se
   * `profile` for inválido, exista a conta ou não. No PostgreSQL: `INSERT ... ON CONFLICT (cognito_sub) DO NOTHING`, seguido de
   * `SELECT` por `cognito_sub`.
   */
  ensureUser(cognitoSub: CognitoSub, profile: UserProfile): Promise<UserID>;
}
