import { normalizeInviteCode } from "@/lib/rules/tasks";

// Código do link de convite guardado na aba enquanto a pessoa cria a conta ou entra (sessionStorage some no logout).
const KEY = "reveza.pendingInvite";

export const INVITE_CODE_LENGTH = 6;

/** Código válido do link (`/invite/abc123` → "ABC123"); `null` quando não tem 6 letras ou números. */
export function inviteCodeFromPath(raw: string): string | null {
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (!/^[A-Za-z0-9]{6}$/.test(decoded.trim())) return null;
  return normalizeInviteCode(decoded);
}

export function savePendingInvite(code: string): void {
  try { sessionStorage.setItem(KEY, code); } catch { /* armazenamento bloqueado */ }
}

export function readPendingInvite(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    return value === null ? null : inviteCodeFromPath(value);
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* armazenamento bloqueado */ }
}

/** Link e texto do convite (o mesmo texto do `ShareLink` do app, mais o link do web). */
export function inviteLink(origin: string, code: string): string {
  return `${origin}/invite/${encodeURIComponent(code)}`;
}
