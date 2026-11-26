"use client";

import { Flag, House, Minus, Plus, Repeat, Zap } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Sheet } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { Toggle, cx } from "@/components/ui";
import { useT } from "@/i18n/provider";
import type { Frequency, Recurrence, Room, RoomCategory, TaskDefinition } from "@/lib/api/types";
import { tasks } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { useInvalidateHouse } from "@/lib/client/queries";
import suggestionCatalog from "@/lib/shared/task-suggestions.json";
import { effortName } from "@/lib/format/labels";
import { useHouse } from "@/features/house-context";
import {
  applyChange, canSave, changesRepetitionMode, createInput, editChanges, editDraft, isRoomPeriodicity, newDraft, selectRecurrence,
  setFollowsRoom, weeklyPeriodicity, type DraftContext, type TaskDraft,
} from "./draft";
import { FREQUENCY_ORDER, RECURRENCE_PRESETS, frequencyName, intervalName, periodicityName, recurrenceName, recurrenceSummary, unitName } from "./recurrence";

interface Suggestion { readonly id: string; readonly name: string; readonly details: string; readonly effort: number }

function suggestionsFor(category: RoomCategory): readonly Suggestion[] {
  const all: Readonly<Record<string, readonly Suggestion[] | undefined>> = suggestionCatalog;
  return all[category] ?? [];
}

/**
 * A única sheet de criar/editar tarefa (TaskCreationSheetView). `roomID` pré-seleciona o cômodo (detalhe do
 * cômodo); `editing` abre em modo edição.
 */
export function TaskSheet(props: { open: boolean; onOpenChange: (open: boolean) => void; roomID?: string | null; editing?: TaskDefinition }) {
  if (!props.open) return null;
  return <TaskSheetContent {...props} />;
}

