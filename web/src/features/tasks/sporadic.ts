import type { TaskItem } from "@/lib/api/types";
import { isCompleted } from "@/lib/rules/tasks";

// Tarefas Únicas (SporadicTasksViewModel): pegar e devolver ficam só marcados na tela até "Confirmar alterações";
// ao confirmar, primeiro as devoluções, depois as novas atribuições.

export interface Staging {
  readonly claims: ReadonlySet<string>;
  readonly releases: ReadonlySet<string>;
}

export const NO_STAGING: Staging = { claims: new Set(), releases: new Set() };

const without = (set: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

/** "Adicionar": se a tarefa era sua e estava marcada para "Desfazer", só cancela essa marcação. */
export function stageClaim(staging: Staging, id: string): Staging {
  if (staging.releases.has(id)) return { ...staging, releases: without(staging.releases, id) };
  return { ...staging, claims: new Set([...staging.claims, id]) };
}

/** "Desfazer": se acabou de escolher, só cancela a escolha; senão marca para devolver. */
export function stageRelease(staging: Staging, id: string): Staging {
  if (staging.claims.has(id)) return { ...staging, claims: without(staging.claims, id) };
  return { ...staging, releases: new Set([...staging.releases, id]) };
}

export const hasChanges = (staging: Staging): boolean => staging.claims.size > 0 || staging.releases.size > 0;

/** Some com marcações de ocorrências que não estão mais na lista. */
export function prune(staging: Staging, validIDs: ReadonlySet<string>): Staging {
  const keep = (set: ReadonlySet<string>) => new Set([...set].filter((id) => validIDs.has(id)));
  const claims = keep(staging.claims);
  const releases = keep(staging.releases);
  return claims.size === staging.claims.size && releases.size === staging.releases.size ? staging : { claims, releases };
}

/** Ordem das escritas: devoluções, depois atribuições (cada lista por ID, para ser determinística). */
export function writePlan(staging: Staging): { readonly releases: readonly string[]; readonly claims: readonly string[] } {
  return { releases: [...staging.releases].sort(), claims: [...staging.claims].sort() };
}

export function canClaim(staging: Staging, item: TaskItem, isRoomMember: boolean): boolean {
  if (isCompleted(item)) return false;
  const id = item.occurrence.id;
  if (staging.releases.has(id)) return true;
  if (staging.claims.has(id)) return false;
  return item.assignment === null && isRoomMember;
}

export function canRelease(staging: Staging, item: TaskItem, userID: string): boolean {
  if (isCompleted(item)) return false;
  const id = item.occurrence.id;
  if (staging.claims.has(id)) return true;
  if (staging.releases.has(id)) return false;
  return item.assignment?.userID === userID;
}

/** Editar e apagar: só quem está com a tarefa aberta (e sem "Desfazer" marcado). */
export function canManage(staging: Staging, item: TaskItem, userID: string): boolean {
  return !isCompleted(item) && !staging.releases.has(item.occurrence.id) && item.assignment?.userID === userID;
}

export type Holder = { readonly kind: "you" } | { readonly kind: "other"; readonly name: string | null } | null;

/** Para quem a tarefa está, contando o que foi marcado e ainda não confirmado. */
export function holder(staging: Staging, item: TaskItem, userID: string): Holder {
  const id = item.occurrence.id;
  if (staging.releases.has(id)) return null;
  if (staging.claims.has(id)) return { kind: "you" };
  if (item.assignment === null) return null;
  if (item.assignment.userID === userID) return { kind: "you" };
  return { kind: "other", name: item.assignee?.name ?? null };
}

/** Outro morador já pegou (e não há marcação local sobre ela). */
export function takenByAnother(staging: Staging, item: TaskItem, userID: string): boolean {
  const id = item.occurrence.id;
  return !isCompleted(item) && !staging.claims.has(id) && !staging.releases.has(id) && item.assignment !== null && item.assignment.userID !== userID;
}
