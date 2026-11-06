import { connect, type ClientHttp2Session } from "node:http2";
import type { ApnsTransport } from "../push/apns-sender.ts";

/** HTTP/2 para o APNs (`node:http2`): uma sessão por host, reaproveitada; refeita se cair. Só o status volta. */
export class Http2ApnsTransport implements ApnsTransport {
  private readonly sessions = new Map<string, ClientHttp2Session>();

  private session(host: string): ClientHttp2Session {
    const existing = this.sessions.get(host);
    if (existing !== undefined && !existing.closed && !existing.destroyed) return existing;
    const created = connect(`https://${host}`);
    created.on("error", () => this.sessions.delete(host));
    created.on("close", () => this.sessions.delete(host));
    this.sessions.set(host, created);
    return created;
  }

  post(host: string, path: string, headers: Readonly<Record<string, string>>, body: string): Promise<{ readonly status: number }> {
    return new Promise((resolve, reject) => {
      const request = this.session(host).request({ ":method": "POST", ":path": path, ...headers });
      request.setTimeout(10_000, () => request.close());
      let status = 0;
      request.on("response", (responseHeaders) => { status = Number(responseHeaders[":status"] ?? 0); });
      request.on("error", reject);
      request.on("close", () => (status === 0 ? reject(new Error("apnsNoResponse")) : resolve({ status })));
      request.resume();
      request.end(body);
    });
  }
}
