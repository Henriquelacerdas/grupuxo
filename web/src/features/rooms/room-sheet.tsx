"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Minus, Pencil, Plus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { ROOM_ICON_CHOICES, ROOM_SYMBOLS, RoomIcon, roomColorVar } from "@/components/icons";
import { ConfirmDialog, Sheet } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { Avatar, Section, Toggle, cx } from "@/components/ui";
import { useT } from "@/i18n/provider";
import type { Room, RoomColor } from "@/lib/api/types";
import { rooms as roomsAPI } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { useInvalidateHouse } from "@/lib/client/queries";
import type { Translate } from "@/lib/format/labels";
import { ROOM_NAME_MAX, isLinked, roomNameProblem } from "@/lib/rules/tasks";
import { useHouse } from "../house-context";
import {
  COLOR_CHOICES, COLOR_NAMES, CUSTOM_WEEKS_MAX, ICON_NAMES, CYCLE_KINDS, appearanceSuggestion, clampDraft, createInput, cycleKindOf, draftFrom, intervalWeeksFor,
  isEmptyChange, maxPeople, newDraft, roomChanges, type CycleKind, type RoomDraft,
} from "./appearance";

function cycleTitle(t: Translate, kind: CycleKind): string {
  switch (kind) {
    case "weekly": return t("Semanalmente");
    case "biweekly": return t("A cada 2 semanas");
    case "monthly": return t("Mensalmente");
    case "custom": return t("Personalizado");
  }
}

function cycleSummary(t: Translate, intervalWeeks: number, people: number): string {
  const kind = cycleKindOf(intervalWeeks);
  const when = kind === "monthly" ? t("A cada mês") : intervalWeeks === 1 ? t("A cada semana") : kind === "biweekly" ? t("A cada 2 semanas") : t("A cada {0} semanas", intervalWeeks);
  return t("{0}, {1} pessoas cuidam deste cômodo.", when, people);
}

/** Criar ou editar cômodo (RoomCreationSheetView). Privacidade e participantes só na criação. */
export function RoomSheet({ open, onOpenChange, editing, onCreated }: {
  open: boolean; onOpenChange: (open: boolean) => void; editing?: Room; onCreated?: (room: Room) => void;
}) {
  const { snapshot, userID } = useHouse();
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((n) => n + 1);
  }
  if (!open && session === 0) return null;
  return (
    <RoomForm
      key={session}
      open={open}
      onOpenChange={onOpenChange}
      editing={editing}
      onCreated={onCreated}
      userID={userID}
      residents={snapshot.home.members}
      existingNames={snapshot.home.rooms.filter((room) => room.id !== editing?.id).map((room) => room.name)}
      linkedTaskCount={editing === undefined ? 0 : new Set(snapshot.roomTasks.filter((item) => isLinked(item.definition, editing)).map((item) => item.definition.id)).size}
    />
  );
}

