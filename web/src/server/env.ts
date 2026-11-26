import "server-only";

// Configuração do servidor, lida uma vez. Sem valor obrigatório, o servidor falha fechado (sem padrão escondido),
// como o app com `CONFIGURE-ME`.

export interface ServerConfig {
  readonly apiBaseURL: string;
  readonly userPoolID: string;
  readonly clientID: string;
  readonly region: string;
  readonly cognitoEndpoint: string;
  readonly sessionSecret: string;
}

export class ConfigError extends Error {
  constructor(name: string) {
    super(`Configuração ausente ou inválida: ${name}`);
    this.name = "ConfigError";
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") throw new ConfigError(name);
  return value;
}

/** http só para o servidor local (127.0.0.1/localhost); qualquer outro endereço tem de ser https. */
function safeURL(name: string, value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConfigError(name); }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new ConfigError(name);
  return value.replace(/\/+$/, "");
}

let cached: ServerConfig | undefined;

export function serverConfig(): ServerConfig {
  if (cached !== undefined) return cached;
  const userPoolID = required("COGNITO_USER_POOL_ID");
  const match = /^([a-z]{2}-[a-z]+-\d)_[A-Za-z0-9]+$/.exec(userPoolID);
  if (match?.[1] === undefined) throw new ConfigError("COGNITO_USER_POOL_ID");
  const region = match[1];
  const endpoint = process.env["COGNITO_ENDPOINT"]?.trim();
  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret.length < 32) throw new ConfigError("SESSION_SECRET");
  cached = {
    apiBaseURL: safeURL("REVEZA_API_BASE_URL", required("REVEZA_API_BASE_URL")),
    userPoolID,
    clientID: required("COGNITO_CLIENT_ID"),
    region,
    cognitoEndpoint: endpoint === undefined || endpoint === "" ? `https://cognito-idp.${region}.amazonaws.com/` : safeURL("COGNITO_ENDPOINT", endpoint),
    sessionSecret,
  };
  return cached;
}
