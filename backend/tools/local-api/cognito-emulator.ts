import { randomBytes, randomUUID, sign, type KeyObject } from "node:crypto";
import { cognitoIssuer } from "../../src/auth/cognito-jwt-verifier.ts";
import { expectedSignature, makeVerifier, serverChallenge, type ServerChallenge, type SrpVerifier } from "./srp-server.ts";

// Emulador mínimo da API JSON do Cognito (`X-Amz-Target: AWSCognitoIdentityProviderService.<Op>`), só para dev e
// testes e2e do web. Implementa o que o web usa: cadastro com código, login SRP, refresh, esqueci a senha, trocar
// senha, revogar. O código de confirmação é sempre `LOCAL_CODE`. Tokens RS256 com o `iss` e o `client_id` reais
// do pool, assinados com a chave local que o verificador da `api` local aceita. Nada daqui chega à AWS.

export const LOCAL_CODE = "123456";

interface LocalUser {
  readonly sub: string;
  email: string;
  srp: SrpVerifier;
  password: string;
  confirmed: boolean;
}

interface PendingChallenge {
  readonly user: LocalUser;
  readonly A: bigint;
  readonly challenge: ServerChallenge;
  readonly secretBlock: Buffer;
}

export interface CognitoResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface EmulatorOptions {
  readonly userPoolID: string;
  readonly clientID: string;
  readonly key: { readonly kid: string; readonly privateKey: KeyObject };
  /** Validade do access token em segundos. */
  readonly tokenTTL: number;
  readonly now: () => number;
}

function fail(type: string, message: string): CognitoResult {
  return { status: 400, body: { __type: type, message } };
}

function field(body: unknown, name: string): string | null {
  if (typeof body !== "object" || body === null) return null;
  const value: unknown = Reflect.get(body, name);
  return typeof value === "string" ? value : null;
}

function record(body: unknown, name: string): Record<string, string> {
  if (typeof body !== "object" || body === null) return {};
  const value: unknown = Reflect.get(body, name);
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return out;
}

