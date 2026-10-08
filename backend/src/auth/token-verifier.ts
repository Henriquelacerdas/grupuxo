import type { Brand } from "../domain/ids.ts";

/** Claim `sub` do JWT do Cognito: identifica a conta no user pool (atributo `cognitoSub` do morador e item `COGNITO#<sub>`). */
export type CognitoSub = Brand<string, "CognitoSub">;

/** Promove uma `string` a `CognitoSub`: de 1 a 128 caracteres ASCII visíveis, sem espaço nem controle. */
export function parseCognitoSub(value: string): CognitoSub | null {
  return /^[\x21-\x7E]{1,128}$/.test(value) ? (value as CognitoSub) : null;
}

export interface VerifiedToken {
  readonly cognitoSub: CognitoSub;
}

/** Valida o `Authorization: Bearer` do app. O `userID` do domínio vem sempre daqui (via `UserDirectory`), nunca do corpo. */
export interface TokenVerifier {
  /**
   * Falha sempre fechada: qualquer problema com o token lança `AuthenticationError` (responder 401);
   * indisponibilidade das chaves lança `TokenVerifierUnavailableError` (responder 503).
   */
  verify(token: string): Promise<VerifiedToken>;
}

/** Motivos internos da recusa: servem a testes e métricas, nunca à resposta ao cliente. */
export type AuthenticationFailure =
  | "malformed"
  | "tooLarge"
  | "unsupportedAlgorithm"
  | "unknownKey"
  | "badSignature"
  | "wrongIssuer"
  | "wrongTokenUse"
  | "wrongClient"
  | "expired"
  | "notYetValid"
  | "invalidClaims"
  | "verificationFailed";

/**
 * Token recusado. A mensagem é fixa e nunca contém o token nem o motivo: o cliente só descobre que não foi
 * autorizado. `reason` existe para teste e telemetria interna; quem monta a resposta HTTP não deve repassá-lo.
 */
export class AuthenticationError extends Error {
  readonly reason: AuthenticationFailure;

  constructor(reason: AuthenticationFailure) {
    super("Não autorizado");
    this.name = "AuthenticationError";
    this.reason = reason;
  }
}

/** Não foi possível obter as chaves públicas: não é culpa do token, então não vira 401. */
export class TokenVerifierUnavailableError extends Error {
  constructor() {
    super("Verificação de token indisponível");
    this.name = "TokenVerifierUnavailableError";
  }
}