function RoomForm({ open, onOpenChange, editing, onCreated, userID, residents, existingNames, linkedTaskCount }: {
  open: boolean; onOpenChange: (open: boolean) => void; editing: Room | undefined; onCreated: ((room: Room) => void) | undefined;
  userID: string; residents: readonly { id: string; name: string; photoURL: string | null }[]; existingNames: readonly string[]; linkedTaskCount: number;
}) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateHouse();
  const { house } = useHouse();
  const nameID = useId();
  const initial = editing === undefined ? newDraft(userID) : draftFrom(editing);
  const [draft, setDraftState] = useState<RoomDraft>(initial);
  const [cycleKind, setCycleKind] = useState<CycleKind>(cycleKindOf(initial.periodicity.intervalWeeks));
  const [customWeeks, setCustomWeeks] = useState(Math.max(1, initial.periodicity.intervalWeeks));
  const [appearanceEdited, setAppearanceEdited] = useState(editing !== undefined);
  const [showAppearance, setShowAppearance] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmPeriodicity, setConfirmPeriodicity] = useState(false);

  const isEditing = editing !== undefined;
  const isPrivate = draft.visibility === "privateRoom";
  const update = (change: (current: RoomDraft) => RoomDraft) => setDraftState((current) => clampDraft(change(current), residents.length));
  const problem = roomNameProblem(draft.name, existingNames);
  const duplicate = problem === "duplicate";
  const dirty = isEditing
    ? !isEmptyChange(roomChanges(draft, editing))
    : draft.name.trim() !== "" || appearanceEdited || cycleKind !== "weekly" || draft.responsibleCount !== 1 || isPrivate;
  const people = maxPeople(draft, residents.length);

  const save = useMutation({
    mutationFn: async (): Promise<Room | null> => {
      if (editing === undefined) return roomsAPI.create(house.id, createInput(draft));
      const changes = roomChanges(draft, editing);
      return isEmptyChange(changes) ? editing : roomsAPI.update(editing.id, changes);
    },
    onSuccess: async (room) => {
      if (room !== null) {
        toast(isEditing ? t("Cômodo “{0}” atualizado", room.name) : t("Cômodo “{0}” criado", room.name));
        await invalidate();
        if (!isEditing) onCreated?.(room);
      }
      onOpenChange(false);
    },
  });

  const setName = (value: string) => {
    const name = Array.from(value).slice(0, ROOM_NAME_MAX).join("");
    update((current) => {
      const next = { ...current, name };
      if (appearanceEdited) return next;
      const suggestion = appearanceSuggestion(name);
      return suggestion === null ? next : { ...next, icon: suggestion.icon, color: suggestion.color, category: suggestion.category };
    });
  };

  const setCycle = (kind: CycleKind, weeks = customWeeks) => {
    setCycleKind(kind);
    setCustomWeeks(weeks);
    const intervalWeeks = intervalWeeksFor(kind, weeks);
    update((current) => ({ ...current, periodicity: { ...current.periodicity, intervalWeeks } }));
  };

  const periodicityChanged = isEditing && draft.periodicity.intervalWeeks !== editing.periodicity.intervalWeeks;
  const submit = () => {
    if (problem !== null || save.isPending) return;
    if (periodicityChanged && linkedTaskCount > 0) { setConfirmPeriodicity(true); return; }
    save.mutate();
  };
  const close = () => (dirty && !save.isPending ? setConfirmDiscard(true) : onOpenChange(false));
  const kindForName = cycleKindOf(draft.periodicity.intervalWeeks);
  const newPeriodicityName = (kindForName === "custom" ? t("A cada {0} semanas", draft.periodicity.intervalWeeks) : cycleTitle(t, kindForName)).toLocaleLowerCase();

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => (next ? onOpenChange(true) : close())}
        title={isEditing ? t("Editar Cômodo") : t("Novo Cômodo")}
        cancel={{ onSelect: close }}
        confirm={{ label: isEditing ? t("Salvar") : t("Criar cômodo"), onSelect: submit, disabled: problem !== null, loading: save.isPending }}
      >
        <fieldset disabled={save.isPending} className="contents">
          <Section footer={duplicate ? <span className="text-danger">{t("Já existe um cômodo com esse nome.")}</span> : undefined}>
            <div className="flex items-center gap-4 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowAppearance((shown) => !shown)}
                aria-expanded={showAppearance}
                aria-label={t("Ícone e cor do cômodo")}
                title={t("Toque para alterar")}
                className="relative shrink-0 rounded-full"
              >
                <RoomIcon icon={draft.icon} color={draft.color} size={60} />
                <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 inline-flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-card bg-accent-fill text-white">
                  <Pencil size={13} strokeWidth={3} />
                </span>
              </button>
              <label htmlFor={nameID} className="sr-only">{t("Nome do cômodo")}</label>
              <input
                id={nameID}
                value={draft.name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
                placeholder={t("Nome do cômodo")}
                maxLength={ROOM_NAME_MAX}
                autoFocus={!isEditing}
                autoCapitalize="sentences"
                aria-invalid={duplicate || undefined}
                className="min-h-[44px] min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-muted"
              />
            </div>
          </Section>

          {showAppearance && (
            <AppearancePicker
              icon={draft.icon}
              color={draft.color}
              onChange={(icon, color) => { setAppearanceEdited(true); update((current) => ({ ...current, icon, color })); }}
            />
          )}

          <Section title={t("Rodízio")} footer={cycleSummary(t, draft.periodicity.intervalWeeks, draft.responsibleCount)}>
            <SelectRow label={t("Ciclo")} value={cycleKind} onChange={(value) => { const kind = CYCLE_KINDS.find((k) => k === value); if (kind !== undefined) setCycle(kind); }}>
              {CYCLE_KINDS.map((kind) => <option key={kind} value={kind}>{cycleTitle(t, kind)}</option>)}
            </SelectRow>
            {cycleKind === "custom" && (
              <SelectRow label={t("A cada")} value={String(customWeeks)} onChange={(value) => setCycle("custom", Number(value))}>
                {Array.from({ length: CUSTOM_WEEKS_MAX }, (_, i) => i + 1).map((weeks) => (
                  <option key={weeks} value={weeks}>{weeks === 1 ? t("1 semana") : t("{0} semanas", weeks)}</option>
                ))}
              </SelectRow>
            )}
            <div className="flex min-h-[48px] items-center gap-3 px-4 py-2">
              <span className="flex-1" aria-live="polite">{t("Pessoas por ciclo: {0}", draft.responsibleCount)}</span>
              <div className="flex overflow-hidden rounded-[9px] bg-fill">
                <button type="button" aria-label={t("Menos pessoas por ciclo")} disabled={draft.responsibleCount <= 1}
                  onClick={() => update((current) => ({ ...current, responsibleCount: current.responsibleCount - 1 }))}
                  className="inline-flex h-9 w-12 items-center justify-center text-label disabled:opacity-30">
                  <Minus aria-hidden="true" size={18} />
                </button>
                <span aria-hidden="true" className="my-2 w-px bg-separator" />
                <button type="button" aria-label={t("Mais pessoas por ciclo")} disabled={draft.responsibleCount >= people}
                  onClick={() => update((current) => ({ ...current, responsibleCount: current.responsibleCount + 1 }))}
                  className="inline-flex h-9 w-12 items-center justify-center text-label disabled:opacity-30">
                  <Plus aria-hidden="true" size={18} />
                </button>
              </div>
            </div>
          </Section>

          {!isEditing && (
            <Section
              title={t("Privacidade")}
              footer={isPrivate
                ? t("Só os participantes veem este cômodo e entram no rodízio. Outros moradores podem pedir para entrar.")
                : t("Todos os moradores participam do rodízio deste cômodo.")}
            >
              <Toggle
                label={t("Cômodo privado")}
                checked={isPrivate}
                onChange={(on) => update((current) => ({ ...current, visibility: on ? "privateRoom" : "common" }))}
              />
            </Section>
          )}

          {!isEditing && isPrivate && (
            <Section title={t("Participantes")} footer={t("Você participa automaticamente. Os outros moradores podem pedir para entrar depois.")}>
              {residents.map((person) => {
                const id = person.id.toLowerCase();
                const isCreator = id === userID;
                const selected = isCreator || draft.participantIDs.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    disabled={isCreator}
                    onClick={() => update((current) => ({
                      ...current,
                      participantIDs: selected ? current.participantIDs.filter((p) => p !== id) : [...current.participantIDs, id],
                    }))}
                    className="flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-fill disabled:hover:bg-transparent"
                  >
                    <Avatar name={person.name} photoURL={person.photoURL} />
                    <span className="flex-1">{isCreator ? t("Você") : person.name}</span>
                    {selected && <Check aria-hidden="true" size={20} className={isCreator ? "text-muted" : "text-accent"} />}
                  </button>
                );
              })}
            </Section>
          )}

          {save.isError && (
            <p role="alert" className="mb-4 rounded-[var(--radius-control)] bg-danger-soft px-4 py-3 text-[15px] text-danger">{errorMessage(t, save.error)}</p>
          )}
        </fieldset>
      </Sheet>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t("Descartar alterações?")}
        message={isEditing ? t("Ao descartar, as alterações não serão salvas.") : t("Ao descartar, nenhum cômodo será criado.")}
        actions={[{ label: t("Descartar"), destructive: true, onSelect: () => onOpenChange(false) }]}
      />
      <ConfirmDialog
        open={confirmPeriodicity}
        onOpenChange={setConfirmPeriodicity}
        title={t("Mudar a periodicidade do cômodo?")}
        message={t("As tarefas que repetem com o cômodo (a mesma periodicidade dele) também passam a se repetir {0}.", newPeriodicityName)}
        actions={[{ label: t("Mudar"), onSelect: () => save.mutate() }]}
      />
    </>
  );
}

