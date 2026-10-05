// Eventos no formato do API Gateway HTTP API v2 e do SQS, para os testes das Lambdas.

export interface HttpEventOptions {
  readonly method?: string;
  readonly path?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Corpo como bytes: vai em base64 se `base64`, senão decodificado como UTF-8. */
  readonly body?: Uint8Array | string;
  readonly base64?: boolean;
  readonly rawQueryString?: string;
}

export function httpEvent(options: HttpEventOptions = {}): Record<string, unknown> {
  const { method = "GET", path = "/", headers = {}, body, base64 = false, rawQueryString = "" } = options;
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return {
    version: "2.0",
    rawPath: path,
    rawQueryString,
    headers,
    requestContext: { http: { method, path } },
    ...(bytes === undefined
      ? {}
      : { body: base64 ? Buffer.from(bytes).toString("base64") : new TextDecoder().decode(bytes), isBase64Encoded: base64 }),
  };
}

export interface SqsRecordOptions {
  readonly messageId: string;
  readonly body: string;
  readonly group?: string;
}

export function sqsEvent(...records: SqsRecordOptions[]): Record<string, unknown> {
  return {
    Records: records.map((record) => ({
      messageId: record.messageId,
      body: record.body,
      attributes: record.group === undefined ? {} : { MessageGroupId: record.group },
    })),
  };
}
