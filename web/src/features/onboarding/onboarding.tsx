"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ROOM_SYMBOLS, roomColorVar } from "@/components/icons";
import { ConfirmDialog } from "@/components/sheet";
import { useToast } from "@/components/toast";
import { Avatar, Button, IconButton, Row, Section, TextField, cx } from "@/components/ui";
import { useT } from "@/i18n/provider";
import type { House } from "@/lib/api/types";
import { signOut } from "@/lib/client/account";
import { auth, house as houseAPI, me, rooms as roomsAPI, tasks as tasksAPI } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { invalidateHouse, useSessionQuery } from "@/lib/client/queries";
import { enablePush, pushState, type PushState } from "@/lib/client/web-push";
import { normalizeInviteCode } from "@/lib/rules/tasks";
import { nameFromEmail } from "@/features/auth/logic";
import { squareJPEG } from "./photo";
import { INVITE_CODE_LENGTH, clearPendingInvite, inviteLink, readPendingInvite } from "./pending-invite";
import { setOnboardingFinishing } from "./progress";
import { STARTER_ROOMS, starterTasks } from "./starter-rooms";

// Primeiros passos de quem ainda não tem casa (OnboardingView): seu nome → entrar com código ou criar a casa →
// (criou) primeiros cômodos → convidar → notificações. Aparece no lugar do app enquanto o snapshot responde
// 403 `account_not_registered` ou 404 `no_house`, e até o último passo depois de criar a casa.

type Step = "profile" | "house" | "join" | "houseName" | "rooms" | "invite" | "notifications";

const WEEKLY = { executionsPerPeriod: 1, intervalWeeks: 1 } as const;

