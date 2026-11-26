"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/sheet";
import { Avatar, Button, Section, cx } from "@/components/ui";
import { useT } from "@/i18n/provider";
import { auth, me } from "@/lib/client/endpoints";
import { errorMessage } from "@/lib/client/http";
import { signOut } from "@/lib/client/account";
import { keys, useSessionQuery } from "@/lib/client/queries";
import { useHouse } from "../house-context";
import { ChangePasswordSheet } from "./change-password-sheet";
import { ActionRow, SubpageHeader, ValueRow } from "./parts";
import { profileJPEG } from "./photo";

/** Ajustes › Conta (AccountView): foto, nome, e-mail e provedor, alterar senha, sair e apagar a conta. */
export function AccountView() {
  const t = useT();
  const client = useQueryClient();
  const { me: profile } = useHouse();
  const session = useSessionQuery();
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refreshHouse = () => client.invalidateQueries({ queryKey: keys.snapshot });

  const photo = useMutation({
    mutationFn: async (file: File | null) => {
      if (file === null) return me.removePhoto();
      const jpeg = await profileJPEG(file);
      if (jpeg === null) throw new PhotoError();
      await auth.uploadPhoto(jpeg);
    },
    onSuccess: refreshHouse,
    onError: (error) => setFailure({
      title: t("Não foi possível salvar"),
      message: error instanceof PhotoError ? t("Não foi possível usar essa foto.") : errorMessage(t, error),
    }),
  });

  const remove = useMutation({
    mutationFn: () => me.remove(),
    onSuccess: () => signOut(client),
    onError: (error) => setFailure({ title: t("Não foi possível excluir a conta"), message: errorMessage(t, error) }),
  });

  const provider = session.data?.signedIn === true ? session.data.provider : null;
  const email = session.data?.signedIn === true && session.data.email !== "" ? session.data.email : null;
  const providerName = provider === null ? null : provider === "password" ? t("E-mail e senha") : /apple/i.test(provider) ? t("Apple") : provider;
  const hasPhoto = profile?.photoURL != null;

  return (
    <>
      <SubpageHeader title={t("Conta")} />

      {profile !== undefined && (
        <>
          <div className="mb-6 flex justify-center">
            <Avatar name={profile.name} photoURL={profile.photoURL} size="hero" />
          </div>

          <Section footer={t("Seu nome e sua foto aparecem nas tarefas e no rodízio.")}>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                event.target.value = "";
                if (file !== null) photo.mutate(file);
              }}
            />
            <button
              type="button"
              disabled={photo.isPending}
              onClick={() => fileInput.current?.click()}
              className="flex min-h-[48px] w-full items-center gap-3 px-4 py-2.5 text-left text-accent transition hover:bg-fill disabled:opacity-50"
            >
              <Camera aria-hidden="true" size={20} />
              {hasPhoto ? t("Trocar foto") : t("Adicionar foto")}
            </button>
            {hasPhoto && (
              <button
                type="button"
                disabled={photo.isPending}
                onClick={() => photo.mutate(null)}
                className="flex min-h-[48px] w-full items-center px-4 py-2.5 text-left text-danger transition hover:bg-fill disabled:opacity-50"
              >
                {t("Remover foto")}
              </button>
            )}
          </Section>

          <NameSection currentName={profile.name} onSaved={refreshHouse} />
        </>
      )}

      {(email !== null || providerName !== null) && (
        <Section>
          {email !== null && <ValueRow label={t("E-mail")} value={email} />}
          {providerName !== null && <ValueRow label={t("Entrou com")} value={providerName} />}
        </Section>
      )}

      {provider === "password" && (
        <Section>
          <button type="button" onClick={() => setChangingPassword(true)} className="flex min-h-[48px] w-full items-center px-4 text-left text-accent transition hover:bg-fill">
            {t("Alterar senha")}
          </button>
        </Section>
      )}

      <Section>
        <ActionRow onClick={() => setConfirmSignOut(true)}>{t("Sair da conta")}</ActionRow>
      </Section>

      <Section footer={t("Apaga seu perfil e o vínculo com o WhatsApp e tira você da casa. Não dá para desfazer.")}>
        <div className="bg-danger-soft">
          <ActionRow destructive disabled={remove.isPending} onClick={() => setConfirmDelete(true)}>{t("Apagar conta")}</ActionRow>
        </div>
      </Section>

      <ChangePasswordSheet open={changingPassword} onOpenChange={setChangingPassword} />
      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title={t("Sair da conta?")}
        actions={[{ label: t("Sair da conta"), destructive: true, onSelect: () => void signOut(client) }]}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("Apagar sua conta?")}
        message={t("Seu perfil e o vínculo com o WhatsApp serão apagados e você sai da casa. Se for o último morador, a casa, os cômodos e as tarefas também serão excluídos. Não dá para desfazer.")}
        actions={[{ label: t("Apagar conta"), destructive: true, onSelect: () => remove.mutate() }]}
      />
      <ConfirmDialog
        open={failure !== null}
        onOpenChange={(next) => { if (!next) setFailure(null); }}
        title={failure?.title ?? ""}
        {...(failure !== null ? { message: failure.message } : {})}
        actions={[]}
        cancelLabel={t("OK")}
      />
    </>
  );
}

class PhotoError extends Error {}

/**
 * Nome editável (EditableNameSection): salva no "Salvar" ou no Enter; se o servidor recusar, volta ao nome salvo.
 * O nome vazio nem chega ao servidor.
 */
function NameSection({ currentName, onSaved }: { currentName: string; onSaved: () => Promise<void> }) {
  const t = useT();
  // `null` = não está editando: o campo mostra o nome salvo (que pode mudar por fora).
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const value = draft ?? currentName;
  const trimmed = value.trim();
  const dirty = trimmed !== currentName;

  const rename = useMutation({
    mutationFn: (name: string) => me.rename(name),
    onSuccess: async () => { await onSaved(); setDraft(null); },
    onError: (error) => { setMessage(errorMessage(t, error)); setDraft(null); },
  });

  const commit = () => {
    if (!dirty || rename.isPending) return;
    if (trimmed === "") { setMessage(t("Informe um nome válido.")); return; }
    setMessage(null);
    rename.mutate(trimmed);
  };

  return (
    <Section title={t("Nome")} {...(message !== null ? { footer: <span className="text-danger">{message}</span> } : {})}>
      <form className="flex items-center gap-2 pr-2" onSubmit={(event) => { event.preventDefault(); commit(); }}>
        <label className="sr-only" htmlFor="profile-name">{t("Nome")}</label>
        <input
          id="profile-name"
          value={value}
          maxLength={80}
          autoComplete="name"
          placeholder={t("Seu nome")}
          disabled={rename.isPending}
          onBlur={() => { if (!dirty) setDraft(null); }}
          onChange={(event) => setDraft(event.target.value)}
          className={cx("min-h-[48px] min-w-0 flex-1 bg-transparent px-4 text-[17px] outline-none placeholder:text-muted")}
        />
        {dirty && <Button type="submit" size="small" loading={rename.isPending}>{t("Salvar")}</Button>}
      </form>
    </Section>
  );
}
