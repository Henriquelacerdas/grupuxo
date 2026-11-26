"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { House, HouseSnapshot, User } from "@/lib/api/types";
import type { TextContext } from "@/lib/format/labels";
import { useI18n } from "@/i18n/provider";

interface HouseValue {
  readonly snapshot: HouseSnapshot;
  readonly userID: string;
  readonly house: House;
  readonly me: User | undefined;
  /** id → nome completo dos moradores atuais (os avisos usam o nome curto). */
  readonly memberNames: ReadonlyMap<string, string>;
  readonly isFetching: boolean;
  readonly refresh: () => Promise<void>;
}

const Context = createContext<HouseValue | null>(null);

export function HouseProvider({ snapshot, isFetching, refresh, children }: {
  snapshot: HouseSnapshot; isFetching: boolean; refresh: () => Promise<void>; children: ReactNode;
}) {
  const value = useMemo<HouseValue>(() => {
    const userID = snapshot.userID.toLowerCase();
    return {
      snapshot,
      userID,
      house: snapshot.home.house,
      me: snapshot.home.members.find((member) => member.id.toLowerCase() === userID),
      memberNames: new Map(snapshot.home.members.map((member) => [member.id.toLowerCase(), member.name])),
      isFetching,
      refresh,
    };
  }, [snapshot, isFetching, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** A casa carregada (só existe dentro de `/app`, depois do portão da casa). */
export function useHouse(): HouseValue {
  const value = useContext(Context);
  if (value === null) throw new Error("HouseProvider ausente");
  return value;
}

/** `t`, idioma e fuso da casa para os rótulos de `lib/format/labels`. */
export function useTextContext(): TextContext {
  const { t, locale } = useI18n();
  const { house } = useHouse();
  return useMemo(() => ({ t, locale, timeZone: house.timezone }), [t, locale, house.timezone]);
}
