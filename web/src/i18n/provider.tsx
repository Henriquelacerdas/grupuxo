"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { format, type Arg, type Locale, type Messages } from "./messages";

interface I18n {
  readonly locale: Locale;
  readonly t: (key: string, ...args: Arg[]) => string;
}

const Context = createContext<I18n | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const t = useCallback((key: string, ...args: Arg[]) => format(locale, messages, key, args), [locale, messages]);
  const value = useMemo(() => ({ locale, t }), [locale, t]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (value === null) throw new Error("I18nProvider ausente");
  return value;
}

export function useT(): I18n["t"] {
  return useI18n().t;
}
