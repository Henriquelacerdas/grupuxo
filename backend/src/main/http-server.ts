import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { HttpApiResult } from "../lambdas/events.ts";

// Ponte `node:http` → evento da Function URL (payload 2.0), para reaproveitar os handlers das Lambdas sem mudança.
// Sem regra de negócio aqui. Nada é registrado em log.

export type LambdaStyleHandler = (event: unknown) => Promise<HttpApiResult>;

export interface HttpServerHandlers {
  readonly webhook: LambdaStyleHandler;
  readonly api: LambdaStyleHandler;
}

/** Limite do corpo: as mensagens do WhatsApp e as rotas da api são pequenas. */
const MAX_BODY_BYTES = 1024 * 1024;

class BodyTooLargeError extends Error {}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError());
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function headersOf(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers[name] = value;
    else if (Array.isArray(value)) headers[name] = value.join(",");
  }
  return headers;
}

function send(response: ServerResponse, result: HttpApiResult): void {
  response.writeHead(result.statusCode, result.headers ?? {});
  response.end(result.body);
}

async function handle(handlers: HttpServerHandlers, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";
  if (url.pathname === "/health") {
    send(response, { statusCode: 200, headers: { "content-type": "text/plain; charset=utf-8" }, body: "ok" });
    return;
  }
  const handler = url.pathname === "/webhook" ? handlers.webhook : url.pathname.startsWith("/v1/") ? handlers.api : null;
  if (handler === null) {
    send(response, { statusCode: 404, body: "" });
    return;
  }
  const body = await readBody(request);
  const result = await handler({
    rawPath: url.pathname,
    rawQueryString: url.search.startsWith("?") ? url.search.slice(1) : url.search,
    headers: headersOf(request),
    requestContext: { http: { method } },
    body: body.toString("base64"),
    isBase64Encoded: true,
  });
  send(response, result);
}

/** Servidor HTTP que atende `GET/POST /webhook`, `/v1/*` (api) e `GET /health`. */
export function createHttpServer(handlers: HttpServerHandlers): Server {
  return createServer((request, response) => {
    handle(handlers, request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      send(response, { statusCode: error instanceof BodyTooLargeError ? 413 : 500, body: "" });
    });
  });
}