function TaskSheetContent({ onOpenChange, roomID, editing }: { onOpenChange: (open: boolean) => void; roomID?: string | null; editing?: TaskDefinition }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateHouse();
  const { snapshot } = useHouse();
  const isEditing = editing !== undefined;

  const ctx = useMemo<DraftContext>(() => {
    const rooms: Room[] = snapshot.participations.filter((p) => p.isMember).map((p) => p.room);
    const editingRoom = editing === undefined ? undefined : snapshot.home.rooms.find((room) => room.id === editing.roomID);
    if (editingRoom !== undefined && !rooms.some((room) => room.id === editingRoom.id)) rooms.push(editingRoom);
    return { rooms, isEditing };
  }, [snapshot, editing, isEditing]);

  const [initial] = useState<TaskDraft>(() => (editing === undefined ? newDraft(ctx, roomID ?? null) : editDraft(editing, ctx)));
  const [draft, setDraft] = useState<TaskDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const change = (next: TaskDraft) => setDraft((previous) => applyChange(previous, next, ctx));
  const room = ctx.rooms.find((r) => r.id === draft.roomID);
  const isUnique = draft.kind === "sporadic";

  const existingNames = useMemo(() => {
    if (room === undefined) return new Set<string>();
    return new Set([...snapshot.roomTasks, ...snapshot.sporadicTasks].filter((i) => i.definition.roomID === room.id).map((i) => i.definition.name.toLocaleLowerCase()));
  }, [room, snapshot]);
  const suggestions = !isEditing && room !== undefined
    ? suggestionsFor(room.category).filter((s) => !existingNames.has(t(s.name).toLocaleLowerCase())).slice(0, 8)
    : [];

  const save = async () => {
    if (saving || !canSave(draft, initial, isEditing)) return;
    if (draft.roomID === null) { setError(t("Selecione um cômodo.")); return; }
    setSaving(true);
    setError(null);
    try {
      const saved = editing === undefined
        ? await tasks.create(draft.roomID, createInput(draft))
        : await tasks.update(editing.roomID, editing.id, editChanges(editing, initial, draft));
      toast(isEditing ? t("Tarefa “{0}” atualizada", saved.name) : t("Tarefa “{0}” criada", saved.name));
      await invalidate();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(t, e));
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!saving) onOpenChange(open); }}
      title={isEditing ? t("Editar Tarefa") : t("Criar Tarefa")}
      confirm={{ label: t("Salvar"), onSelect: () => void save(), disabled: !canSave(draft, initial, isEditing), loading: saving }}
    >
      <fieldset disabled={saving} className="space-y-4">
        <div className="space-y-3">
          <label className="sr-only" htmlFor="task-title">{t("Título da tarefa")}</label>
          <input
            id="task-title"
            value={draft.name}
            onChange={(e) => change({ ...draft, name: e.target.value })}
            placeholder={t("Título")}
            autoComplete="off"
            maxLength={120}
            className="min-h-[52px] w-full rounded-[var(--radius-card)] bg-card px-4 text-[17px] font-medium outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
          />
          <label className="sr-only" htmlFor="task-details">{t("Descrição da tarefa")}</label>
          <textarea
            id="task-details"
            value={draft.details}
            onChange={(e) => change({ ...draft, details: e.target.value })}
            placeholder={t("Descrição")}
            rows={2}
            maxLength={500}
            className="block min-h-[52px] w-full resize-none rounded-[var(--radius-card)] bg-card px-4 py-3.5 text-[17px] font-medium outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
          />
        </div>

        {suggestions.length > 0 && draft.name.trim() === "" && (
          <div>
            <h3 className="mb-2 px-4 text-[13px] uppercase tracking-wide text-secondary">{t("Sugestões")}</h3>
            <ul className="flex flex-wrap gap-2 px-1">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => change({ ...draft, name: t(s.name), details: s.details === "" ? draft.details : t(s.details), effort: s.effort })}
                    className="min-h-[36px] rounded-full bg-accent-soft px-3.5 text-[15px] font-medium text-accent transition hover:brightness-105"
                  >
                    {t(s.name)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!isEditing && (
          <div className="overflow-hidden rounded-[var(--radius-card)] bg-card">
            <Toggle
              label={<span className="flex items-center gap-2"><Flag aria-hidden="true" size={18} className="text-accent" />{t("Tarefa Única")}</span>}
              checked={isUnique}
              onChange={(unique) => change({ ...draft, kind: unique ? "sporadic" : "recurring" })}
            />
          </div>
        )}

        <Card>
          <RowLabel icon={<House aria-hidden="true" size={18} />} htmlFor="task-room">{t("Cômodo")}</RowLabel>
          <select
            id="task-room"
            value={draft.roomID ?? ""}
            disabled={isEditing}
            onChange={(e) => change({ ...draft, roomID: e.target.value === "" ? null : e.target.value })}
            className="min-h-[44px] max-w-[60%] truncate rounded-[8px] bg-transparent text-right text-[17px] text-secondary outline-none disabled:opacity-70"
          >
            <option value="">{t("Nenhum")}</option>
            {ctx.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Card>

        {isUnique && !isEditing && <Footer>{t("Qualquer morador pode adicionar às suas tarefas.")}</Footer>}

        {!isUnique && (
          <div className="space-y-2">
            <div className={cx("overflow-hidden rounded-[var(--radius-card)] bg-card", room === undefined && "opacity-60")}>
              <Toggle
                label={<span className="flex items-center gap-2"><Repeat aria-hidden="true" size={18} className="text-accent" />{t("Repetir com o cômodo")}</span>}
                checked={room !== undefined && draft.followsRoom}
                disabled={room === undefined}
                onChange={(follows) => setDraft((d) => setFollowsRoom(d, follows, ctx))}
              />
            </div>
            {room !== undefined && !draft.followsRoom && (
              <>
                <Card>
                  <RowLabel icon={<Repeat aria-hidden="true" size={18} />} htmlFor="task-recurrence">{t("Repetição")}</RowLabel>
                  <RecurrenceSelect
                    draft={draft}
                    room={room}
                    onSelect={(recurrence) => setDraft((d) => selectRecurrence(d, recurrence, ctx))}
                    onCustom={() => setCustomOpen(true)}
                  />
                </Card>
                <Footer>{t("A contagem começa quando a tarefa é feita. A cada vez, ela passa para a próxima pessoa.")}</Footer>
              </>
            )}
            {room !== undefined && draft.followsRoom && (
              <Footer>{t("{0}, junto com o cômodo. Muda de pessoa a cada rodízio.", periodicityName(t, room.periodicity))}</Footer>
            )}
            {room === undefined && <Footer>{t("Escolha um cômodo primeiro.")}</Footer>}
            {changesRepetitionMode(editing, initial, draft) && <Footer>{t("Ao salvar, a vez atual é refeita no novo modo de repetição.")}</Footer>}
          </div>
        )}

        <EffortCard value={draft.effort} onChange={(effort) => change({ ...draft, effort })} />

        {error !== null && <p role="alert" className="px-4 text-[13px] text-danger">{error}</p>}
      </fieldset>

      {customOpen && (
        <CustomRecurrenceSheet
          initial={draft.recurrence}
          onClose={() => setCustomOpen(false)}
          onDone={(recurrence) => { setDraft((d) => selectRecurrence(d, recurrence, ctx)); setCustomOpen(false); }}
        />
      )}
    </Sheet>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[52px] items-center justify-between gap-4 rounded-[var(--radius-card)] bg-card px-4 py-1">{children}</div>;
}

function RowLabel({ icon, htmlFor, children }: { icon: ReactNode; htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="flex shrink-0 items-center gap-2 text-[17px]">
      <span className="text-accent">{icon}</span>
      {children}
    </label>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <p className="px-4 text-[13px] text-secondary">{children}</p>;
}

const CUSTOM = "custom";
const presetKey = (frequency: Frequency, interval: number) => `${frequency}:${interval}`;

/** Menu de repetição própria; a periodicidade do cômodo não aparece (seria "Repetir com o cômodo"). */
function RecurrenceSelect({ draft, room, onSelect, onCustom }: { draft: TaskDraft; room: Room; onSelect: (r: Recurrence) => void; onCustom: () => void }) {
  const t = useT();
  const presets = RECURRENCE_PRESETS.filter((p) => !isRoomPeriodicity({ kind: "recurring", frequency: p.frequency, interval: p.interval }, room));
  const current = draft.recurrence;
  const currentKey = current.kind === "recurring" ? presetKey(current.frequency, current.interval) : "";
  const isPreset = presets.some((p) => presetKey(p.frequency, p.interval) === currentKey);
  return (
    <select
      id="task-recurrence"
      value={isPreset ? currentKey : "current"}
      onChange={(e) => {
        const value = e.target.value;
        if (value === CUSTOM) { onCustom(); return; }
        const preset = presets.find((p) => presetKey(p.frequency, p.interval) === value);
        if (preset !== undefined) onSelect({ kind: "recurring", frequency: preset.frequency, interval: preset.interval });
      }}
      className="min-h-[44px] max-w-[60%] rounded-[8px] bg-transparent text-right text-[17px] text-secondary outline-none"
    >
      {!isPreset && <option value="current">{recurrenceName(t, current)}</option>}
      {presets.map((p) => <option key={presetKey(p.frequency, p.interval)} value={presetKey(p.frequency, p.interval)}>{intervalName(t, p.frequency, p.interval)}</option>)}
      <option value={CUSTOM}>{t("Personalizado")}</option>
    </select>
  );
}

function Bolts({ count }: { count: number }) {
  return (
    <span aria-hidden="true" className="inline-flex gap-0.5">
      {Array.from({ length: count }, (_, i) => <Zap key={i} size={15} fill="currentColor" strokeWidth={0} />)}
    </span>
  );
}

/** Esforço como Leve/Médio/Intenso (carga interna, nunca pontuação). */
function EffortCard({ value, onChange }: { value: number; onChange: (effort: number) => void }) {
  const t = useT();
  const labelID = useId();
  return (
    <div className="rounded-[var(--radius-card)] bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span id={labelID} className="flex items-center gap-2 text-[17px]">
          <Zap aria-hidden="true" size={18} className="text-accent" fill="currentColor" strokeWidth={0} />
          {t("Esforço")}
        </span>
        <span className="flex items-center gap-1 text-secondary">
          <Bolts count={value} />
          <span>– {effortName(t, value)}</span>
        </span>
      </div>
      <div role="radiogroup" aria-labelledby={labelID} className="grid grid-cols-3 gap-1 rounded-[12px] bg-fill p-1">
        {[1, 2, 3].map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value === level}
            aria-label={t("{0}, esforço {1} de 3", effortName(t, level), level)}
            onClick={() => onChange(level)}
            className={cx("flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-[9px] text-[15px] transition", value === level ? "bg-elevated shadow-sm" : "hover:bg-fill")}
          >
            <span className="text-accent"><Bolts count={level} /></span>
            <span>{effortName(t, level)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Stepper({ label, value, min, max, onChange, valueText }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; valueText: string }) {
  const t = useT();
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-1">
      <span>{label}</span>
      <span className="flex items-center gap-3">
        <span className="min-w-[2ch] text-right text-secondary" aria-live="polite">{value}</span>
        <span className="flex overflow-hidden rounded-[9px] bg-fill" role="group" aria-label={label}>
          <button type="button" aria-label={t("Diminuir {0}", valueText)} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className="flex h-9 w-11 items-center justify-center disabled:opacity-40">
            <Minus aria-hidden="true" size={16} />
          </button>
          <button type="button" aria-label={t("Aumentar {0}", valueText)} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} className="flex h-9 w-11 items-center justify-center border-l border-separator disabled:opacity-40">
            <Plus aria-hidden="true" size={16} />
          </button>
        </span>
      </span>
    </div>
  );
}

/** "Personalizado": frequência, execuções (semanal) e intervalo. */
function CustomRecurrenceSheet({ initial, onClose, onDone }: { initial: Recurrence; onClose: () => void; onDone: (r: Recurrence) => void }) {
  const t = useT();
  const [frequency, setFrequency] = useState<Frequency>(initial.kind === "recurring" ? initial.frequency : "weekly");
  const [interval, setInterval] = useState(initial.kind === "weekly" ? initial.periodicity.intervalWeeks : initial.kind === "recurring" ? Math.max(1, initial.interval) : 1);
  const [executions, setExecutions] = useState(weeklyPeriodicity(initial)?.executionsPerPeriod ?? 1);
  const maxExecutions = Math.max(1, interval * 7);
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t("Personalizado")}
      confirm={{
        label: t("Concluir"),
        onSelect: () => onDone(frequency === "weekly"
          ? { kind: "weekly", periodicity: { executionsPerPeriod: Math.min(executions, maxExecutions), intervalWeeks: interval } }
          : { kind: "recurring", frequency, interval }),
      }}
    >
      <div className="overflow-hidden rounded-[var(--radius-control)] bg-card [&>*+*]:border-t [&>*+*]:border-separator">
        <div className="flex min-h-[52px] items-center justify-between gap-3 px-4">
          <label htmlFor="custom-frequency">{t("Frequência")}</label>
          <select id="custom-frequency" value={frequency} onChange={(e) => {
            const next = FREQUENCY_ORDER.find((f) => f === e.target.value);
            if (next !== undefined) setFrequency(next);
          }} className="min-h-[44px] bg-transparent text-right text-secondary outline-none">
            {FREQUENCY_ORDER.map((f) => <option key={f} value={f}>{frequencyName(t, f)}</option>)}
          </select>
        </div>
        {frequency === "weekly" && (
          <Stepper label={t("Execuções: {0}", Math.min(executions, maxExecutions))} value={Math.min(executions, maxExecutions)} min={1} max={maxExecutions} onChange={setExecutions} valueText={t("Execuções: {0}", executions)} />
        )}
        <Stepper label={t("A cada")} value={interval} min={1} max={999} onChange={setInterval} valueText={`${interval} ${unitName(t, frequency, interval)}`} />
      </div>
      <p className="mt-4 rounded-[var(--radius-control)] bg-card px-4 py-3 text-secondary">{recurrenceSummary(t, frequency, interval)}</p>
    </Sheet>
  );
}
