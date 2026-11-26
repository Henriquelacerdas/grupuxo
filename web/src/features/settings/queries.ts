"use client";

import { useQuery } from "@tanstack/react-query";
import { me } from "@/lib/client/endpoints";
import { keys } from "@/lib/client/queries";
import packageJSON from "../../../package.json";

export const useVacationQuery = () => useQuery({ queryKey: keys.vacation, queryFn: me.vacation });
export const useWhatsAppQuery = () => useQuery({ queryKey: keys.whatsApp, queryFn: me.whatsApp });
export const usePreferencesQuery = () => useQuery({ queryKey: keys.preferences, queryFn: me.preferences });

/** Versão do web (AppInfo.version): `NEXT_PUBLIC_APP_VERSION` no build ou a do package.json. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || packageJSON.version;
export const FEEDBACK_EMAIL = process.env.NEXT_PUBLIC_FEEDBACK_EMAIL || "reveza.app@gmail.com";
export const PRIVACY_URL = safeURL(process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL);
export const TERMS_URL = safeURL(process.env.NEXT_PUBLIC_TERMS_URL);

/** Só `https`/`http` (AppInfo aceita também `mailto`); o resto é configuração errada e a linha some. */
function safeURL(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
