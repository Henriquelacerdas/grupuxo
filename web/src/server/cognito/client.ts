import { cognitoTimestamp, passwordClaim, srpAHex, startSrp } from "./srp";
import { isRecord } from "@/lib/api/decode";

// Cliente mínimo da API JSON do Cognito (sem SDK): `POST` com `X-Amz-Target`. Só operações públicas do app
// client (sem segredo) e `ChangePassword`/`RevokeToken`. Erros viram `AuthError` com um código fixo; a mensagem
// do Cognito nunca chega ao navegador.

export type AuthErrorCode =
  | "invalid_credentials" | "user_not_confirmed" | "username_exists" | "invalid_password" | "code_mismatch"
  | "expired_code" | "limit_exceeded" | "user_not_found" | "invalid_parameter" | "unavailable" | "session_expired"
  | "unsupported_challenge" | "already_confirmed";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface Tokens {
  readonly accessToken: string;
  readonly idToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export interface CognitoOptions {
  readonly endpoint: string;
  readonly clientID: string;
  readonly userPoolID: string;
  readonly fetch: Fetch;
  readonly now?: () => Date;
}

const ERROR_CODES: Readonly<Record<string, AuthErrorCode>> = {
  NotAuthorizedException: "invalid_credentials",
  UserNotConfirmedException: "user_not_confirmed",
  UsernameExistsException: "username_exists",
  AliasExistsException: "username_exists",
  InvalidPasswordException: "invalid_password",
  CodeMismatchException: "code_mismatch",
  ExpiredCodeException: "expired_code",
  LimitExceededException: "limit_exceeded",
  TooManyRequestsException: "limit_exceeded",
  TooManyFailedAttemptsException: "limit_exceeded",
  CodeDeliveryFailureException: "unavailable",
  UserNotFoundException: "user_not_found",
  InvalidParameterException: "invalid_parameter",
  PasswordResetRequiredException: "invalid_credentials",
};

function str(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];
  return typeof value === "string" ? value : undefined;
}

function sub(record: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = record[name];
  return isRecord(value) ? value : {};
}

export class CognitoClient {
  private readonly options: CognitoOptions;
  private readonly poolName: string;

  constructor(options: CognitoOptions) {
    this.options = options;
    this.poolName = options.userPoolID.split("_")[1] ?? options.userPoolID;
  }

  private async call(operation: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    let response: { status: number; text(): Promise<string> };
    try {
      response = await this.options.fetch(this.options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `AWSCognitoIdentityProviderService.${operation}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AuthError("unavailable");
    }
    let parsed: unknown = null;
    try { parsed = JSON.parse(await response.text()); } catch { parsed = null; }
    const record = isRecord(parsed) ? parsed : {};
    if (response.status >= 200 && response.status < 300) return record;
    const type = (str(record, "__type") ?? "").split("#").pop() ?? "";
    const message = str(record, "message") ?? "";
    if (type === "NotAuthorizedException" && /refresh token|access token/i.test(message)) throw new AuthError("session_expired");
    if (type === "NotAuthorizedException" && /CONFIRMED/i.test(message)) throw new AuthError("already_confirmed");
    throw new AuthError(ERROR_CODES[type] ?? "unavailable");
  }

  async signUp(email: string, password: string): Promise<{ readonly confirmed: boolean }> {
    const result = await this.call("SignUp", {
      ClientId: this.options.clientID, Username: email, Password: password, UserAttributes: [{ Name: "email", Value: email }],
    });
    return { confirmed: result["UserConfirmed"] === true };
  }

  /** Conta já confirmada conta como sucesso (como o `AuthService` do app). */
  async confirmSignUp(email: string, code: string): Promise<void> {
    try {
      await this.call("ConfirmSignUp", { ClientId: this.options.clientID, Username: email, ConfirmationCode: code });
    } catch (error) {
      if (error instanceof AuthError && error.code === "already_confirmed") return;
      throw error;
    }
  }

  async resendCode(email: string): Promise<void> {
    await this.call("ResendConfirmationCode", { ClientId: this.options.clientID, Username: email });
  }

  async forgotPassword(email: string): Promise<void> {
    await this.call("ForgotPassword", { ClientId: this.options.clientID, Username: email });
  }

  async confirmForgotPassword(email: string, code: string, password: string): Promise<void> {
    await this.call("ConfirmForgotPassword", { ClientId: this.options.clientID, Username: email, ConfirmationCode: code, Password: password });
  }

  async changePassword(accessToken: string, previous: string, proposed: string): Promise<void> {
    await this.call("ChangePassword", { AccessToken: accessToken, PreviousPassword: previous, ProposedPassword: proposed });
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.call("RevokeToken", { ClientId: this.options.clientID, Token: refreshToken });
  }

  async signIn(email: string, password: string): Promise<Tokens> {
    const session = startSrp();
    const initiated = await this.call("InitiateAuth", {
      ClientId: this.options.clientID, AuthFlow: "USER_SRP_AUTH", AuthParameters: { USERNAME: email, SRP_A: srpAHex(session) },
    });
    if (str(initiated, "ChallengeName") !== "PASSWORD_VERIFIER") throw new AuthError("unsupported_challenge");
    const params = sub(initiated, "ChallengeParameters");
    const userIDForSRP = str(params, "USER_ID_FOR_SRP");
    const saltHex = str(params, "SALT");
    const srpBHex = str(params, "SRP_B");
    const secretBlock = str(params, "SECRET_BLOCK");
    if (userIDForSRP === undefined || saltHex === undefined || srpBHex === undefined || secretBlock === undefined) throw new AuthError("unavailable");
    const timestamp = cognitoTimestamp(this.options.now?.() ?? new Date());
    const signature = passwordClaim({ session, poolName: this.poolName, userIDForSRP, password, saltHex, srpBHex, secretBlock, timestamp });
    const session2 = str(initiated, "Session");
    const responded = await this.call("RespondToAuthChallenge", {
      ClientId: this.options.clientID, ChallengeName: "PASSWORD_VERIFIER",
      ...(session2 === undefined ? {} : { Session: session2 }),
      ChallengeResponses: { USERNAME: userIDForSRP, PASSWORD_CLAIM_SECRET_BLOCK: secretBlock, TIMESTAMP: timestamp, PASSWORD_CLAIM_SIGNATURE: signature },
    });
    if (str(responded, "ChallengeName") !== undefined) throw new AuthError("unsupported_challenge");
    return this.tokens(sub(responded, "AuthenticationResult"), undefined);
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    const result = await this.call("InitiateAuth", {
      ClientId: this.options.clientID, AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: refreshToken },
    });
    return this.tokens(sub(result, "AuthenticationResult"), refreshToken);
  }

  private tokens(result: Record<string, unknown>, previousRefresh: string | undefined): Tokens {
    const accessToken = str(result, "AccessToken");
    const idToken = str(result, "IdToken");
    const refreshToken = str(result, "RefreshToken") ?? previousRefresh;
    const expiresIn = typeof result["ExpiresIn"] === "number" ? result["ExpiresIn"] : 3600;
    if (accessToken === undefined || idToken === undefined || refreshToken === undefined) throw new AuthError("unavailable");
    return { accessToken, idToken, refreshToken, expiresIn };
  }
}

/** Claims de um JWT sem verificar a assinatura: só para ler `exp` e o e-mail de tokens que o próprio Cognito acabou de emitir. */
export function unverifiedClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (payload === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
