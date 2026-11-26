import { DecodeError, decode, isRecord, type Decoder } from "@/lib/api/decode";
import type { Translate } from "@/lib/format/labels";

// Chamadas do navegador ao BFF (mesma origem). Toda mutação leva `X-Reveza: 1` (CSRF). Erro vira `ApiError` com
// o código da `api` (`{ "error" }`) e o status; a mensagem ao morador vem de `errorMessage`, como no app.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

let onUnauthorized: (() => void) | null = null;
/** O app registra aqui o que fazer quando a sessão acaba (volta ao login). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export async function request(method: Method, url: string, body?: unknown, init?: { contentType?: string; raw?: BodyInit }): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "x-reveza": "1",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init?.contentType !== undefined ? { "content-type": init.contentType } : {}),
      },
      ...(init?.raw !== undefined ? { body: init.raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network");
  }
  if (response.status === 204) return null;
  let payload: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }
  if (!response.ok) {
    const code = isRecord(payload) && typeof payload["error"] === "string" ? payload["error"] : "unknown";
    if (response.status === 401 && url.startsWith("/api/v1")) onUnauthorized?.();
    throw new ApiError(response.status, code);
  }
  return payload;
}

/** `GET`/mutação na `api` pelo proxy `/api/v1`. */
export async function api<T>(method: Method, path: string, decoder: Decoder<T>, body?: unknown): Promise<T> {
  const payload = await request(method, `/api${path}`, body);
  try {
    return decode(decoder, payload);
  } catch (error) {
    if (error instanceof DecodeError) throw new ApiError(200, "invalid_response");
    throw error;
  }
}

/** Mutação sem corpo de resposta. */
export async function send(method: Method, path: string, body?: unknown): Promise<void> {
  await request(method, `/api${path}`, body);
}

/** Mensagens dos códigos da `api` (as mesmas do `APIClient` do app). */
export function errorMessage(t: Translate, error: unknown): string {
  if (!(error instanceof ApiError)) return t("Não foi possível concluir a ação.");
  switch (error.code) {
    case "network": return t("Não foi possível falar com o servidor agora. Tente de novo em instantes.");
    case "unauthorized": return t("Sua sessão expirou. Entre novamente.");
    case "invalid_response": return t("O servidor respondeu algo inesperado.");
    case "method_not_allowed": return t("Esta função ainda não está disponível.");
    case "invalid_name": return t("Informe um nome válido.");
    case "invalid_house_name": return t("Informe um nome para a casa.");
    case "invalid_timezone": return t("Fuso horário inválido.");
    case "invalid_code": return t("Não achamos uma casa com esse código. Confira com quem te mandou.");
    case "already_in_house": return t("Você já faz parte de uma casa.");
    case "no_house": return t("Você ainda não faz parte de uma casa.");
    case "house_deletion_confirmation_required": return t("Você é o último morador: se sair, a casa, os cômodos e as tarefas serão excluídos.");
    case "room_deletion_confirmation_required": return t("Você é o último participante de um cômodo: se sair, o cômodo e suas tarefas serão excluídos.");
    case "whole_house_protected": return t("Casa toda sempre inclui todos os moradores.");
    case "invalid_room_name": return t("Informe um nome para o cômodo.");
    case "invalid_room_participants": return t("O cômodo precisa ter participantes válidos.");
    case "invalid_task_name": return t("Informe um nome para a tarefa.");
    case "invalid_schedule": return t("A periodicidade e a política da tarefa são incompatíveis.");
    case "task_unavailable": return t("Esta tarefa não está disponível.");
    case "task_already_completed": return t("Esta tarefa já foi concluída.");
    case "no_eligible_members": return t("O cômodo não possui participantes elegíveis.");
    case "already_linked": return t("Você já tem um WhatsApp conectado.");
    case "not_found": return t("Item não encontrado.");
    case "conflict": return t("Alguém mexeu na casa ao mesmo tempo. Tente de novo.");
    case "account_not_registered": return t("Sua conta ainda não foi registrada. Tente novamente.");
    case "limit_exceeded": return t("Muitas tentativas seguidas. Espere alguns minutos e tente de novo.");
    case "photos_unavailable":
    case "push_unavailable": return t("Esta função ainda não está disponível.");
    default:
      return error.status >= 500 || error.status === 0
        ? t("O servidor não conseguiu atender agora. Tente de novo em instantes.")
        : t("Não foi possível concluir a ação.");
  }
}
