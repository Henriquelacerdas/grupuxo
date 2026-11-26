import type { Translate } from "@/lib/format/labels";

// Regras puras das telas de conta, portadas do `AuthService` do app (mesmas mensagens do catálogo).

/** Dica de senha do app (a regra real é a do user pool; o Cognito recusa a fraca com `invalid_password`). */
export const PASSWORD_RULES = "Pelo menos 6 caracteres, com uma letra minúscula.";

/** E-mail aparado e em minúsculas, como `AuthService.normalizedEmail`. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Destino depois de entrar: só caminhos da própria origem ("/app", "/invite/ABC123"). Recusa "//host",
 * "/\\host", esquemas e caracteres de controle, para o `?next=` não virar redirecionamento aberto.
 */
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  return next;
}

/** `?next=` repassado entre as telas de conta (login ⇄ cadastro ⇄ esqueci a senha). */
export function withNext(path: string, next: string): string {
  return next === "/app" ? path : `${path}?next=${encodeURIComponent(next)}`;
}

/** Nome sugerido no primeiro passo: o início do e-mail (nunca o relay privado da Apple, que é aleatório). */
export function nameFromEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (normalized === "" || normalized.endsWith("@privaterelay.appleid.com")) return "";
  return normalized.split("@")[0] ?? "";
}

export type AuthStep = "signIn" | "signUp" | "confirm" | "resend" | "forgot" | "reset";

/** Mensagem ao morador para o código de erro do BFF (`/api/auth/*`) em cada passo. */
export function authErrorMessage(t: Translate, code: string, step: AuthStep): string {
  const weak = t("Senha fraca. {0}", t(PASSWORD_RULES));
  switch (code) {
    case "network": return t("Sem conexão com a internet. Tente de novo.");
    case "limit_exceeded": return t("Muitas tentativas seguidas. Espere alguns minutos e tente de novo.");
    case "user_not_confirmed": return t("Confirme seu e-mail com o código que enviamos antes de entrar.");
    case "code_mismatch": return t("Código incorreto. Confira o último e-mail recebido.");
    case "expired_code": return t("O código expirou. Toque em \"Reenviar código\".");
    case "invalid_password": return weak;
    case "invalid_credentials":
    case "user_not_found":
      if (step === "signIn") return t("E-mail ou senha incorretos. Tente de novo ou toque em Esqueci a senha.");
      if (step === "forgot") return t("Não encontramos uma conta com este e-mail.");
      if (step === "confirm") return t("Não encontramos uma conta com este e-mail. Cadastre-se de novo.");
      return t("Não foi possível concluir agora. Tente de novo em instantes.");
    case "username_exists":
      return step === "confirm" ? t("Já existe outra conta confirmada com este e-mail. Entre com ela.") : t("Esse e-mail já tem uma conta no Reveza.");
    case "invalid_parameter":
      if (step === "signUp") return t("Confira o e-mail e a senha. {0}", t(PASSWORD_RULES));
      // O e-mail já passou pela validação do BFF: no reenvio, o Cognito só recusa a conta já confirmada.
      if (step === "resend") return t("Esta conta já está confirmada. Volte e entre com sua senha.");
      if (step === "reset") return weak;
      return t("Não foi possível concluir agora. Tente de novo em instantes.");
    case "unavailable":
      return step === "resend" || step === "forgot" || step === "signUp"
        ? t("Não conseguimos enviar o e-mail com o código. Tente de novo em alguns minutos.")
        : t("Não foi possível concluir agora. Tente de novo em instantes.");
    default:
      return t("Não foi possível concluir agora. Tente de novo em instantes.");
  }
}

/** "[Termos de Uso](url)" → partes de texto e link (sem HTML cru). Só aceita URLs https. */
export type LegalPart = { readonly text: string; readonly href?: string };
export function parseLinks(text: string): LegalPart[] {
  const parts: LegalPart[] = [];
  const pattern = /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > last) parts.push({ text: text.slice(last, index) });
    parts.push({ text: match[1] ?? "", href: match[2] ?? "" });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
