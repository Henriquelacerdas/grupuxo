import { NextResponse } from "next/server";
import { decode, DecodeError } from "@/lib/api/decode";
import { photoUploadDecoder, photoURLDecoder } from "@/lib/api/types";
import { sameOriginRequest } from "@/server/csrf";
import { callApi } from "@/server/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Foto do perfil: o navegador manda o JPEG (já recortado em 512 px), o BFF pede o URL pré-assinado à `api`,
// envia ao S3 e confirma com `PUT /v1/me/photo`. Assim o bucket não precisa de CORS.
const MAX_PHOTO = 2 * 1024 * 1024;

function error(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!sameOriginRequest("POST", new URL(request.url), request.headers)) return error(403, "forbidden");
  if (request.headers.get("content-type") !== "image/jpeg") return error(415, "bad_request");
  const bytes = new Uint8Array(await request.arrayBuffer());
  // JPEG começa com FF D8 FF.
  if (bytes.length === 0 || bytes.length > MAX_PHOTO || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return error(400, "bad_request");
  try {
    const target = await callApi(request, { method: "POST", path: "/v1/me/photo" });
    if (target === null) return error(401, "unauthorized");
    if (!target.ok) return new NextResponse(await target.text(), { status: target.status, headers: { "content-type": "application/json" } });
    const upload = decode(photoUploadDecoder, await target.json());
    const uploaded = await fetch(upload.uploadURL, { method: "PUT", headers: { ...upload.headers }, body: bytes, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!uploaded.ok) return error(502, "upload_failed");
    const confirmed = await callApi(request, { method: "PUT", path: "/v1/me/photo", body: JSON.stringify({ key: upload.key }) });
    if (confirmed === null) return error(401, "unauthorized");
    if (!confirmed.ok) return new NextResponse(await confirmed.text(), { status: confirmed.status, headers: { "content-type": "application/json" } });
    return NextResponse.json({ photoURL: decode(photoURLDecoder, await confirmed.json()) }, { headers: { "cache-control": "no-store" } });
  } catch (caught) {
    return error(caught instanceof DecodeError ? 502 : 503, "unavailable");
  }
}
