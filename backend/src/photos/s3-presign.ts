import { createHash, createHmac } from "node:crypto";

// URL pré-assinada do S3 (AWS Signature V4, parâmetros na query). Sem o AWS SDK: o runtime do backend não tem
// dependências, e assinar é só HMAC. A função é pura (credenciais, instante e região entram por parâmetro) e é
// validada contra o exemplo de URL pré-assinada da documentação da AWS (`test/photos/s3-presign.test.ts`).

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Credenciais temporárias (Lambda): vai na query como `X-Amz-Security-Token`. */
  readonly sessionToken?: string;
}

export interface PresignInput {
  readonly method: "GET" | "PUT" | "DELETE";
  readonly bucket: string;
  readonly region: string;
  /** Chave do objeto, sem barra inicial. */
  readonly key: string;
  /** Instante da assinatura (milissegundos); o URL vale a partir dele. */
  readonly at: number;
  readonly expiresSeconds: number;
  readonly credentials: AwsCredentials;
  /** Cabeçalhos que o cliente precisa mandar iguais (ex.: `content-type`); entram na assinatura. */
  readonly signedHeaders?: Readonly<Record<string, string>>;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string): Buffer => createHmac("sha256", key).update(value).digest();

/** `encodeURIComponent` mais os caracteres que o SigV4 também codifica (`!'()*`). */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const encodePath = (key: string): string => key.split("/").map(encode).join("/");

function amzDate(at: number): string {
  return new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Host de estilo virtual do bucket (`bucket.s3.<região>.amazonaws.com`; `us-east-1` também usa o formato regional). */
export function s3Host(bucket: string, region: string): string {
  return region === "us-east-1" && bucket.includes(".") ? "s3.amazonaws.com" : `${bucket}.s3.${region}.amazonaws.com`;
}

/** O exemplo da documentação usa o endpoint global (`examplebucket.s3.amazonaws.com`). */
export function presignS3Url(input: PresignInput, host: string = s3Host(input.bucket, input.region)): string {
  const date = amzDate(input.at);
  const day = date.slice(0, 8);
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const headers: Record<string, string> = { host, ...Object.fromEntries(Object.entries(input.signedHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])) };
  const signedNames = Object.keys(headers).sort();
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.credentials.accessKeyId}/${scope}`,
    "X-Amz-Date": date,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": signedNames.join(";"),
    ...(input.credentials.sessionToken === undefined ? {} : { "X-Amz-Security-Token": input.credentials.sessionToken }),
  };
  const canonicalQuery = Object.keys(query).sort().map((name) => `${encode(name)}=${encode(query[name] ?? "")}`).join("&");
  const canonicalPath = `/${encodePath(input.key)}`;
  const canonicalHeaders = signedNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const canonicalRequest = [input.method, canonicalPath, canonicalQuery, canonicalHeaders, signedNames.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, day), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return `https://${host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
