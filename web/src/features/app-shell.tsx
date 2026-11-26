"use client";

import { Bell, CircleCheck, House, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, type ReactNode } from "react";
import { ErrorState, Spinner, cx } from "@/components/ui";
import { useT } from "@/i18n/provider";
import { ApiError, errorMessage, setUnauthorizedHandler } from "@/lib/client/http";
import { useNotificationsQuery, useSnapshotQuery } from "@/lib/client/queries";
import { registerServiceWorker } from "@/lib/client/web-push";
import { Onboarding } from "./onboarding/onboarding";
import { useOnboardingFinishing } from "./onboarding/progress";
import { HouseProvider } from "./house-context";

/** Portão da casa (HouseGateView) + navegação: abas embaixo no celular, barra lateral no desktop. */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const snapshot = useSnapshotQuery();
  const refetch = snapshot.refetch;
  const refresh = useCallback(async () => { await refetch(); }, [refetch]);
  // Depois de criar a casa o snapshot já responde, mas os últimos passos do onboarding ainda faltam.
  const finishing = useOnboardingFinishing();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      const next = `${window.location.pathname}${window.location.search}`;
      // Recarga inteira de propósito: a sessão acabou e nada da conta anterior pode ficar na memória.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    });
    void registerServiceWorker();
    return () => setUnauthorizedHandler(null);
  }, []);

  if (finishing) return <Onboarding needsProfile={false} />;
  if (snapshot.isPending) return <main className="min-h-dvh"><Spinner /></main>;
  if (snapshot.isError) {
    const error = snapshot.error;
    if (error instanceof ApiError && error.code === "account_not_registered") return <Onboarding needsProfile />;
    if (error instanceof ApiError && (error.code === "no_house" || error.status === 404)) return <Onboarding needsProfile={false} />;
    return <main className="min-h-dvh"><ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} /></main>;
  }
  return (
    <HouseProvider snapshot={snapshot.data} isFetching={snapshot.isFetching} refresh={refresh}>
      <Chrome>{children}</Chrome>
    </HouseProvider>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const notifications = useNotificationsQuery();
  const unread = notifications.data?.filter((n) => n.readAt === null).length ?? 0;

  useEffect(() => {
    // Selo no ícone do PWA instalado (Badging API), como o número no ícone do app.
    const nav: Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> } = navigator;
    if (unread > 0) void nav.setAppBadge?.(unread).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  }, [unread]);

  const tabs = [
    { href: "/app/tasks", label: t("Tarefas"), icon: CircleCheck, active: pathname.startsWith("/app/tasks"), badge: 0 },
    { href: "/app/house", label: t("Casa"), icon: House, active: pathname.startsWith("/app/house") || pathname.startsWith("/app/rooms") || pathname.startsWith("/app/sporadic"), badge: 0 },
  ];
  const extras = [
    { href: "/app/notifications", label: t("Notificações"), icon: Bell, active: pathname.startsWith("/app/notifications"), badge: unread },
    { href: "/app/settings", label: t("Ajustes"), icon: Settings, active: pathname.startsWith("/app/settings"), badge: 0 },
  ];

  return (
    <div className="min-h-dvh">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-elevated focus:px-4 focus:py-2">
        {t("Pular para o conteúdo")}
      </a>
      <nav aria-label={t("Navegação principal")} className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-1 border-r border-separator bg-card px-3 py-6 lg:flex">
        <Link href="/app/tasks" className="mb-6 flex items-center gap-2 px-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon.svg" alt="" width={32} height={32} className="rounded-[8px]" />
          <span className="font-rounded text-[22px] font-bold">Reveza</span>
        </Link>
        {[...tabs, ...extras].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={cx("flex min-h-[44px] items-center gap-3 rounded-[10px] px-3 text-[17px] transition", item.active ? "bg-accent-soft font-semibold text-accent" : "text-label hover:bg-fill")}
          >
            <item.icon aria-hidden="true" size={20} />
            <span className="flex-1">{item.label}</span>
            {item.badge > 0 && (
              <span className="rounded-full bg-danger px-2 text-[13px] font-semibold text-white" aria-label={t("{0} não lidas", item.badge)}>{item.badge}</span>
            )}
          </Link>
        ))}
      </nav>

      <main id="conteudo" className="mx-auto w-full max-w-3xl px-4 pb-[calc(env(safe-area-inset-bottom)+96px)] pt-[max(env(safe-area-inset-top),12px)] lg:ml-64 lg:w-auto lg:max-w-none lg:px-10 lg:pb-12 lg:pt-8">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>

      <nav aria-label={t("Navegação principal")} className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-separator bg-card/90 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-md">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              className={cx("flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", tab.active ? "text-accent" : "text-muted")}
            >
              <tab.icon aria-hidden="true" size={24} strokeWidth={tab.active ? 2.5 : 2} />
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
