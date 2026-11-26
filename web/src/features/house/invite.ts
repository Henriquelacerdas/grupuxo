import type { House } from "@/lib/api/types";
import type { Translate } from "@/lib/format/labels";

// Convite: o mesmo texto do app mais o link do web, que leva ao cadastro/login e entra na casa pelo código.

export const inviteURL = (origin: string, code: string): string => `${origin}/invite/${encodeURIComponent(code.toUpperCase())}`;

export const inviteText = (t: Translate, house: House): string => t("Entre na casa \"{0}\" no Reveza com o código {1}.", house.name, house.accessCode);

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

/** Compartilhar do sistema quando houver (celular); senão copia texto + link. */
export async function shareInvite(t: Translate, house: House): Promise<ShareResult> {
  const text = inviteText(t, house);
  const url = inviteURL(window.location.origin, house.accessCode);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Reveza", text, url });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  return (await copyText(`${text} ${url}`)) ? "copied" : "failed";
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
