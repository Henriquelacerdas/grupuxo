/** Mensagem que o app reconhece para "código inexistente" (ver HouseService). */
export const INVALID_INVITE_CODE = 'INVALID_INVITE_CODE';

export function normalizeCode(raw: string): string {
    return raw.trim().toUpperCase();
}

/** Devolve a mesma lista (mesma referência) se o `sub` já está nela; senão, uma lista nova com ele no fim. */
export function withMember(members: readonly (string | null)[], sub: string): string[] {
    const clean = members.filter((member): member is string => member !== null);
    return clean.includes(sub) ? (members as string[]) : [...clean, sub];
}