export function Onboarding({ needsProfile }: { needsProfile: boolean }) {
  const t = useT();
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const session = useSessionQuery();

  // Decidido uma vez: o app-shell pode remontar o componente com `needsProfile` falso depois do registro.
  const [registered, setRegistered] = useState(!needsProfile);
  const [history, setHistory] = useState<Step[]>(() => {
    const invite = readPendingInvite();
    if (needsProfile) return ["profile"];
    return invite === null ? ["house"] : ["house", "join"];
  });
  const step = history[history.length - 1] ?? "house";
  const root = history[0];
  const go = (next: Step) => { setError(null); setHistory((current) => [...current, next]); };
  const back = () => { setError(null); setHistory((current) => (current.length > 1 ? current.slice(0, -1) : current)); };

  const [myName, setMyName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [houseName, setHouseName] = useState("");
  const [code, setCode] = useState(() => readPendingInvite() ?? "");
  const [created, setCreated] = useState<House | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"signOut" | "delete" | null>(null);
  const [push, setPush] = useState<PushState>("unsupported");
  const fileInput = useRef<HTMLInputElement>(null);

  // Nome pré-preenchido com o início do e-mail; sem e-mail (relay da Apple), "Morador".
  const email = session.data?.signedIn === true ? session.data.email : "";
  useEffect(() => {
    if (nameTouched || myName !== "" || !session.isSuccess) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMyName(nameFromEmail(email) || t("Morador"));
  }, [email, myName, nameTouched, session.isSuccess, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPush(pushState());
  }, []);

  useEffect(() => () => { if (photo !== null) URL.revokeObjectURL(photo.url); }, [photo]);
  // Saiu do componente no meio do caminho (logout, erro): o app-shell volta a decidir sozinho.
  useEffect(() => () => setOnboardingFinishing(false), []);

  const trimmedName = myName.trim();

  const ensureAccount = async () => {
    if (registered) return;
    await me.register(trimmedName === "" ? t("Morador") : trimmedName);
    setRegistered(true);
  };

  /** Foto opcional: se o envio falhar, a casa segue e a foto se troca em Ajustes › Conta. */
  const uploadPhoto = async () => {
    if (photo === null) return;
    await auth.uploadPhoto(photo.blob).catch(() => undefined);
  };

  const finish = async () => {
    clearPendingInvite();
    router.replace("/app/house");
    setOnboardingFinishing(false);
    await invalidateHouse(client);
  };

  const join = async () => {
    const normalized = normalizeInviteCode(code);
    if (working || normalized.length !== INVITE_CODE_LENGTH) return;
    setWorking(true);
    setError(null);
    try {
      await ensureAccount();
      await houseAPI.join(normalized);
    } catch (caught) {
      setWorking(false);
      setError(errorMessage(t, caught));
      return;
    }
    await uploadPhoto();
    await finish();
  };

  const createHouse = async () => {
    const name = houseName.trim();
    if (working || name === "") return;
    setWorking(true);
    setError(null);
    // Mantém o onboarding à frente do app até o passo "Notificações" (o snapshot já responde 200).
    setOnboardingFinishing(true);
    try {
      await ensureAccount();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
      const home = await houseAPI.create(name, timezone);
      setCreated(home.house);
    } catch (caught) {
      setOnboardingFinishing(false);
      setWorking(false);
      setError(errorMessage(t, caught));
      return;
    }
    await uploadPhoto();
    setWorking(false);
    go("rooms");
  };

  /** Cria os cômodos marcados com as tarefas sugeridas; para na primeira falha e segue para o convite. */
  const createRooms = async () => {
    if (working || created === null) return;
    setWorking(true);
    setError(null);
    let failure: string | null = null;
    try {
      for (const starter of STARTER_ROOMS.filter((s) => selected.has(s.id))) {
        const room = await roomsAPI.create(created.id, {
          name: t(starter.name), visibility: "common", category: starter.id, periodicity: WEEKLY,
          responsibleCount: 1, icon: starter.icon, color: starter.color,
        });
        for (const suggestion of starterTasks(starter.id)) {
          await tasksAPI.create(room.id, {
            name: t(suggestion.name), details: suggestion.details, effort: suggestion.effort, kind: "recurring",
            recurrence: { kind: "weekly", periodicity: WEEKLY }, assignmentPolicy: "balancedAutomatically", followsRoom: true,
          });
        }
      }
    } catch (caught) {
      failure = errorMessage(t, caught);
    }
    setWorking(false);
    setHistory((current) => [...current, "invite"]);
    // Falha parcial: segue para o convite com o aviso (o app faz o mesmo).
    if (failure !== null) toast(failure, "error");
  };

  const pickPhoto = async (file: File | undefined) => {
    if (file === undefined) return;
    const blob = await squareJPEG(file);
    if (blob === null) return;
    setPhoto({ blob, url: URL.createObjectURL(blob) });
  };

  const deleteAccount = async () => {
    setWorking(true);
    try {
      await me.remove();
    } catch (caught) {
      setWorking(false);
      setError(`${t("Não foi possível excluir a conta")}. ${errorMessage(t, caught)}`);
      return;
    }
    await signOut(client);
  };

  const accountActions = (
    <IconButton label={t("Sair da conta")} icon={LogOut} onClick={() => setConfirm("signOut")} />
  );

  const dialogs = (
    <>
      <ConfirmDialog
        open={confirm === "signOut"}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={t("Sair da conta?")}
        actions={[{ label: t("Sair da conta"), destructive: true, onSelect: () => void signOut(client) }]}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={t("Apagar sua conta?")}
        message={t("Seu perfil e o vínculo com o WhatsApp serão apagados e você sai da casa. Se for o último morador, a casa, os cômodos e as tarefas também serão excluídos. Não dá para desfazer.")}
        actions={[{ label: t("Apagar conta"), destructive: true, onSelect: () => void deleteAccount() }]}
      />
    </>
  );

  const deleteRow = (
    <Section>
      <Row onClick={() => setConfirm("delete")} destructive disabled={working}>{t("Apagar conta")}</Row>
    </Section>
  );

  const canGoBack = history.length > 1 && (step === "house" || step === "join" || step === "houseName");

  switch (step) {
    case "profile":
      return (
        <StepScreen
          toolbar={accountActions}
          footer={<Button size="large" disabled={trimmedName === ""} onClick={() => go(readPendingInvite() === null ? "house" : "join")}>{t("Continuar")}</Button>}
        >
          {dialogs}
          <StepHeader title={t("Como a casa vai te chamar?")} subtitle={t("Seu nome e sua foto aparecem nas tarefas e no rodízio.")} />
          <div className="mb-6 flex flex-col items-center gap-1">
            <Avatar name={trimmedName === "" ? "?" : trimmedName} photoURL={photo?.url ?? null} size="hero" />
            <input ref={fileInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true"
              onChange={(event) => { void pickPhoto(event.target.files?.[0]); event.target.value = ""; }} />
            <Button variant="plain" onClick={() => fileInput.current?.click()}>{photo === null ? t("Adicionar foto") : t("Trocar foto")}</Button>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); if (trimmedName !== "") go(readPendingInvite() === null ? "house" : "join"); }}>
            <TextField
              label={t("Seu nome")}
              value={myName}
              onChange={(event) => { setNameTouched(true); setMyName(event.target.value); }}
              autoComplete="name"
              autoCapitalize="words"
              maxLength={80}
              hint={t("Se você entrou com a Apple, o nome já vem preenchido.")}
            />
          </form>
          {error !== null && <p role="alert" className="mb-3 px-1 text-[13px] text-danger">{error}</p>}
          <div className="mt-4">{deleteRow}</div>
        </StepScreen>
      );

    case "house":
      return (
        <StepScreen toolbar={root === "house" ? accountActions : undefined} onBack={canGoBack ? back : undefined}>
          {dialogs}
          <StepHeader title={t("Você já tem uma casa no Reveza?")} subtitle={t("Se alguém da sua casa já usa o app, peça o código para entrar.")} />
          <Section>
            <Row chevron onClick={() => go("join")}>
              <span className="block">{t("Entrar com código")}</span>
              <span className="block text-[15px] text-secondary">{t("Alguém da casa já te mandou o código.")}</span>
            </Row>
            <Row chevron onClick={() => go("houseName")}>
              <span className="block">{t("Criar uma casa")}</span>
              <span className="block text-[15px] text-secondary">{t("Monte os cômodos e chame a casa.")}</span>
            </Row>
          </Section>
          {root === "house" && <div className="mt-8">{deleteRow}</div>}
          {error !== null && <p role="alert" className="px-1 text-[13px] text-danger">{error}</p>}
        </StepScreen>
      );

    case "join": {
      const normalized = normalizeInviteCode(code);
      return (
        <StepScreen
          onBack={history.length > 1 ? back : undefined}
          toolbar={history.length > 1 ? undefined : accountActions}
          footer={<Button size="large" type="submit" form="join-form" loading={working} disabled={normalized.length < INVITE_CODE_LENGTH}>{t("Entrar na casa")}</Button>}
        >
          {dialogs}
          <StepHeader title={t("Qual é o código da casa?")} subtitle={t("Peça para quem criou a casa. Ele aparece em Ajustes, na seção Casa.")} />
          <form id="join-form" onSubmit={(event) => { event.preventDefault(); void join(); }}>
            <TextField
              label={t("Código de 6 letras")}
              value={normalized}
              onChange={(event) => { setCode(normalizeInviteCode(event.target.value)); setError(null); }}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="[&_input]:font-mono [&_input]:tracking-[0.3em]"
              error={error}
            />
          </form>
        </StepScreen>
      );
    }

    case "houseName":
      return (
        <StepScreen
          onBack={back}
          footer={<Button size="large" type="submit" form="house-name-form" loading={working} disabled={houseName.trim() === ""}>{t("Continuar")}</Button>}
        >
          <StepHeader title={t("Como se chama a casa?")} subtitle={t("Todo mundo que entrar vai ver esse nome.")} />
          <form id="house-name-form" onSubmit={(event) => { event.preventDefault(); void createHouse(); }}>
            <TextField
              label={t("Nome da casa")}
              value={houseName}
              onChange={(event) => { setHouseName(event.target.value); setError(null); }}
              autoComplete="off"
              autoCapitalize="words"
              maxLength={80}
              hint={t("Ex.: Rep da Unicamp, Apê da Augusta.")}
              error={error}
            />
          </form>
        </StepScreen>
      );

    case "rooms":
      return (
        <StepScreen
          footer={(
            <Button size="large" loading={working} onClick={() => void createRooms()}>
              {selected.size === 0 ? t("Continuar sem cômodos") : t("Criar cômodos")}
            </Button>
          )}
        >
          <StepHeader title={t("Quais cômodos tem na casa?")} subtitle={t("Marque os que entram no rodízio.")} />
          <Section footer={t("Todos começam com rodízio toda semana e algumas tarefas sugeridas. Você pode alterar depois em cada cômodo.")}>
            {STARTER_ROOMS.map((starter) => {
              const on = selected.has(starter.id);
              const Glyph = ROOM_SYMBOLS[starter.icon];
              return (
                <button
                  key={starter.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={working}
                  onClick={() => setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(starter.id)) next.delete(starter.id); else next.add(starter.id);
                    return next;
                  })}
                  className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-fill disabled:opacity-60"
                >
                  <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-white" style={{ background: roomColorVar(starter.color) }}>
                    {Glyph !== undefined && <Glyph size={18} strokeWidth={2.25} />}
                  </span>
                  <span className="flex-1">{t(starter.name)}</span>
                  {on
                    ? <CheckCircle2 aria-hidden="true" size={24} className="text-accent" fill="currentColor" stroke="var(--bg-card)" />
                    : <Circle aria-hidden="true" size={24} className="text-muted" />}
                </button>
              );
            })}
          </Section>
        </StepScreen>
      );

    case "invite": {
      const accessCode = created?.accessCode ?? "";
      const name = created?.name ?? "";
      const link = typeof window === "undefined" ? "" : inviteLink(window.location.origin, accessCode);
      const message = t("Entre na casa \"{0}\" no Reveza com o código {1}.", name, accessCode);
      const next: Step | null = push === "unsupported" ? null : "notifications";
      const share = async () => {
        if (typeof navigator.share === "function") {
          try { await navigator.share({ text: message, url: link }); return; } catch { return; }
        }
        try { await navigator.clipboard.writeText(`${message} ${link}`); toast(t("Copiado")); } catch { toast(link); }
      };
      const copy = async () => {
        try { await navigator.clipboard.writeText(accessCode); toast(t("Copiado")); } catch { toast(accessCode); }
      };
      return (
        <StepScreen
          footer={(
            <>
              <Button size="large" onClick={() => void share()}>{t("Compartilhar convite")}</Button>
              <Button size="large" variant="secondary" onClick={() => void copy()}>{t("Copiar código")}</Button>
              <Button variant="plain" onClick={() => (next === null ? void finish() : go(next))}>{t("Fazer isso depois")}</Button>
            </>
          )}
        >
          <StepHeader
            title={t("Chame quem mora com você")}
            subtitle={name === "" ? t("Quem entrar com este código participa do rodízio da casa.") : t("Quem entrar com este código participa do rodízio da {0}.", name)}
          />
          <Section>
            <div className="flex flex-col items-center gap-2 px-4 py-6" aria-label={`${t("Código da casa")}: ${accessCode.split("").join(" ")}`} role="group">
              <span aria-hidden="true" className="select-all font-mono text-[34px] font-bold tracking-[0.3em]">{accessCode}</span>
              <span aria-hidden="true" className="text-[15px] text-secondary">{t("Código da casa")}</span>
            </div>
          </Section>
          <p className="break-all px-1 text-center text-[13px] text-secondary">{link}</p>
        </StepScreen>
      );
    }

    case "notifications": {
      const activate = async () => {
        setWorking(true);
        await enablePush().catch(() => undefined);
        await finish();
      };
      return (
        <StepScreen
          footer={(
            <>
              {push !== "needsInstall" && push !== "denied" && (
                <Button size="large" loading={working} onClick={() => void activate()}>{t("Ativar notificações")}</Button>
              )}
              <Button variant={push === "needsInstall" || push === "denied" ? "primary" : "plain"} size={push === "needsInstall" || push === "denied" ? "large" : "regular"} disabled={working} onClick={() => void finish()}>
                {push === "needsInstall" || push === "denied" ? t("Continuar") : t("Agora não")}
              </Button>
              <p className="text-center text-[13px] text-secondary">{t("Você pode alterar o horário e o conteúdo das notificações em Ajustes.")}</p>
            </>
          )}
        >
          <StepHeader
            title={t("Quer que o Reveza te lembre?")}
            subtitle={t("Avisaremos quando chegar a sua vez em um cômodo, quando alguém pedir uma troca de tarefa e, uma vez por dia, suas tarefas.")}
          />
          {push === "needsInstall" && (
            <Section>
              <p className="px-4 py-3 text-[15px]">{t("No iPhone, as notificações só funcionam com o Reveza na Tela de Início: toque em Compartilhar e depois em \"Adicionar à Tela de Início\".")}</p>
            </Section>
          )}
          {push === "denied" && (
            <Section>
              <p className="px-4 py-3 text-[15px]">{t("As notificações estão bloqueadas neste navegador. Para ativar, libere nos ajustes do site.")}</p>
            </Section>
          )}
        </StepScreen>
      );
    }
  }
}

