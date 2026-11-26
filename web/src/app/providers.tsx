"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { I18nProvider } from "@/i18n/provider";
import type { Locale, Messages } from "@/i18n/messages";
import { ToastProvider } from "@/components/toast";
import { ApiError } from "@/lib/client/http";

export function Providers({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: true,
        // Erros do contrato (4xx) não melhoram repetindo; rede e 5xx tentam mais uma vez.
        retry: (count, error) => count < 1 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
      },
      mutations: { retry: false },
    },
  }));
  return (
    <I18nProvider locale={locale} messages={messages}>
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
}
