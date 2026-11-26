// Contrato mínimo de HTTP de saída. Quem chama um serviço externo (JWKS do Cognito, Gemini, Graph API) recebe
// um `HttpFetch` por parâmetro: em produção, o `fetch` global do Node (que já satisfaz este tipo); nos testes,
// uma função falsa, sem rede.

export interface HttpRequestInit {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type HttpFetch = (url: string, init: HttpRequestInit) => Promise<HttpResponse>;

/** Requisição com corpo binário (o corpo cifrado do Web Push). O `fetch` global também satisfaz `HttpBinaryFetch`. */
export interface HttpBinaryRequestInit {
  readonly method: "POST" | "PUT";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly signal?: AbortSignal;
}

export type HttpBinaryFetch = (url: string, init: HttpBinaryRequestInit) => Promise<HttpResponse>;