function SelectRow({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-h-[48px] items-center gap-3 px-4 py-2">
      <label htmlFor={id} className="flex-1">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[36px] max-w-[60%] rounded-[8px] bg-transparent text-right text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {children}
      </select>
    </div>
  );
}

/** "Aparência": 12 cores e os ícones do catálogo do app. */
function AppearancePicker({ icon, color, onChange }: { icon: string; color: RoomColor; onChange: (icon: string, color: RoomColor) => void }) {
  const t = useT();
  return (
    <div className="mb-7 rounded-[var(--radius-card)] bg-card p-4">
      <h3 className="mb-2 text-[15px] font-semibold">{t("Cor")}</h3>
      <div role="radiogroup" aria-label={t("Cor")} className="grid grid-cols-6 gap-3">
        {COLOR_CHOICES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === color}
            aria-label={t(COLOR_NAMES[option])}
            onClick={() => onChange(icon, option)}
            className={cx("mx-auto h-11 w-11 rounded-full ring-offset-2 ring-offset-card transition", option === color && "ring-[3px] ring-label/40")}
            style={{ background: roomColorVar(option) }}
          />
        ))}
      </div>
      <h3 className="mb-2 mt-5 text-[15px] font-semibold">{t("Ícone")}</h3>
      <div role="radiogroup" aria-label={t("Ícone")} className="grid grid-cols-6 gap-3">
        {ROOM_ICON_CHOICES.map((symbol) => {
          const Glyph = ROOM_SYMBOLS[symbol];
          if (Glyph === undefined) return null;
          const selected = symbol === icon;
          return (
            <button
              key={symbol}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={t(ICON_NAMES[symbol] ?? "Ícone")}
              onClick={() => onChange(symbol, color)}
              className={cx("mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full transition", selected ? "text-white" : "bg-fill text-label")}
              style={selected ? { background: roomColorVar(color) } : undefined}
            >
              <Glyph aria-hidden="true" size={20} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