/** Política do pool (`amplify_outputs.json`): 8+, minúscula, maiúscula, número e símbolo. */
export function acceptablePassword(password: string): boolean {
  return password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export class CognitoEmulator {
  private readonly options: EmulatorOptions;
  private readonly poolName: string;
  private readonly byEmail = new Map<string, LocalUser>();
  private readonly bySub = new Map<string, LocalUser>();
  private readonly challenges = new Map<string, PendingChallenge>();
  private readonly refreshTokens = new Map<string, string>();
  private readonly accessTokens = new Map<string, string>();

  constructor(options: EmulatorOptions) {
    this.options = options;
    this.poolName = options.userPoolID.split("_")[1] ?? options.userPoolID;
  }

  /** `DELETE /v1/me` da `api` local apaga o usuário daqui (o `AdminDeleteUser` do emulador). */
  deleteUser(username: string): void {
    const user = this.bySub.get(username);
    if (user === undefined) return;
    this.bySub.delete(user.sub);
    this.byEmail.delete(user.email);
  }

  handle(target: string, body: unknown): CognitoResult {
    const operation = target.replace(/^AWSCognitoIdentityProviderService\./, "");
    if (field(body, "ClientId") !== null && field(body, "ClientId") !== this.options.clientID && operation !== "ChangePassword" && operation !== "RevokeToken") {
      return fail("ResourceNotFoundException", "User pool client does not exist.");
    }
    switch (operation) {
      case "SignUp": return this.signUp(body);
      case "ConfirmSignUp": return this.confirmSignUp(body);
      case "ResendConfirmationCode": return this.resend(body);
      case "InitiateAuth": return this.initiateAuth(body);
      case "RespondToAuthChallenge": return this.respond(body);
      case "ForgotPassword": return this.forgotPassword(body);
      case "ConfirmForgotPassword": return this.confirmForgotPassword(body);
      case "ChangePassword": return this.changePassword(body);
      case "RevokeToken": return this.revoke(body);
      default: return fail("InvalidParameterException", "Unsupported operation.");
    }
  }

  private userFor(username: string | null): LocalUser | undefined {
    if (username === null) return undefined;
    return this.byEmail.get(username.toLowerCase()) ?? this.bySub.get(username);
  }

  private signUp(body: unknown): CognitoResult {
    const email = field(body, "Username")?.toLowerCase() ?? null;
    const password = field(body, "Password");
    if (email === null || password === null || !email.includes("@")) return fail("InvalidParameterException", "Invalid username.");
    if (this.byEmail.has(email)) return fail("UsernameExistsException", "An account with the given email already exists.");
    if (!acceptablePassword(password)) return fail("InvalidPasswordException", "Password did not conform with policy.");
    const sub = randomUUID();
    const user: LocalUser = { sub, email, password, srp: makeVerifier(this.poolName, sub, password), confirmed: false };
    this.byEmail.set(email, user);
    this.bySub.set(sub, user);
    return { status: 200, body: { UserConfirmed: false, UserSub: sub, CodeDeliveryDetails: { DeliveryMedium: "EMAIL", Destination: email } } };
  }

  private confirmSignUp(body: unknown): CognitoResult {
    const user = this.userFor(field(body, "Username"));
    if (user === undefined) return fail("UserNotFoundException", "Username/client id combination not found.");
    if (user.confirmed) return fail("NotAuthorizedException", "User cannot be confirmed. Current status is CONFIRMED");
    if (field(body, "ConfirmationCode") !== LOCAL_CODE) return fail("CodeMismatchException", "Invalid verification code provided, please try again.");
    user.confirmed = true;
    return { status: 200, body: {} };
  }

  private resend(body: unknown): CognitoResult {
    const user = this.userFor(field(body, "Username"));
    if (user === undefined) return fail("UserNotFoundException", "Username/client id combination not found.");
    return { status: 200, body: { CodeDeliveryDetails: { DeliveryMedium: "EMAIL", Destination: user.email } } };
  }

  private initiateAuth(body: unknown): CognitoResult {
    const flow = field(body, "AuthFlow");
    const params = record(body, "AuthParameters");
    if (flow === "REFRESH_TOKEN_AUTH" || flow === "REFRESH_TOKEN") {
      const sub = this.refreshTokens.get(params["REFRESH_TOKEN"] ?? "");
      const user = sub === undefined ? undefined : this.bySub.get(sub);
      if (user === undefined) return fail("NotAuthorizedException", "Invalid Refresh Token");
      return { status: 200, body: { AuthenticationResult: this.tokens(user, false) } };
    }
    if (flow !== "USER_SRP_AUTH") return fail("InvalidParameterException", "Auth flow not enabled for this client");
    const user = this.userFor(params["USERNAME"] ?? null);
    const srpA = params["SRP_A"];
    if (srpA === undefined || !/^[0-9a-fA-F]+$/.test(srpA)) return fail("InvalidParameterException", "Missing SRP_A");
    if (user === undefined) return fail("NotAuthorizedException", "Incorrect username or password.");
    if (!user.confirmed) return fail("UserNotConfirmedException", "User is not confirmed.");
    const challenge = serverChallenge(user.srp.verifier);
    const secretBlock = randomBytes(64);
    const session = randomBytes(24).toString("base64url");
    this.challenges.set(session, { user, A: BigInt(`0x${srpA}`), challenge, secretBlock });
    return {
      status: 200,
      body: {
        ChallengeName: "PASSWORD_VERIFIER",
        Session: session,
        ChallengeParameters: {
          USER_ID_FOR_SRP: user.sub, USERNAME: user.sub, SALT: user.srp.salt,
          SRP_B: challenge.B.toString(16), SECRET_BLOCK: secretBlock.toString("base64"),
        },
      },
    };
  }

  private respond(body: unknown): CognitoResult {
    if (field(body, "ChallengeName") !== "PASSWORD_VERIFIER") return fail("InvalidParameterException", "Unsupported challenge.");
    const responses = record(body, "ChallengeResponses");
    // O Cognito real não exige o `Session` neste passo; o emulador acha o desafio pelo bloco secreto.
    const pending = [...this.challenges.entries()].find(([, c]) => c.secretBlock.toString("base64") === responses["PASSWORD_CLAIM_SECRET_BLOCK"]);
    if (pending === undefined) return fail("NotAuthorizedException", "Incorrect username or password.");
    this.challenges.delete(pending[0]);
    const { user, A, challenge, secretBlock } = pending[1];
    const timestamp = responses["TIMESTAMP"] ?? "";
    if (!/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} UTC \d{4}$/.test(timestamp)) return fail("InvalidParameterException", "Invalid TIMESTAMP.");
    const expected = expectedSignature({ A, challenge, verifier: user.srp.verifier, poolName: this.poolName, userID: user.sub, secretBlock, timestamp });
    if (expected === null || expected !== responses["PASSWORD_CLAIM_SIGNATURE"]) return fail("NotAuthorizedException", "Incorrect username or password.");
    return { status: 200, body: { ChallengeParameters: {}, AuthenticationResult: this.tokens(user, true) } };
  }

  private forgotPassword(body: unknown): CognitoResult {
    const user = this.userFor(field(body, "Username"));
    if (user === undefined) return fail("UserNotFoundException", "Username/client id combination not found.");
    return { status: 200, body: { CodeDeliveryDetails: { DeliveryMedium: "EMAIL", Destination: user.email } } };
  }

  private confirmForgotPassword(body: unknown): CognitoResult {
    const user = this.userFor(field(body, "Username"));
    const password = field(body, "Password");
    if (user === undefined) return fail("UserNotFoundException", "Username/client id combination not found.");
    if (field(body, "ConfirmationCode") !== LOCAL_CODE) return fail("CodeMismatchException", "Invalid verification code provided, please try again.");
    if (password === null || !acceptablePassword(password)) return fail("InvalidPasswordException", "Password did not conform with policy.");
    user.password = password;
    user.srp = makeVerifier(this.poolName, user.sub, password);
    user.confirmed = true;
    return { status: 200, body: {} };
  }

  private changePassword(body: unknown): CognitoResult {
    const sub = this.accessTokens.get(field(body, "AccessToken") ?? "");
    const user = sub === undefined ? undefined : this.bySub.get(sub);
    if (user === undefined) return fail("NotAuthorizedException", "Invalid Access Token");
    if (field(body, "PreviousPassword") !== user.password) return fail("NotAuthorizedException", "Incorrect username or password.");
    const proposed = field(body, "ProposedPassword");
    if (proposed === null || !acceptablePassword(proposed)) return fail("InvalidPasswordException", "Password did not conform with policy.");
    user.password = proposed;
    user.srp = makeVerifier(this.poolName, user.sub, proposed);
    return { status: 200, body: {} };
  }

  private revoke(body: unknown): CognitoResult {
    this.refreshTokens.delete(field(body, "Token") ?? "");
    return { status: 200, body: {} };
  }

  private jwt(claims: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: this.options.key.kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = sign("sha256", Buffer.from(`${header}.${payload}`), this.options.key.privateKey).toString("base64url");
    return `${header}.${payload}.${signature}`;
  }

  private tokens(user: LocalUser, withRefresh: boolean): Record<string, unknown> {
    const iat = Math.floor(this.options.now() / 1000);
    const exp = iat + this.options.tokenTTL;
    const iss = cognitoIssuer(this.options.userPoolID);
    const accessToken = this.jwt({
      sub: user.sub, iss, client_id: this.options.clientID, token_use: "access", scope: "aws.cognito.signin.user.admin",
      auth_time: iat, iat, exp, jti: randomUUID(), username: user.sub,
    });
    const idToken = this.jwt({
      sub: user.sub, iss, aud: this.options.clientID, token_use: "id", email: user.email, email_verified: true,
      "cognito:username": user.sub, auth_time: iat, iat, exp,
    });
    this.accessTokens.set(accessToken, user.sub);
    const result: Record<string, unknown> = { AccessToken: accessToken, IdToken: idToken, ExpiresIn: this.options.tokenTTL, TokenType: "Bearer" };
    if (withRefresh) {
      const refresh = randomBytes(48).toString("base64url");
      this.refreshTokens.set(refresh, user.sub);
      result["RefreshToken"] = refresh;
    }
    return result;
  }
}

/** Formato do `TIMESTAMP` do SRP do Cognito: `Tue Nov 26 12:00:00 UTC 2026` (dia sem zero à esquerda). */
export function cognitoTimestamp(at: Date): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${DAYS[at.getUTCDay()]} ${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()} ${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())} UTC ${at.getUTCFullYear()}`;
}
