"use client";

import { Bookmark, Check, Flag, House, Info, Lock, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { Button, EmptyState, IconButton } from "@/components/ui";
import { RoomIcon } from "@/components/icons";
import { useT } from "@/i18n/provider";
import type { Room, TaskItem } from "@/lib/api/types";
import { tasks } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { useInvalidateHouse } from "@/lib/client/queries";
import { shortName } from "@/lib/format/names";
import { isCompleted } from "@/lib/rules/tasks";
import { useHouse } from "@/features/house-context";
import { useAlert } from "./alert";
import {
  NO_STAGING, canClaim, canManage, canRelease, hasChanges, holder, prune, stageClaim, stageRelease, takenByAnother, writePlan, type Staging,
} from "./sporadic";

interface Card { readonly item: TaskItem; readonly room: Room }

/** Tarefas Únicas (SporadicTasksView): pegar e devolver ficam marcados até "Confirmar alterações". */
export function SporadicTasks() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateHouse();
  const { snapshot, userID } = useHouse();
  const { show: showAlert, node: alertNode } = useAlert();
  const [staging, setStaging] = useState<Staging>(NO_STAGING);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<{ kind: "discard"; href: string | null } | { kind: "release" } | { kind: "delete"; card: Card } | null>(null);

  const cards = useMemo<Card[]>(() => snapshot.sporadicTasks.flatMap((item) => {
    const room = snapshot.home.rooms.find((r) => r.id === item.definition.roomID);
    return room === undefined ? [] : [{ item, room }];
  }), [snapshot]);
  const memberRoomIDs = useMemo(() => new Set(snapshot.participations.filter((p) => p.isMember).map((p) => p.room.id)), [snapshot]);

  // Ocorrências que saíram da lista (outro morador apagou) não ficam marcadas.
  const validIDs = useMemo(() => new Set(cards.map((c) => c.item.occurrence.id)), [cards]);
  const current = prune(staging, validIDs);
  const dirty = hasChanges(current);
  const pendingCount = cards.filter((c) => !isCompleted(c.item)).length;

  const leave = useCallback((href: string | null) => {
    if (href !== null) router.push(href);
    else if (window.history.length > 1) router.back();
    else router.push("/app/house");
  }, [router]);

  // Sair com uma tarefa escolhida e não confirmada pede confirmação (fechar, links do app e fechar a aba).
  const hasClaims = current.claims.size > 0;
  const claimsRef = useRef(hasClaims);
  useEffect(() => { claimsRef.current = hasClaims; }, [hasClaims]);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => { if (claimsRef.current) event.preventDefault(); };
    const onClick = (event: MouseEvent) => {
      if (!claimsRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (anchor === null || !(anchor instanceof HTMLAnchorElement) || anchor.origin !== window.location.origin) return;
      event.preventDefault();
      setDialog({ kind: "discard", href: `${anchor.pathname}${anchor.search}` });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); document.removeEventListener("click", onClick, true); };
  }, []);

  const close = () => {
    if (hasClaims) { setDialog({ kind: "discard", href: null }); return; }
    setStaging(NO_STAGING);
    leave(null);
  };

  const commit = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    const plan = writePlan(current);
    let remaining = current;
    try {
      for (const id of plan.releases) { await tasks.release(id); remaining = { ...remaining, releases: new Set([...remaining.releases].filter((x) => x !== id)) }; }
      for (const id of plan.claims) { await tasks.claim(id); remaining = { ...remaining, claims: new Set([...remaining.claims].filter((x) => x !== id)) }; }
      setStaging(NO_STAGING);
      claimsRef.current = false;
      await invalidate();
      leave(null);
    } catch (error) {
      setStaging(remaining);
      showAlert(t("Não foi possível realizar a ação"), errorMessage(t, error));
      await invalidate();
    } finally {
      setSaving(false);
    }
  };

  const confirm = () => {
    if (current.releases.size > 0) setDialog({ kind: "release" });
    else void commit();
  };

  const remove = async (card: Card) => {
    try {
      await tasks.remove(card.item.definition.roomID, card.item.definition.id);
      toast(t("Tarefa Única apagada"));
      await invalidate();
    } catch (error) {
      showAlert(t("Não foi possível realizar a ação"), errorMessage(t, error));
    }
  };

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between pt-2">
        <IconButton label={t("Fechar")} icon={X} onClick={close} />
        <button
          type="button"
          aria-label={t("Confirmar alterações")}
          title={t("Confirmar alterações")}
          disabled={!dirty || saving}
          onClick={confirm}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent-fill text-on-accent transition hover:brightness-110 disabled:bg-fill disabled:text-muted"
        >
          <Check aria-hidden="true" size={22} strokeWidth={2.5} />
        </button>
      </div>

      <header className="flex flex-col items-center pt-4 text-center">
        <span aria-hidden="true" className="mb-2 flex h-[100px] w-[100px] items-center justify-center rounded-full bg-card">
          <Flag size={44} className="text-[var(--room-red)]" fill="currentColor" />
        </span>
        <h1 className="font-rounded text-[34px] font-bold leading-tight">{t("Tarefas Únicas")}</h1>
        <p>{t("{0} tarefas pendentes", pendingCount)}</p>
      </header>

      <p className="mt-5 flex items-start gap-2 text-[13px] text-secondary">
        <Info aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
        {t("Quem faz uma tarefa única pula a vez na próxima tarefa de repetição própria.")}
      </p>

      {cards.length === 0 ? (
        <EmptyState icon={Flag} title={t("Nenhuma Tarefa Única")} message={t("Quando uma Tarefa Única for criada, ela aparecerá aqui.")} />
      ) : (
        <ul className="mt-5 space-y-4">
          {cards.map((card) => {
            const { item, room } = card;
            const who = holder(current, item, userID);
            const release = canRelease(current, item, userID);
            const claim = canClaim(current, item, memberRoomIDs.has(room.id));
            const name = item.definition.name;
            return (
              <li key={item.occurrence.id} className="rounded-[var(--radius-card)] bg-card p-4">
                <div className="flex items-center gap-3">
                  <RoomIcon icon={room.icon} color={room.color} size={48} />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[20px] font-semibold">{name}</h2>
                    <p className="flex items-center gap-2"><House aria-hidden="true" size={16} />{t("em ")}<strong>{room.name}</strong></p>
                    {who !== null && (
                      <p className="flex items-center gap-2">
                        <UserRound aria-hidden="true" size={16} />{t("Para ")}
                        <strong>{who.kind === "you" ? t("Você") : who.name === null ? t("Outro morador") : shortName(who.name)}</strong>
                      </p>
                    )}
                  </div>
                </div>
                {takenByAnother(current, item, userID) && (
                  <p className="mt-2 flex items-center gap-2 text-[15px] font-semibold text-secondary">
                    <Bookmark aria-hidden="true" size={16} />
                    {t("{0} já pegou essa tarefa", item.assignee === null ? t("Outro morador") : shortName(item.assignee.name))}
                  </p>
                )}
                {!isCompleted(item) && item.assignment === null && !memberRoomIDs.has(room.id) && (
                  <p className="mt-2 flex items-center gap-2 text-[15px] font-semibold text-secondary">
                    <Lock aria-hidden="true" size={16} />{t("Você não participa de {0}", room.name)}
                  </p>
                )}
                {!isCompleted(item) && (
                  <Button
                    className="mt-3 w-full"
                    variant={release ? "secondary" : "primary"}
                    disabled={saving || (!claim && !release)}
                    onClick={() => setStaging((s) => (claim ? stageClaim(prune(s, validIDs), item.occurrence.id) : stageRelease(prune(s, validIDs), item.occurrence.id)))}
                  >
                    {release ? t("Desfazer") : t("Adicionar às minhas tarefas")}
                  </Button>
                )}
                {current.claims.has(item.occurrence.id) && <p className="mt-1 text-[13px] text-secondary">{t("Será adicionada para você")}</p>}
                {canManage(current, item, userID) && (
                  <div className="mt-2 grid gap-2">
                    <Link
                      href={`/app/tasks/${encodeURIComponent(item.definition.id.toLowerCase())}`}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-fill text-[17px] font-semibold text-accent"
                    >
                      {t("Editar")}
                    </Link>
                    <Button variant="destructive" aria-label={t("Apagar {0}", name)} onClick={() => setDialog({ kind: "delete", card })}>{t("Apagar")}</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={dialog?.kind === "discard"}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        title={t("Descartar alterações?")}
        message={t("Ao descartar as alterações nenhuma Tarefa Única será atribuída a você.")}
        actions={[{
          label: t("Descartar"), destructive: true,
          onSelect: () => {
            const href = dialog?.kind === "discard" ? dialog.href : null;
            setStaging(NO_STAGING);
            claimsRef.current = false;
            leave(href);
          },
        }]}
      />
      <ConfirmDialog
        open={dialog?.kind === "release"}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        title={t("Tirar tarefa das suas?")}
        message={t("As tarefas marcadas com \"Desfazer\" deixam de ser suas e voltam a ficar livres para os outros moradores.")}
        actions={[{ label: t("Confirmar"), destructive: true, onSelect: () => void commit() }]}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        title={t("Apagar Tarefa Única?")}
        message={dialog?.kind === "delete" ? t("A tarefa \"{0}\" será apagada para todos os moradores.", dialog.card.item.definition.name) : ""}
        actions={[{ label: t("Apagar"), destructive: true, onSelect: () => { if (dialog?.kind === "delete") void remove(dialog.card); } }]}
      />
      {alertNode}
    </div>
  );
}
