// "Julia Carvalho" → "Julia C."; nome sem sobrenome fica como está (ResidentNameFormatting do app).
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter((p) => p.length > 0);
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  if (first === undefined) return fullName.trim();
  if (last === undefined) return first;
  return `${first} ${Array.from(last)[0]?.toLocaleUpperCase() ?? ""}.`;
}

/** Até duas iniciais para o avatar. */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter((p) => p.length > 0);
  const letters = [parts[0], parts.length > 1 ? parts[parts.length - 1] : undefined]
    .map((p) => (p === undefined ? "" : (Array.from(p)[0] ?? "")))
    .join("");
  return letters.toLocaleUpperCase();
}