/** Esqueleto de cada passo (OnboardingStepScreen): conteúdo rolável e as ações presas ao rodapé. */
function StepScreen({ children, footer, onBack, toolbar }: { children: ReactNode; footer?: ReactNode; onBack?: (() => void) | undefined; toolbar?: ReactNode }) {
  const t = useT();
  return (
    <main className="flex min-h-dvh flex-col bg-grouped px-4 pt-[max(env(safe-area-inset-top),12px)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex min-h-[44px] items-center justify-between">
          {onBack !== undefined
            ? <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-[44px] items-center rounded-full px-2 text-[17px] text-accent hover:bg-fill">‹ {t("Voltar")}</button>
            : <span />}
          {toolbar}
        </div>
        <div className="flex-1">{children}</div>
        {footer !== undefined && (
          <div className={cx("sticky bottom-0 -mx-4 mt-6 flex flex-col items-stretch gap-3 bg-grouped px-4 pt-2", "pb-[max(env(safe-area-inset-bottom),20px)]")}>
            {footer}
          </div>
        )}
      </div>
    </main>
  );
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="mb-6 mt-2">
      <h1 className="font-rounded text-[28px] font-bold leading-tight">{title}</h1>
      <p className="mt-2 text-[15px] text-secondary">{subtitle}</p>
    </header>
  );
}
