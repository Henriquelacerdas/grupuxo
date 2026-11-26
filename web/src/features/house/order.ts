// Ordem dos cômodos na aba Casa: escolhida pelo morador e guardada só na sessão (no app, um @State da tela).
// Os cômodos de que ele participa trocam de lugar entre si; os restritos ficam onde estavam.

export function applyRoomOrder<T extends { readonly id: string }>(rows: readonly T[], isMember: (row: T) => boolean, orderedIDs: readonly string[]): T[] {
  if (orderedIDs.length === 0) return [...rows];
  const members = rows.filter(isMember);
  const byID = new Map(members.map((row) => [row.id, row]));
  const ordered = orderedIDs.flatMap((id) => {
    const row = byID.get(id);
    return row === undefined ? [] : [row];
  });
  const placed = new Set(ordered.map((row) => row.id));
  ordered.push(...members.filter((row) => !placed.has(row.id)));
  let next = 0;
  return rows.map((row) => {
    if (!isMember(row)) return row;
    const replacement = ordered[next];
    next += 1;
    return replacement ?? row;
  });
}

/** Move o item de `from` para `to` (botões "subir/descer" do reordenar). */
export function move<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  if (item !== undefined) copy.splice(to, 0, item);
  return copy;
}

const KEY_PREFIX = "reveza.roomOrder.";

export function loadOrder(houseID: string): string[] {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + houseID.toLowerCase());
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function saveOrder(houseID: string, ids: readonly string[]): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + houseID.toLowerCase(), JSON.stringify(ids));
  } catch {
    // armazenamento bloqueado: a ordem vale até recarregar a página
  }
}
